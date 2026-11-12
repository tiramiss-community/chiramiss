import { pagePath, PAGE_KINDS } from './fixtures.ts';
import { summarize } from './stats.ts';
import type { BenchResults, PageKind, RunRecord, ScenarioId, TargetName } from './types.ts';

const TARGETS: readonly TargetName[] = ['chiramiss', 'summaly'];
const S1_RTTS = [0, 50];
const KIB = 1024;
const MIB = 1024 * 1024;

// redirect は origin が 302 で /article へ飛ばすので、本文を取得する最終パスで数える。
function pageFetchKey(kind: PageKind): string {
	return `GET ${kind === 'redirect' ? pagePath('article') : pagePath(kind)}`;
}

function runsOf(results: BenchResults, target: TargetName, match: (record: RunRecord) => boolean): RunRecord[] {
	return results.runs.filter((record) => record.target === target && match(record));
}

function mean(values: number[]): number {
	return values.length === 0 ? Number.NaN : values.reduce((acc, v) => acc + v, 0) / values.length;
}

function fmt(value: number, digits = 1): string {
	return Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}

function pooledLatency(records: RunRecord[]): ReturnType<typeof summarize> {
	return summarize(records.flatMap((record) => record.load.latenciesMs));
}

function runLabel(record: RunRecord): string {
	const { spec } = record;

	if (spec.scenario === 's1') {
		return `S1 ${spec.pageKind} rtt ${spec.rttMs}ms`;
	}

	if (spec.scenario === 's2') {
		return `S2 c=${spec.arrival.kind === 'closed' ? spec.arrival.concurrency : spec.requests}`;
	}

	return spec.scenario === 's3a' ? 'S3a' : 'S3b';
}

function table(header: string[], rows: string[][]): string {
	const lines = [
		`| ${header.join(' | ')} |`,
		`| ${header.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`,
		...rows.map((row) => `| ${row.join(' | ')} |`),
	];

	return lines.join('\n');
}

function ratio(results: BenchResults, kind: PageKind, rttMs: number): number {
	const pick = (target: TargetName): number => pooledLatency(
		runsOf(results, target, (r) => r.spec.scenario === 's1' && r.spec.pageKind === kind && r.spec.rttMs === rttMs),
	).p50;

	return pick('summaly') / pick('chiramiss');
}

function headline(results: BenchResults): string[] {
	const x = ratio(results, 'article', 0);
	const ratios = PAGE_KINDS.map((kind) => ratio(results, kind, 0)).filter((v) => Number.isFinite(v));
	const lines = [
		`**chiramiss summarizes a typical article page ${fmt(x)}× faster than summaly** (median, no added network latency — the cost of summarizing itself).`,
	];

	if (ratios.length > 0) {
		lines.push('', `Across page types: ${fmt(Math.min(...ratios))}×–${fmt(Math.max(...ratios))}×.`);
	}

	return lines;
}

function warnings(results: BenchResults): string[] {
	const out: string[] = [];
	const errorGroups = new Map<string, { target: TargetName; label: string; errors: number; sample: string }>();
	const cacheGroups = new Map<string, { target: TargetName; label: string; runs: number }>();

	for (const record of results.runs) {
		const label = runLabel(record);
		const key = `${record.target}\u0000${label}`;

		if (record.load.errors > 0) {
			const group = errorGroups.get(key) ?? { target: record.target, label, errors: 0, sample: '' };

			group.errors += record.load.errors;
			group.sample = group.sample === '' ? (record.load.errorSamples[0] ?? '') : group.sample;
			errorGroups.set(key, group);
		}

		const scenario: ScenarioId = record.spec.scenario;

		if ((scenario === 's1' || scenario === 's2')
			&& (record.load.origin.requests[pageFetchKey(record.spec.pageKind)] ?? 0) < record.load.ok) {
			const group = cacheGroups.get(key) ?? { target: record.target, label, runs: 0 };

			group.runs += 1;
			cacheGroups.set(key, group);
		}
	}

	if (results.meta.quick) {
		out.push('⚠ quick mode — not for publication');
	}

	if (results.meta.chiramiss.dirty) {
		out.push('⚠ working tree was dirty');
	}

	for (const group of errorGroups.values()) {
		out.push(`⚠ ${group.target} ${group.label}: ${group.errors} errors (sample: ${group.sample})`);
	}

	for (const group of cacheGroups.values()) {
		out.push(`⚠ cache hit suspected in ${group.target} ${group.label}: origin saw fewer page fetches than successful responses in ${group.runs} run(s)`);
	}

	return out;
}

