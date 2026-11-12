export interface LatencySummary { count: number; p50: number; p95: number; p99: number; mean: number; min: number; max: number }

/** 線形補間のパーセンタイル（numpy 既定と同じ）。p は 0〜1。空配列は NaN。 */
export function percentile(sortedAsc: number[], p: number): number {
	if (sortedAsc.length === 0) {
		return Number.NaN;
	}

	const rank = (sortedAsc.length - 1) * p;
	const lower = Math.floor(rank);
	const upper = Math.ceil(rank);
	const lowerValue = sortedAsc[lower] as number;
	const upperValue = sortedAsc[upper] as number;

	return lowerValue + (upperValue - lowerValue) * (rank - lower);
}

export function summarize(values: number[]): LatencySummary {
	const sorted = [...values].sort((a, b) => a - b);
	const sum = sorted.reduce((acc, v) => acc + v, 0);

	return {
		count: sorted.length,
		p50: percentile(sorted, 0.5),
		p95: percentile(sorted, 0.95),
		p99: percentile(sorted, 0.99),
		mean: sorted.length === 0 ? Number.NaN : sum / sorted.length,
		min: sorted.length === 0 ? Number.NaN : (sorted[0] as number),
		max: sorted.length === 0 ? Number.NaN : (sorted[sorted.length - 1] as number),
	};
}

export function median(values: number[]): number {
	return percentile([...values].sort((a, b) => a - b), 0.5);
}
