import { expect, test } from 'vitest';
import { buildPlan, urlsFor, warmupUrlsFor } from '../src/scenarios.ts';
import type { RunSpec, TargetName } from '../src/types.ts';

const TARGETS: TargetName[] = ['chiramiss', 'summaly'];

function of(plan: RunSpec[], scenario: string): RunSpec[] {
	return plan.filter((s) => s.scenario === scenario);
}

test('full plan matches the table', () => {
	const plan = buildPlan({ runs: 3, quick: false });
	const s1 = of(plan, 's1');
	const s2 = of(plan, 's2');
	const s3a = of(plan, 's3a');
	const s3b = of(plan, 's3b');

	expect(s1).toHaveLength(5 * 2 * 3);
	expect(s2).toHaveLength(3 * 3);
	expect(s3a).toHaveLength(3);
	expect(s3b).toHaveLength(3);
	expect(plan).toHaveLength(30 + 9 + 3 + 3);

	for (const s of s1) {
		expect(s.requests).toBe(100);
		expect([0, 50]).toContain(s.rttMs);
		expect(s.arrival).toEqual({ kind: 'closed', concurrency: 1 });
		expect(s.sameUrl).toBe(false);
		expect(s.warmupRequests).toBe(30);
	}

	expect(new Set(s1.map((s) => s.pageKind))).toEqual(new Set(['article', 'large', 'sjis', 'oembed', 'redirect']));
	expect(s2.map((s) => s.arrival).filter((_, i) => i < 3)).toEqual([
		{ kind: 'closed', concurrency: 10 },
		{ kind: 'closed', concurrency: 50 },
		{ kind: 'closed', concurrency: 100 },
	]);

	for (const s of s2) {
		const c = s.arrival.kind === 'closed' ? s.arrival.concurrency : -1;

		expect(s.pageKind).toBe('article');
		expect(s.rttMs).toBe(50);
		expect(s.requests).toBe(c * 20);
		expect(s.warmupRequests).toBe(Math.min(100, Math.max(30, 2 * c)));
	}

	for (const s of s3a) {
		expect(s).toMatchObject({ pageKind: 'oembed', rttMs: 50, requests: 100, sameUrl: true, arrival: { kind: 'closed', concurrency: 100 } });
	}

	for (const s of s3b) {
		expect(s).toMatchObject({ pageKind: 'oembed', rttMs: 50, requests: 100, sameUrl: true, arrival: { kind: 'spread', durationMs: 10000 } });
	}

	expect(new Set(plan.map((s) => s.runIndex))).toEqual(new Set([0, 1, 2]));
});

test('quick plan matches the table', () => {
	const plan = buildPlan({ runs: 1, quick: true });

	expect(of(plan, 's1').every((s) => s.requests === 10)).toBe(true);
	expect(of(plan, 's2').map((s) => [s.arrival, s.requests])).toEqual([[{ kind: 'closed', concurrency: 10 }, 50]]);
	expect(of(plan, 's3a')[0]).toMatchObject({ requests: 20, arrival: { kind: 'closed', concurrency: 20 } });
	expect(of(plan, 's3b')[0]).toMatchObject({ requests: 20, arrival: { kind: 'spread', durationMs: 2000 } });
	expect(plan.every((s) => s.warmupRequests === 5)).toBe(true);
	expect(plan.every((s) => s.runIndex === 0)).toBe(true);
});

test('runs option controls the run count', () => {
	expect(buildPlan({ runs: 5, quick: false })).toHaveLength(5 * 15);
});

test('urls are unique within and across runs and targets, except sameUrl runs', () => {
	const plan = buildPlan({ runs: 3, quick: false });
	const seen = new Set<string>();

	for (const spec of plan) {
		for (const target of TARGETS) {
			const urls = urlsFor(spec, target);

			expect(urls).toHaveLength(spec.requests);
			expect(urls.every((u) => u.startsWith('https://origin.bench/'))).toBe(true);

			const distinct = new Set(urls);

			expect(distinct.size).toBe(spec.sameUrl ? 1 : urls.length);

			for (const u of distinct) {
				expect(seen.has(u)).toBe(false);
				seen.add(u);
			}
		}
	}
});

test('url format', () => {
	const [spec] = buildPlan({ runs: 1, quick: false });

	expect(urlsFor(spec, 'summaly')[3]).toBe('https://origin.bench/article?n=summaly-s1-0-1-r0-3');
	expect(warmupUrlsFor(spec, 'summaly')[2]).toBe('https://origin.bench/article?n=summaly-s1-0-1-r0-w2');
});

test('warmup urls never collide with measured urls', () => {
	const measured = new Set<string>();
	const warmup: string[] = [];
	// 暖機 URL は pageKind を含まないので S1 の kind 違いでは重なる。ターゲットはラン毎に作り直すので問題ないが、同一ラン内では一意でなければならない。

	for (const spec of buildPlan({ runs: 3, quick: false })) {
		for (const target of TARGETS) {
			for (const u of urlsFor(spec, target)) {
				measured.add(u);
			}

			const w = warmupUrlsFor(spec, target);

			expect(w).toHaveLength(spec.warmupRequests);
			expect(w.every((u) => u.startsWith('https://origin.bench/article?'))).toBe(true);
			expect(new Set(w).size).toBe(w.length);
			warmup.push(...w);
		}
	}

	expect(warmup.filter((u) => measured.has(u))).toEqual([]);
});
