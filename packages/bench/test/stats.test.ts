import { expect, test } from 'vitest';
import { median, percentile, summarize } from '../src/stats.ts';

test('percentile interpolates linearly', () => {
	expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
	expect(percentile([10], 0.99)).toBe(10);
	expect(percentile([1, 2, 3, 4, 5], 0.95)).toBeCloseTo(4.8);
	expect(percentile([], 0.5)).toBeNaN();
});

test('summarize', () => {
	expect(summarize([5, 1, 3])).toEqual({ count: 3, p50: 3, p95: 4.8, p99: 4.96, mean: 3, min: 1, max: 5 });
	expect(summarize([]).count).toBe(0);
});

test('median does not mutate its input', () => {
	const values = [3, 1, 2];

	expect(median(values)).toBe(2);
	expect(values).toEqual([3, 1, 2]);
});
