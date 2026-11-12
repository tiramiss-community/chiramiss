import { expect, test } from 'vitest';
import { renderReport } from '../src/report.ts';
import type { BenchMeta, BenchResults, PageKind, RunRecord, ScenarioId, TargetName } from '../src/types.ts';

const META: BenchMeta = {
	startedAt: '2026-11-12T00:00:00.000Z',
	host: { cpuModel: 'Test CPU', cpuCount: 8, totalMemBytes: 16 * 1024 ** 3, os: 'linux 6.0', docker: '27.0.0' },
	limits: { cpus: '2', memory: '1g' },
	chiramiss: { commit: 'abc1234', tag: null, dirty: false, node: 'v24.1.0' },
	summaly: { image: 'ghcr.io/misskey-dev/summaly:5.6.0', digest: 'sha256:deadbeef', node: 'v24.2.0' },
	quick: false,
};

interface RunOptions {
	target: TargetName;
	scenario?: ScenarioId;
	pageKind?: PageKind;
	rttMs?: number;
	latency: number;
	ok?: number;
	errors?: number;
	requests?: Record<string, number>;
}

function run(opts: RunOptions): RunRecord {
	const ok = opts.ok ?? 10;
	const pageKind = opts.pageKind ?? 'article';

	return {
		target: opts.target,
		spec: {
			scenario: opts.scenario ?? 's1',
			pageKind,
			rttMs: opts.rttMs ?? 0,
			requests: ok,
			arrival: { kind: 'closed', concurrency: 1 },
			sameUrl: false,
			runIndex: 0,
			warmupRequests: 5,
		},
		load: {
			latenciesMs: Array.from({ length: ok }, () => opts.latency),
			ok,
			errors: opts.errors ?? 0,
			errorSamples: opts.errors ? ['HTTP 500'] : [],
			wallMs: 1000,
			origin: {
				requests: opts.requests ?? { [`GET ${pageKind === 'redirect' ? '/article' : `/${pageKind}`}`]: ok },
				newConnections: 1,
				bytesOut: 2048,
			},
		},
		cpuUsageUsec: 10_000,
		memoryPeakBytes: 50 * 1024 * 1024,
	};
}

function results(runs: RunRecord[], meta: Partial<BenchMeta> = {}): BenchResults {
	return { meta: { ...META, ...meta }, runs };
}

test('headline uses s1 article rtt0 pooled medians', () => {
	const report = renderReport(results([
		run({ target: 'summaly', latency: 300 }),
		run({ target: 'chiramiss', latency: 100 }),
	]));

	expect(report).toContain('summarizes a typical article page 3.0× faster than summaly');
});

test('range covers all kinds at rtt 0 only', () => {
	const report = renderReport(results([
		run({ target: 'summaly', latency: 300 }),
		run({ target: 'chiramiss', latency: 100 }),
		run({ target: 'summaly', pageKind: 'large', latency: 500 }),
		run({ target: 'chiramiss', pageKind: 'large', latency: 100 }),
		run({ target: 'summaly', rttMs: 50, latency: 1000 }),
		run({ target: 'chiramiss', rttMs: 50, latency: 100 }),
	]));

	expect(report).toContain('Across page types: 3.0×–5.0×.');
});

test('errors produce a warning naming target and scenario', () => {
	const report = renderReport(results([
		run({ target: 'summaly', latency: 300, ok: 8, errors: 2, requests: { 'GET /article': 10 } }),
		run({ target: 'chiramiss', latency: 100 }),
	]));

	expect(report).toMatch(/⚠ summaly S1 article rtt 0ms: 2 errors \(sample: HTTP 500\)/);
	expect(report).not.toMatch(/⚠ chiramiss/);
});

test('page fetches fewer than ok in s1/s2 produce cache-hit warning; s3 does not', () => {
	const report = renderReport(results([
		run({ target: 'chiramiss', latency: 100, requests: { 'GET /article': 9 } }),
		run({ target: 'summaly', scenario: 's2', latency: 100, requests: { 'GET /article': 5 } }),
		run({ target: 'chiramiss', scenario: 's3a', pageKind: 'oembed', latency: 100, requests: { 'GET /oembed-page': 1 } }),
		run({ target: 'summaly', scenario: 's3b', pageKind: 'oembed', latency: 100, requests: { 'GET /oembed-page': 1 } }),
	]));

	expect(report).toContain('⚠ cache hit suspected in chiramiss S1 article rtt 0ms');
	expect(report).toContain('⚠ cache hit suspected in summaly S2');
	expect(report).not.toMatch(/cache hit suspected in \w+ S3/);
});

test('redirect runs are counted under GET /article and produce no false cache-hit warning', () => {
	const redirect = (article: number): BenchResults => results([
		run({
			target: 'chiramiss',
			pageKind: 'redirect',
			latency: 100,
			requests: { 'HEAD /redirect': 10, 'HEAD /article': 10, 'GET /article': article },
		}),
	]);

	expect(renderReport(redirect(10))).not.toContain('cache hit suspected');
	expect(renderReport(redirect(9))).toContain('cache hit suspected in chiramiss S1 redirect');
});

test('dirty tree and quick mode produce warnings', () => {
	const report = renderReport(results([], { quick: true, chiramiss: { ...META.chiramiss, dirty: true } }));

	expect(report).toContain('⚠ working tree was dirty');
	expect(report).toContain('⚠ quick mode — not for publication');
});

test('environment section lists commit, summaly digest and both node versions', () => {
	const report = renderReport(results([]));

	expect(report).toContain('abc1234');
	expect(report).toContain('sha256:deadbeef');
	expect(report).toContain('v24.1.0');
	expect(report).toContain('v24.2.0');
	expect(report).toContain('Test CPU');
});

test('renders the four tables', () => {
	const report = renderReport(results([
		run({ target: 'summaly', latency: 300 }),
		run({ target: 'chiramiss', latency: 100 }),
		run({ target: 'summaly', scenario: 's2', rttMs: 50, latency: 300 }),
		run({ target: 'chiramiss', scenario: 's2', rttMs: 50, latency: 100 }),
		run({ target: 'chiramiss', scenario: 's3a', pageKind: 'oembed', latency: 100, requests: { 'GET /oembed-page': 1 } }),
	]));

	for (const heading of ['S1 (ms)', 'S2', 'S3', 'S4']) {
		expect(report).toContain(`| ${heading} |`);
	}

	expect(report).toContain('S3a (in-flight sharing)');
	const s4Rows = report.split('\n').filter((line) => /^\| S[123]a? \|/.test(line) && !line.includes('in-flight'));

	expect(s4Rows.filter((line) => line.startsWith('| S3a |'))).toHaveLength(1);
});
