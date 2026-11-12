import { pagePath } from './fixtures.ts';
import type { PageKind, RunSpec, TargetName } from './types.ts';

export interface PlanOptions { runs: number; quick: boolean }

/**
 * S1 で測るページ。全種類に加え、favicon 確認のキャッシュが当たらない article（article-unique-icon）を
 * article の隣に置き、キャッシュがどれだけ効いているかを数字で示す。
 */
export const S1_PAGE_KINDS: readonly PageKind[] = ['article', 'article-unique-icon', 'large', 'sjis', 'oembed', 'redirect'];

const ORIGIN = 'https://origin.bench';

function warmupCount(quick: boolean, concurrency: number): number {
	if (quick) {
		return 5;
	}

	return Math.min(100, Math.max(30, 2 * concurrency));
}

export function buildPlan(opts: PlanOptions): RunSpec[] {
	const { runs, quick } = opts;
	const plan: RunSpec[] = [];
	const s1Requests = quick ? 10 : 100;
	const s2Concurrencies = quick ? [10] : [10, 50, 100];
	const s2PerConcurrency = quick ? 5 : 20;
	const s3Requests = quick ? 20 : 100;
	const s3bDurationMs = quick ? 2000 : 10000;

	for (let runIndex = 0; runIndex < runs; runIndex++) {
		for (const pageKind of S1_PAGE_KINDS) {
			for (const rttMs of [0, 50]) {
				plan.push({
					scenario: 's1',
					pageKind,
					rttMs,
					requests: s1Requests,
					arrival: { kind: 'closed', concurrency: 1 },
					sameUrl: false,
					runIndex,
					warmupRequests: warmupCount(quick, 1),
				});
			}
		}

		for (const concurrency of s2Concurrencies) {
			plan.push({
				scenario: 's2',
				pageKind: 'article',
				rttMs: 50,
				requests: concurrency * s2PerConcurrency,
				arrival: { kind: 'closed', concurrency },
				sameUrl: false,
				runIndex,
				warmupRequests: warmupCount(quick, concurrency),
			});
		}

		plan.push({
			scenario: 's3a',
			pageKind: 'oembed',
			rttMs: 50,
			requests: s3Requests,
			arrival: { kind: 'closed', concurrency: s3Requests },
			sameUrl: true,
			runIndex,
			warmupRequests: warmupCount(quick, s3Requests),
		});
		plan.push({
			scenario: 's3b',
			pageKind: 'oembed',
			rttMs: 50,
			requests: s3Requests,
			arrival: { kind: 'spread', durationMs: s3bDurationMs },
			sameUrl: true,
			runIndex,
			warmupRequests: warmupCount(quick, 1),
		});
	}

	return plan;
}

function urlPrefix(spec: RunSpec, target: TargetName): string {
	const size = spec.arrival.kind === 'closed' ? spec.arrival.concurrency : spec.requests;

	return `n=${target}-${spec.scenario}-${spec.rttMs}-${size}-r${spec.runIndex}`;
}

export function urlsFor(spec: RunSpec, target: TargetName): string[] {
	const base = `${ORIGIN}${pagePath(spec.pageKind)}?${urlPrefix(spec, target)}`;

	if (spec.sameUrl) {
		return Array.from({ length: spec.requests }, () => base);
	}

	return Array.from({ length: spec.requests }, (_, i) => `${base}-${i}`);
}

export function warmupUrlsFor(spec: RunSpec, target: TargetName): string[] {
	const base = `${ORIGIN}${pagePath('article')}?${urlPrefix(spec, target)}`;

	return Array.from({ length: spec.warmupRequests }, (_, i) => `${base}-w${i}`);
}
