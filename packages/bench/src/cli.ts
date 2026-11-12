import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCgroup } from './cgroup.ts';
import { compose, execCommand, imageDigest, nodeVersionOfImage, pullImage } from './docker.ts';
import { expectationFor } from './fixtures.ts';
import { renderReport } from './report.ts';
import { buildPlan, urlsFor, warmupUrlsFor } from './scenarios.ts';
import { summarize } from './stats.ts';
import { SERVICE, targetEnv } from './targets.ts';
import type { BenchMeta, BenchResults, LoadResult, LoadSpec, RunRecord, RunSpec, TargetName } from './types.ts';

const BENCH_DIR = fileURLToPath(new URL('..', import.meta.url));
const CHIRAMISS_IMAGE = 'chiramiss-bench:local';
const ORIGIN_CONTROL_URL = 'http://origin.bench:9000/';
const TARGETS: readonly TargetName[] = ['chiramiss', 'summaly'];
// ターゲット側の SUMMALY_OPERATION_TIMEOUT（60 秒）より長くし、先にターゲットがタイムアウトを返すようにする。
const REQUEST_TIMEOUT_MS = 90_000;
const CONTAINER_LOG_LINES = 40;

const USAGE = `usage: pnpm bench [options]

  --quick                 small plan for a smoke run (not for publication)
  --runs <n>              repetitions of every scenario (default: 3, or 1 with --quick)
  --summaly-image <ref>   summaly image to compare with (default: ghcr.io/misskey-dev/summaly:5.6.0)
  --cpus <n>              CPU limit of each target container (default: 2)
  --memory <size>         memory limit of each target container, e.g. 1g, 512m (default: 1g)
  --subnet <cidr>         subnet of the bench network (default: 172.30.250.0/24)
  --out <dir>             output directory (default: results/<YYYYMMDD-HHmmss>-<short sha>)
`;

interface CliOptions {
	quick: boolean;
	runs: number;
	summalyImage: string;
	cpus: string;
	memory: string;
	subnet: string;
	out: string | null;
}

function parseArgs(argv: string[]): CliOptions | null {
	let quick = false;
	let runs: number | null = null;
	let summalyImage = 'ghcr.io/misskey-dev/summaly:5.6.0';
	let cpus = '2';
	let memory = '1g';
	let subnet = '172.30.250.0/24';
	let out: string | null = null;
	const args = [...argv];

	const value = (name: string, pattern: RegExp, hint: string): string => {
		const v = args.shift();

		if (v === undefined || !pattern.test(v)) {
			throw new Error(`${name} expects ${hint}, got ${v === undefined ? 'nothing' : JSON.stringify(v)}\n\n${USAGE}`);
		}

		return v;
	};

	while (args.length > 0) {
		const arg = args.shift() as string;

		switch (arg) {
			// pnpm がスクリプトに `--` をそのまま渡すことがあるので読み飛ばす。
			case '--':
				break;
			case '--help':
			case '-h':
				return null;
			case '--quick':
				quick = true;
				break;
			case '--runs':
				runs = Number(value(arg, /^[1-9]\d*$/, 'a positive integer'));
				break;
			case '--summaly-image':
				summalyImage = value(arg, /^\S+$/, 'an image reference');
				break;
			case '--cpus':
				cpus = value(arg, /^(?!0+(\.0*)?$)\d+(\.\d+)?$/, 'a positive number');
				break;
			case '--memory':
				memory = value(arg, /^[1-9]\d*[bkmg]?$/i, 'a size such as 1g or 512m');
				break;
			case '--subnet':
				subnet = value(arg, /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, 'an IPv4 CIDR');
				break;
			case '--out':
				out = value(arg, /./, 'a directory');
				break;
			default:
				throw new Error(`unknown argument: ${arg}\n\n${USAGE}`);
		}
	}

	return { quick, runs: runs ?? (quick ? 1 : 3), summalyImage, cpus, memory, subnet, out };
}

function log(line: string): void {
	process.stderr.write(`${line}\n`);
}

