import { pagePath, PAGE_KINDS } from './fixtures.ts';
import { S1_PAGE_KINDS } from './scenarios.ts';
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

function s1Runs(results: BenchResults, target: TargetName, kind: PageKind, rttMs: number): RunRecord[] {
	return runsOf(results, target, (r) => r.spec.scenario === 's1' && r.spec.pageKind === kind && r.spec.rttMs === rttMs);
}

/** `count` の合計を、送った要約リクエストの数（成功と失敗の合計）で割る。 */
function perSummary(records: RunRecord[], count: (record: RunRecord) => number): number {
	const summaries = records.reduce((acc, r) => acc + r.load.ok + r.load.errors, 0);

	return summaries === 0 ? Number.NaN : records.reduce((acc, r) => acc + count(r), 0) / summaries;
}

function originRequests(record: RunRecord): number {
	return Object.values(record.load.origin.requests).reduce((acc, v) => acc + v, 0);
}

function faviconChecks(record: RunRecord): number {
	return record.load.origin.requests['HEAD /favicon.ico'] ?? 0;
}

function kindLabel(kind: PageKind): string {
	return kind === 'article-unique-icon' ? 'article, unique favicon URL' : kind;
}

function runLabel(record: RunRecord): string {
	const { spec } = record;

	if (spec.scenario === 's1') {
		return `S1 ${kindLabel(spec.pageKind)} rtt ${spec.rttMs}ms`;
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
	const pick = (target: TargetName): number => pooledLatency(s1Runs(results, target, kind, rttMs)).p50;

	return pick('summaly') / pick('chiramiss');
}

function headline(results: BenchResults): string[] {
	const x = ratio(results, 'article', 0);
	const ratios = PAGE_KINDS.map((kind) => ratio(results, kind, 0)).filter((v) => Number.isFinite(v));
	const favicon = (target: TargetName): number => perSummary(s1Runs(results, target, 'article', 0), faviconChecks);
	let conditions = 'median, no added network latency — the cost of summarizing itself';

	// favicon 確認のキャッシュで chiramiss が origin への HEAD を省いているなら、その条件を見出しの文の中に書く。
	if (favicon('chiramiss') < favicon('summaly')) {
		conditions += `; includes chiramiss's favicon-check cache: per page, summaly sent ${fmt(favicon('summaly'))} \`HEAD /favicon.ico\` and chiramiss ${fmt(favicon('chiramiss'))}`;
	}

	const lines = [`**chiramiss summarizes a typical article page ${fmt(x)}× faster than summaly** (${conditions}).`];
	const uncached = ratio(results, 'article-unique-icon', 0);

	if (Number.isFinite(uncached)) {
		lines.push('', `With a favicon URL unique to every page, so that chiramiss's favicon-check cache cannot answer: ${fmt(uncached)}×.`);
	}

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
	const kinds = S1_PAGE_KINDS.filter((kind) => results.runs.some((r) => r.spec.scenario === 's1' && r.spec.pageKind === kind));

	for (const kind of kinds) {
		for (const rttMs of S1_RTTS) {
			const cells: string[] = [`${kindLabel(kind)}, rtt ${rttMs}ms`];

			for (const target of ['summaly', 'chiramiss'] as const) {
				const records = s1Runs(results, target, kind, rttMs);
				const s = pooledLatency(records);

				cells.push(
					fmt(s.p50),
					fmt(s.p95),
					fmt(perSummary(records, originRequests)),
					fmt(perSummary(records, (r) => r.load.origin.newConnections)),
				);
			}

			const spread = TARGETS.map((target) => {
				const p50s = s1Runs(results, target, kind, rttMs).map((r) => summarize(r.load.latenciesMs).p50);

				return p50s.length === 0 ? 'n/a' : `${fmt(Math.min(...p50s))}–${fmt(Math.max(...p50s))}`;
			});

			cells.push(`${fmt(ratio(results, kind, rttMs))}×`, `summaly ${spread[1]}; chiramiss ${spread[0]}`);
			rows.push(cells);
		}
	}

	const columns = (name: string): string[] => [`${name} p50`, `${name} p95`, `${name} origin requests / summary`, `${name} new connections / summary`];

	return table(['S1 (ms)', ...columns('summaly'), ...columns('chiramiss'), 'ratio (p50)', 'run-to-run p50 range'], rows);
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

/**
 * 計測区間のメモリのピーク（MiB）。memory.peak はコンテナの起動からの値なので、計測区間に入ってから上がったランだけが
 * その区間のピークを正確に示す。上がらなかったランについて分かるのは「起動と暖機のピーク以下」だけなので、
 * それが答えを左右するときは `≤` を付けて上限として出す。
 */
function runMemoryPeak(records: RunRecord[]): string {
	if (records.length === 0) {
		return 'n/a';
	}

	const raised = records.filter((r) => r.memoryPeakBytes > r.memoryPeakBeforeRunBytes).map((r) => r.memoryPeakBytes);
	const bounded = records.filter((r) => r.memoryPeakBytes <= r.memoryPeakBeforeRunBytes).map((r) => r.memoryPeakBytes);
	const exact = Math.max(...raised);
	const bound = Math.max(...bounded);

	return bound <= exact ? fmt(exact / MIB) : `≤ ${fmt(bound / MIB)}`;
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
					runMemoryPeak(records),
				);
			}

			return cells;
		});

	return table(['S4', 'summaly CPU ms / summary', 'summaly peak MiB', 'chiramiss CPU ms / summary', 'chiramiss peak MiB'], rows);
}

