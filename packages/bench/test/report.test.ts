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
	newConnections?: number;
	bytesOut?: number;
	memoryPeakBeforeRunMiB?: number;
	memoryPeakMiB?: number;
}

const MIB = 1024 * 1024;

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
				newConnections: opts.newConnections ?? 1,
				bytesOut: opts.bytesOut ?? 2048,
			},
		},
		cpuUsageUsec: 10_000,
		memoryPeakBeforeRunBytes: (opts.memoryPeakBeforeRunMiB ?? 40) * MIB,
		memoryPeakBytes: (opts.memoryPeakMiB ?? 50) * MIB,
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

test('headline states the favicon-check cache when chiramiss sent fewer favicon checks', () => {
	const report = renderReport(results([
		run({ target: 'summaly', latency: 300, requests: { 'HEAD /article': 10, 'GET /article': 10, 'HEAD /favicon.ico': 10 } }),
		run({ target: 'chiramiss', latency: 100, requests: { 'HEAD /article': 10, 'GET /article': 10 } }),
	]));
	const first = report.split('\n')[0] ?? '';

	expect(first).toContain('3.0× faster than summaly');
	expect(first).toContain('(median, no added network latency — the cost of summarizing itself; includes chiramiss\'s favicon-check cache: per page, summaly sent 1.0 `HEAD /favicon.ico` and chiramiss 0.0).');
});

test('headline has no cache clause when both sent the same favicon checks', () => {
	const requests = { 'GET /article': 10, 'HEAD /favicon.ico': 10 };
	const report = renderReport(results([
		run({ target: 'summaly', latency: 300, requests }),
		run({ target: 'chiramiss', latency: 100, requests }),
	]));

	expect(report.split('\n')[0]).not.toContain('favicon');
});

test('unique favicon rows give their own ratio and stay out of the page type range', () => {
	const report = renderReport(results([
		run({ target: 'summaly', latency: 300 }),
		run({ target: 'chiramiss', latency: 100 }),
		run({ target: 'summaly', pageKind: 'article-unique-icon', latency: 300 }),
		run({ target: 'chiramiss', pageKind: 'article-unique-icon', latency: 200 }),
	]));

	expect(report).toContain('With a favicon URL unique to every page, so that chiramiss\'s favicon-check cache cannot answer: 1.5×.');
	expect(report).toContain('Across page types: 3.0×–3.0×.');
	expect(report).toMatch(/^\| article, unique favicon URL, rtt 0ms \|/m);
});

test('s1 table shows origin requests and new connections per summary', () => {
	const report = renderReport(results([
		run({ target: 'summaly', latency: 300, newConnections: 20, requests: { 'HEAD /article': 10, 'GET /article': 10, 'HEAD /favicon.ico': 10 } }),
		run({ target: 'chiramiss', latency: 100, newConnections: 10, requests: { 'HEAD /article': 10, 'GET /article': 10 } }),
	]));

	expect(report).toContain('| S1 (ms) | summaly p50 | summaly p95 | summaly origin requests / summary | summaly new connections / summary | chiramiss p50 | chiramiss p95 | chiramiss origin requests / summary | chiramiss new connections / summary | ratio (p50) | run-to-run p50 range |');
	expect(report).toContain('| article, rtt 0ms | 300.0 | 300.0 | 3.0 | 2.0 | 100.0 | 100.0 | 2.0 | 1.0 | 3.0× |');
});