function timestamp(date: Date): string {
	const pad = (n: number): string => String(n).padStart(2, '0');

	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function gitInfo(): Promise<{ commit: string; tag: string | null; dirty: boolean }> {
	const git = (...args: string[]): Promise<string> => execCommand('git', ['-C', BENCH_DIR, ...args]);
	const commit = (await git('rev-parse', 'HEAD')).trim();
	const tag = await git('describe', '--tags', '--exact-match').then((s) => s.trim(), () => null);
	const dirty = (await git('status', '--porcelain')).trim() !== '';

	return { commit, tag, dirty };
}

/** compose は env_file を全サービスについて解決するので、最初の compose より前に両方を書き出す。 */
function writeEnvFiles(subnet: string): void {
	for (const target of TARGETS) {
		const lines = Object.entries(targetEnv(target, subnet)).map(([k, v]) => `${k}=${v}\n`);

		writeFileSync(join(BENCH_DIR, `.env.${target}`), lines.join(''));
	}
}

function describeRun(spec: RunSpec, runs: number): string {
	const arrival = spec.arrival.kind === 'closed'
		? (spec.arrival.concurrency > 1 ? ` c=${spec.arrival.concurrency}` : '')
		: ` spread=${spec.arrival.durationMs}ms`;

	return `${spec.scenario} ${spec.pageKind} rtt=${spec.rttMs}${arrival} n=${spec.requests} run ${spec.runIndex + 1}/${runs}`;
}

function loadSpecs(spec: RunSpec, target: TargetName): { warmup: LoadSpec; run: LoadSpec } {
	const common = {
		targetBaseUrl: `http://${SERVICE[target]}:3000/`,
		originControlUrl: ORIGIN_CONTROL_URL,
		rttMs: spec.rttMs,
		requestTimeoutMs: REQUEST_TIMEOUT_MS,
	};

	return {
		warmup: {
			...common,
			urls: warmupUrlsFor(spec, target),
			// 暖機は計測と同じ同時実行数で行う。spread は 1 件ずつ流す。
			arrival: { kind: 'closed', concurrency: spec.arrival.kind === 'closed' ? spec.arrival.concurrency : 1 },
			expected: expectationFor('article'),
		},
		run: {
			...common,
			urls: urlsFor(spec, target),
			arrival: spec.arrival,
			expected: expectationFor(spec.pageKind),
		},
	};
}

/** 失敗したステップの名前を付けて投げ直す。 */
async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
	}
}

async function runOne(
	target: TargetName,
	spec: RunSpec,
	env: Record<string, string>,
): Promise<RunRecord> {
	const service = SERVICE[target];
	const specs = loadSpecs(spec, target);
	const readCgroup = async (): Promise<{ cpuUsageUsec: number; memoryPeakBytes: number }> => {
		const out = await compose(['exec', '-T', service, 'cat', '/sys/fs/cgroup/cpu.stat', '/sys/fs/cgroup/memory.peak'], env);
		const lines = out.trimEnd().split('\n');
		const memoryPeak = lines.pop() ?? '';

		return parseCgroup(lines.join('\n'), memoryPeak);
	};

	await step('start (up --wait)', () => compose(['up', '-d', '--force-recreate', '--wait', service], env));
	await step('warmup', () => compose(['run', '--rm', '-T', 'loadgen', 'warmup', JSON.stringify(specs.warmup)], env));

	const before = await step('read cgroup before run', readCgroup);
	const out = await step('run', () => compose(['run', '--rm', '-T', 'loadgen', 'run', JSON.stringify(specs.run)], env));
	const after = await step('read cgroup after run', readCgroup);
	const load = await step('parse loadgen output', async () => JSON.parse(out.trim().split('\n').pop() ?? '') as LoadResult);

	await step('stop', () => compose(['stop', service], env));

	return {
		target,
		spec,
		load,
		cpuUsageUsec: after.cpuUsageUsec - before.cpuUsageUsec,
		memoryPeakBytes: after.memoryPeakBytes,
	};
}

async function containerLogs(service: string, env: Record<string, string>): Promise<string> {
	try {
		const logs = await compose(['logs', '--no-color', '--tail', String(CONTAINER_LOG_LINES), service], env);

		return logs.trim() === '' ? '' : `\nlast ${CONTAINER_LOG_LINES} log lines of ${service}:\n${logs.trimEnd()}`;
	} catch {
		return '';
	}
}