function notes(results: BenchResults): string {
	const perTarget = (kind: PageKind, count: (record: RunRecord) => number): Record<TargetName, number> => ({
		chiramiss: perSummary(s1Runs(results, 'chiramiss', kind, 0), count),
		summaly: perSummary(s1Runs(results, 'summaly', kind, 0), count),
	});
	const lines: string[] = [];
	const favicon = perTarget('article', faviconChecks);
	const requests = perTarget('article', originRequests);
	const connections = perTarget('article', (r) => r.load.origin.newConnections);
	const largeBytes = perTarget('large', (r) => r.load.origin.bytesOut / MIB);

	if (TARGETS.every((target) => Number.isFinite(favicon[target]))) {
		const parts = [`- Favicon check (S1, article, rtt 0ms): per summary, summaly sent ${fmt(favicon.summaly)} \`HEAD /favicon.ico\` and chiramiss ${fmt(favicon.chiramiss)}.`];

		if (favicon.chiramiss < favicon.summaly) {
			parts.push('chiramiss caches the result of a favicon check per favicon URL for 5 minutes. Every page here links the same `/favicon.ico`, so after the warmup chiramiss answers the check from that cache, while summaly checks again for every page. This is production behaviour for pages of one site, not the cost of an isolated summary.');
		}

		if (results.runs.some((r) => r.spec.scenario === 's1' && r.spec.pageKind === 'article-unique-icon')) {
			parts.push('The "article, unique favicon URL" rows give every page its own favicon URL so that the cache cannot answer; the difference from the "article" rows is what the cache saves.');
		}

		lines.push(parts.join(' '));
	}

	if (TARGETS.every((target) => Number.isFinite(requests[target]))) {
		lines.push(`- Connections (S1, article, rtt 0ms): per summary, summaly made ${fmt(requests.summaly)} origin requests over ${fmt(connections.summaly)} new connections, chiramiss ${fmt(requests.chiramiss)} over ${fmt(connections.chiramiss)}. Fewer than 1.0 new connections per summary would mean connections were reused from one summary to the next. The S1 table lists both numbers for every page.`);
	}

	if (TARGETS.every((target) => Number.isFinite(largeBytes[target]))) {
		// 両者がほぼ同じバイト数を受け取ったときだけ「どちらもページ全体を取得した」と書ける。
		const wholePage = largeBytes.chiramiss >= 0.95 * largeBytes.summaly
			? ', so both downloaded the whole page. chiramiss tokenizes the HTML only up to `</head>` and stops; summaly parses the whole document. Most of this gap is parsing work that chiramiss skips.'
			: '. chiramiss tokenizes the HTML only up to `</head>` and stops; summaly parses the whole document.';

		lines.push(`- Large page (${fmt(ratio(results, 'large', 0))}× at rtt 0ms): the page is a short \`<head>\` followed by about 1.5 MB of body. The origin sent ${fmt(largeBytes.summaly, 2)} MiB per summary to summaly and ${fmt(largeBytes.chiramiss, 2)} MiB to chiramiss${wholePage}`);
	}

	lines.push(
		'- The origin is a fake server on a private network (`origin.bench`); no third-party site is contacted. `rtt` is a delay added at the origin by a TCP proxy, in milliseconds of round-trip time.',
		'- S1 and S2 use a distinct URL for every request, so neither target can answer from its result cache.',
	);

	return lines.join('\n');
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
		[
			'CPU time is the container CPU consumed per summary while the measured requests ran (mean over runs; startup and warmup excluded).',
			'Peak memory is the highest memory use of the container while the measured requests ran (maximum over runs), from the cgroup\'s `memory.peak`.',
			'`memory.peak` counts from the container\'s start, so when the measured requests never went above the peak already reached during startup and warmup, only an upper bound is known: those cells read `≤ N`, where N is that earlier peak.',
		].join(' '),
		s4Table(results),
		'### Notes',
		notes(results),
		'### Environment',
		environment(results),
	);

	return `${sections.join('\n\n')}\n`;
}