function s1Table(results: BenchResults): string {
	const rows: string[][] = [];

	for (const kind of PAGE_KINDS) {
		for (const rttMs of S1_RTTS) {
			const cells: string[] = [`${kind}, rtt ${rttMs}ms`];

			for (const target of ['summaly', 'chiramiss'] as const) {
				const s = pooledLatency(runsOf(results, target, (r) => r.spec.scenario === 's1' && r.spec.pageKind === kind && r.spec.rttMs === rttMs));

				cells.push(fmt(s.p50), fmt(s.p95));
			}

			const spread = TARGETS.map((target) => {
				const p50s = runsOf(results, target, (r) => r.spec.scenario === 's1' && r.spec.pageKind === kind && r.spec.rttMs === rttMs)
					.map((r) => summarize(r.load.latenciesMs).p50);

				return p50s.length === 0 ? 'n/a' : `${fmt(Math.min(...p50s))}–${fmt(Math.max(...p50s))}`;
			});

			cells.push(`${fmt(ratio(results, kind, rttMs))}×`, `summaly ${spread[1]}; chiramiss ${spread[0]}`);
			rows.push(cells);
		}
	}

	return table(
		['S1 (ms)', 'summaly p50', 'summaly p95', 'chiramiss p50', 'chiramiss p95', 'ratio (p50)', 'run-to-run p50 range'],
		rows,
	);
}

function s2Table(results: BenchResults): string {
	const concurrencies = [...new Set(results.runs.filter((r) => r.spec.scenario === 's2')
		.map((r) => (r.spec.arrival.kind === 'closed' ? r.spec.arrival.concurrency : r.spec.requests)))].sort((a, b) => a - b);
	const rows = concurrencies.map((concurrency) => {
		const cells = [`concurrency ${concurrency}`];

		for (const target of ['summaly', 'chiramiss'] as const) {
			const records = runsOf(results, target, (r) => r.spec.scenario === 's2'
				&& (r.spec.arrival.kind === 'closed' ? r.spec.arrival.concurrency : r.spec.requests) === concurrency);
			const s = pooledLatency(records);
			const rps = mean(records.map((r) => (r.load.ok / r.load.wallMs) * 1000));
			const total = records.reduce((acc, r) => acc + r.load.ok + r.load.errors, 0);
			const errors = records.reduce((acc, r) => acc + r.load.errors, 0);

			cells.push(fmt(rps), fmt(s.p50), fmt(s.p99), `${fmt(total === 0 ? Number.NaN : (errors / total) * 100)}%`);
		}

		return cells;
	});
	const columns = (name: string): string[] => [`${name} req/s`, `${name} p50 (ms)`, `${name} p99 (ms)`, `${name} errors`];

	return table(['S2', ...columns('summaly'), ...columns('chiramiss')], rows);
}