async function hostInfo(): Promise<BenchMeta['host']> {
	const cpus = os.cpus();
	const docker = (await execCommand('docker', ['version', '--format', '{{.Server.Version}}'])).trim();

	return {
		cpuModel: cpus[0]?.model ?? 'unknown',
		cpuCount: cpus.length,
		totalMemBytes: os.totalmem(),
		os: `${os.type()} ${os.release()}`,
		docker,
	};
}

export async function main(argv: string[]): Promise<void> {
	const opts = parseArgs(argv);

	if (opts === null) {
		process.stdout.write(USAGE);

		return;
	}

	let interrupted = false;
	const onSigint = (): void => {
		if (interrupted) {
			process.exit(130);
		}

		interrupted = true;
		log('interrupted; cleaning up (press Ctrl-C again to quit immediately)');
	};
	const checkInterrupted = (): void => {
		if (interrupted) {
			throw new Error('interrupted');
		}
	};

	process.on('SIGINT', onSigint);

	try {
		const startedAt = new Date();
		const git = await gitInfo();
		const host = await hostInfo();
		const outDir = opts.out === null
			? join(BENCH_DIR, 'results', `${timestamp(startedAt)}-${git.commit.slice(0, 7)}`)
			: resolve(process.env.INIT_CWD ?? process.cwd(), opts.out);
		const plan = buildPlan({ runs: opts.runs, quick: opts.quick });

		log(`summaly image: ${opts.summalyImage}`);
		await pullImage(opts.summalyImage);

		const summalyNode = await step(`summaly image ${opts.summalyImage}`, () => nodeVersionOfImage(opts.summalyImage));
		const summalyDigest = await step(`summaly image ${opts.summalyImage}`, () => imageDigest(opts.summalyImage));
		const env: Record<string, string> = {
			BENCH_SUBNET: opts.subnet,
			BENCH_CPUS: opts.cpus,
			BENCH_MEMORY: opts.memory,
			BENCH_NODE_IMAGE: `node:${summalyNode}-slim`,
			SUMMALY_IMAGE: opts.summalyImage,
		};

		writeEnvFiles(opts.subnet);
		checkInterrupted();

		try {
			// 前回中断したときの残りを片付けてから始める。
			await compose(['down', '-v', '--remove-orphans'], env);
			log(`building chiramiss with ${env.BENCH_NODE_IMAGE}`);
			await step('chiramiss image build', () => compose(['build', 'chiramiss'], env));

			const chiramissNode = await step(`chiramiss image ${CHIRAMISS_IMAGE}`, () => nodeVersionOfImage(CHIRAMISS_IMAGE));

			await step('origin start', () => compose(['up', '-d', '--wait', 'origin'], env));

			const runs: RunRecord[] = [];
			const total = plan.length * TARGETS.length;

			for (const target of TARGETS) {
				for (const spec of plan) {
					const label = `${target} ${describeRun(spec, opts.runs)}`;
					const startedMs = performance.now();

					checkInterrupted();
					process.stderr.write(`[${runs.length + 1}/${total}] ${label} ... `);

					try {
						const record = await runOne(target, spec, env);
						const p50 = summarize(record.load.latenciesMs).p50;

						runs.push(record);
						log(`ok=${record.load.ok} errors=${record.load.errors} p50=${p50.toFixed(1)}ms (${((performance.now() - startedMs) / 1000).toFixed(1)}s)`);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);

						log('failed');
						throw new Error(`${label} failed at ${message}${await containerLogs(SERVICE[target], env)}`, { cause: error });
					}
				}
			}

			const results: BenchResults = {
				meta: {
					startedAt: startedAt.toISOString(),
					host,
					limits: { cpus: opts.cpus, memory: opts.memory },
					chiramiss: { ...git, node: chiramissNode },
					summaly: { image: opts.summalyImage, digest: summalyDigest, node: summalyNode },
					quick: opts.quick,
				},
				runs,
			};

			mkdirSync(outDir, { recursive: true });
			writeFileSync(join(outDir, 'results.json'), `${JSON.stringify(results, null, '\t')}\n`);
			writeFileSync(join(outDir, 'report.md'), renderReport(results));
			log(`results: ${outDir}`);
		} finally {
			log('cleaning up (docker compose down -v)');
			await compose(['down', '-v', '--remove-orphans'], env).catch((error: unknown) => {
				log(`cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
			});
		}
	} finally {
		process.off('SIGINT', onSigint);
	}
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2)).catch((error: unknown) => {
		log(`bench failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