test('s4 memory is exact when the run raised the peak and an upper bound otherwise', () => {
	const s4Row = (records: RunRecord[]): string => renderReport(results(records)).split('\n').find((line) => line.startsWith('| S1 |')) ?? '';

	// 計測区間でピークが上がった（40 → 60）: 60 は計測区間のピーク。
	expect(s4Row([
		run({ target: 'summaly', latency: 300, memoryPeakBeforeRunMiB: 40, memoryPeakMiB: 60 }),
		run({ target: 'chiramiss', latency: 100, memoryPeakBeforeRunMiB: 70, memoryPeakMiB: 70 }),
	])).toBe('| S1 | 1.00 | 60.0 | 1.00 | ≤ 70.0 |');

	// 上がらなかったランの上限が、上がったランのピーク以下なら答えは確定する。
	expect(s4Row([
		run({ target: 'summaly', latency: 300, memoryPeakBeforeRunMiB: 40, memoryPeakMiB: 60 }),
		run({ target: 'summaly', pageKind: 'large', latency: 300, memoryPeakBeforeRunMiB: 55, memoryPeakMiB: 55 }),
		run({ target: 'chiramiss', latency: 100, memoryPeakBeforeRunMiB: 40, memoryPeakMiB: 45 }),
		run({ target: 'chiramiss', pageKind: 'large', latency: 100, memoryPeakBeforeRunMiB: 80, memoryPeakMiB: 80 }),
	])).toBe('| S1 | 1.00 | 60.0 | 1.00 | ≤ 80.0 |');

	const report = renderReport(results([run({ target: 'summaly', latency: 300 })]));

	expect(report).toContain('Peak memory is the highest memory use of the container while the measured requests ran');
	expect(report).toContain('those cells read `≤ N`');
	expect(report).not.toContain('peak memory is the maximum over runs.');
});

test('notes describe the favicon cache, connections and the large page from the data', () => {
	const report = renderReport(results([
		run({ target: 'summaly', latency: 300, newConnections: 20, requests: { 'HEAD /article': 10, 'GET /article': 10, 'HEAD /favicon.ico': 10 } }),
		run({ target: 'chiramiss', latency: 100, newConnections: 10, requests: { 'HEAD /article': 10, 'GET /article': 10 } }),
		run({ target: 'summaly', pageKind: 'article-unique-icon', latency: 300 }),
		run({ target: 'chiramiss', pageKind: 'article-unique-icon', latency: 200 }),
		run({ target: 'summaly', pageKind: 'large', latency: 400, bytesOut: 15 * MIB }),
		run({ target: 'chiramiss', pageKind: 'large', latency: 10, bytesOut: 15 * MIB }),
	]));
	const notes = report.slice(report.indexOf('### Notes'), report.indexOf('### Environment'));

	expect(notes).toContain('Favicon check (S1, article, rtt 0ms): per summary, summaly sent 1.0 `HEAD /favicon.ico` and chiramiss 0.0.');
	expect(notes).toContain('"article, unique favicon URL" rows');
	expect(notes).toContain('Connections (S1, article, rtt 0ms): per summary, summaly made 3.0 origin requests over 2.0 new connections, chiramiss 2.0 over 1.0.');
	expect(notes).toContain('Large page (40.0× at rtt 0ms)');
	expect(notes).toContain('The origin sent 1.50 MiB per summary to summaly and 1.50 MiB to chiramiss, so both downloaded the whole page.');
	expect(notes).toContain('chiramiss tokenizes the HTML only up to `</head>`');
	expect(notes).not.toContain('reuse keep-alive connections and the favicon check cache');
});

test('notes only explain the favicon cache and whole-page download when the data shows them', () => {
	const requests = { 'GET /article': 10, 'HEAD /favicon.ico': 10 };
	const report = renderReport(results([
		run({ target: 'summaly', latency: 300, requests }),
		run({ target: 'chiramiss', latency: 100, requests }),
		run({ target: 'summaly', pageKind: 'large', latency: 400, bytesOut: 15 * MIB }),
		run({ target: 'chiramiss', pageKind: 'large', latency: 10, bytesOut: MIB }),
	]));
	const notes = report.slice(report.indexOf('### Notes'), report.indexOf('### Environment'));

	expect(notes).toContain('summaly sent 1.0 `HEAD /favicon.ico` and chiramiss 1.0.');
	expect(notes).not.toContain('answers the check from that cache');
	expect(notes).not.toContain('unique favicon URL');
	expect(notes).not.toContain('both downloaded the whole page');
});
