import { Agent, request } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import type { LoadResult, LoadSpec, OriginStats } from './types.ts';

const MAX_ERROR_SAMPLES = 5;
const SAMPLE_BODY_LENGTH = 200;

interface HttpResult { status: number; body: string }

function httpCall(agent: Agent | undefined, method: string, url: string, timeoutMs: number): Promise<HttpResult> {
	return new Promise((resolve, reject) => {
		const req = request(url, { method, agent }, (res) => {
			const chunks: Buffer[] = [];

			res.on('data', (chunk: Buffer) => chunks.push(chunk));
			res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
			res.on('error', reject);
		});

		req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
		req.on('error', reject);
		req.end();
	});
}

async function control(spec: LoadSpec, method: string, path: string): Promise<HttpResult> {
	const res = await httpCall(undefined, method, new URL(path, spec.originControlUrl).toString(), 10_000);

	if (res.status < 200 || res.status >= 300) {
		throw new Error(`origin control ${method} ${path} failed: ${res.status}`);
	}

	return res;
}

type Outcome = { ok: true; latencyMs: number } | { ok: false; sample: string };

function validate(spec: LoadSpec, res: HttpResult): string | null {
	const head = `${res.status} ${res.body.slice(0, SAMPLE_BODY_LENGTH)}`;

	if (res.status !== 200) {
		return head;
	}

	let json: { title?: unknown; player?: { url?: unknown } | null } | null;

	try {
		json = JSON.parse(res.body) as typeof json;
	} catch {
		return head;
	}

	if (json === null || typeof json !== 'object' || json.title !== spec.expected.title) {
		return head;
	}

	if (spec.expected.playerUrl !== undefined && json.player?.url !== spec.expected.playerUrl) {
		return head;
	}

	return null;
}

async function summarizeOne(spec: LoadSpec, agent: Agent, url: string): Promise<Outcome> {
	const target = `${spec.targetBaseUrl}?url=${encodeURIComponent(url)}&lang=ja-JP`;
	const startedAt = performance.now();

	try {
		const res = await httpCall(agent, 'GET', target, spec.requestTimeoutMs);
		const latencyMs = performance.now() - startedAt;
		const failure = validate(spec, res);

		return failure === null ? { ok: true, latencyMs } : { ok: false, sample: failure };
	} catch (error) {
		return { ok: false, sample: `0 ${error instanceof Error ? error.message : String(error)}`.slice(0, SAMPLE_BODY_LENGTH + 4) };
	}
}

async function generate(spec: LoadSpec): Promise<{ outcomes: Outcome[]; wallMs: number }> {
	const { arrival, urls } = spec;
	const agent = new Agent({
		keepAlive: true,
		maxSockets: arrival.kind === 'closed' ? arrival.concurrency : urls.length,
	});
	const outcomes: Outcome[] = [];
	const startedAt = performance.now();

	try {
		if (arrival.kind === 'closed') {
			let next = 0;
			const worker = async (): Promise<void> => {
				while (next < urls.length) {
					const url = urls[next++] as string;

					outcomes.push(await summarizeOne(spec, agent, url));
				}
			};

			await Promise.all(Array.from({ length: Math.min(arrival.concurrency, urls.length) }, worker));
		} else {
			await Promise.all(urls.map(async (url, i) => {
				const delay = startedAt + (i * arrival.durationMs) / urls.length - performance.now();

				if (delay > 0) {
					await sleep(delay);
				}

				outcomes.push(await summarizeOne(spec, agent, url));
			}));
		}
	} finally {
		agent.destroy();
	}

	return { outcomes, wallMs: performance.now() - startedAt };
}

async function prepare(spec: LoadSpec): Promise<void> {
	await control(spec, 'PUT', `/rtt?ms=${spec.rttMs}`);
	await control(spec, 'POST', '/reset');
}

export async function runLoad(spec: LoadSpec): Promise<LoadResult> {
	await prepare(spec);

	const { outcomes, wallMs } = await generate(spec);
	const origin = JSON.parse((await control(spec, 'GET', '/stats')).body) as OriginStats;
	const latenciesMs: number[] = [];
	const errorSamples: string[] = [];
	let errors = 0;

	for (const outcome of outcomes) {
		if (outcome.ok) {
			latenciesMs.push(outcome.latencyMs);
		} else {
			errors++;

			if (errorSamples.length < MAX_ERROR_SAMPLES) {
				errorSamples.push(outcome.sample);
			}
		}
	}

	return { latenciesMs, ok: latenciesMs.length, errors, errorSamples, wallMs, origin };
}

/** origin の rtt 設定と負荷だけを行い、結果は捨てる。 */
export async function warmup(spec: LoadSpec): Promise<void> {
	await prepare(spec);
	await generate(spec);
}