function s3Table(results: BenchResults): string {
	const rows = ([['s3a', 'S3a (in-flight sharing)'], ['s3b', 'S3b (in-flight sharing + result cache)']] as const).map(([scenario, label]) => {
		const cells: string[] = [label];

		for (const target of ['summaly', 'chiramiss'] as const) {
			const records = runsOf(results, target, (r) => r.spec.scenario === scenario);
			const total = (r: RunRecord): number => Object.values(r.load.origin.requests).reduce((acc, v) => acc + v, 0);

			cells.push(
				fmt(mean(records.map(total)), 0),
				fmt(mean(records.map((r) => r.load.origin.bytesOut / KIB))),
				fmt(mean(records.map((r) => r.load.origin.newConnections)), 1),
				fmt(pooledLatency(records).p50),
			);
		}

		return cells;
	});
	const columns = (name: string): string[] => [`${name} origin requests`, `${name} origin KiB`, `${name} new connections`, `${name} p50 (ms)`];

	return table(['S3', ...columns('summaly'), ...columns('chiramiss')], rows);
}

function s4Table(results: BenchResults): string {
	const scenarios: Array<[ScenarioId, string]> = [['s1', 'S1'], ['s2', 'S2'], ['s3a', 'S3a'], ['s3b', 'S3b']];
	const rows = scenarios
		.filter(([scenario]) => results.runs.some((r) => r.spec.scenario === scenario))
		.map(([scenario, label]) => {
			const cells: string[] = [label];

			for (const target of ['summaly', 'chiramiss'] as const) {
				const records = runsOf(results, target, (r) => r.spec.scenario === scenario);

				cells.push(
					fmt(mean(records.map((r) => (r.load.ok === 0 ? Number.NaN : r.cpuUsageUsec / 1000 / r.load.ok))), 2),
					fmt(records.length === 0 ? Number.NaN : Math.max(...records.map((r) => r.memoryPeakBytes / MIB))),
				);
			}

			return cells;
		});

	return table(['S4', 'summaly CPU ms / summary', 'summaly peak MiB', 'chiramiss CPU ms / summary', 'chiramiss peak MiB'], rows);
}

function environment(results: BenchResults): string {
	const { meta } = results;
	const { host } = meta;

	return [
		`- Started: ${meta.startedAt}${meta.quick ? ' (quick mode)' : ''}`,
		`- chiramiss: commit ${meta.chiramiss.commit}${meta.chiramiss.tag === null ? '' : ` (tag ${meta.chiramiss.tag})`}, working tree ${meta.chiramiss.dirty ? 'dirty' : 'clean'}, Node ${meta.chiramiss.node}`,
		`- summaly: image ${meta.summaly.image}, digest ${meta.summaly.digest ?? 'unknown'}, Node ${meta.summaly.node}`,
		`- Limits per target: ${meta.limits.cpus} CPUs, ${meta.limits.memory} memory`,
		`- Host: ${host.cpuModel}, ${host.cpuCount} logical CPUs, ${fmt(host.totalMemBytes / 1024 ** 3)} GiB RAM, ${host.os}, Docker ${host.docker}`,
	].join('\n');
}

export function renderReport(results: BenchResults): string {
	const warned = warnings(results);
	const sections: string[] = [headline(results).join('\n')];

	if (warned.length > 0) {
		sections.push(warned.map((w) => `> ${w}`).join('\n>\n'));
	}

	sections.push(
		'### S1: one request at a time (latency, ms)',
		s1Table(results),
		'### S2: concurrent load (rtt 50ms, article)',
		s2Table(results),
		'### S3: same URL requested many times (rtt 50ms, oEmbed page)',
		s3Table(results),
		'### S4: resource use',
		'CPU time is the container CPU consumed per summary (mean over runs); peak memory is the maximum over runs.',
		s4Table(results),
		'### Notes',
		[
			'- Requests to different URLs on the same host reuse keep-alive connections and the favicon check cache; this is part of what is measured.',
			'- The origin is a fake server on a private network (`origin.bench`); no third-party site is contacted. `rtt` is a delay added at the origin by a TCP proxy, in milliseconds of round-trip time.',
			'- S1 and S2 use a distinct URL for every request, so neither target can answer from its result cache.',
		].join('\n'),
		'### Environment',
		environment(results),
	);

	return `${sections.join('\n\n')}\n`;
}
