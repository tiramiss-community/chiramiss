import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test } from 'vitest';
import { runLoad, warmup } from '../src/loadgen.ts';
import type { LoadSpec } from '../src/types.ts';

const servers: Server[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => {
		s.closeAllConnections();
		s.close(() => resolve());
	})));
});

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
	const server = createServer(handler);

	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

	return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

const okBody = JSON.stringify({ title: 'T', player: { url: 'https://p' } });

async function fakeControl(calls: string[] = []): Promise<string> {
	return listen((req, res) => {
		calls.push(`${req.method} ${new URL(req.url ?? '/', 'http://x').pathname}`);
		res.writeHead(req.method === 'GET' ? 200 : 204);
		res.end(req.method === 'GET' ? JSON.stringify({ requests: { 'GET /article': 7 }, newConnections: 1, bytesOut: 2 }) : undefined);
	});
}

async function baseSpec(targetBaseUrl: string, overrides: Partial<LoadSpec> = {}): Promise<LoadSpec> {
	return {
		targetBaseUrl,
		originControlUrl: await fakeControl(),
		rttMs: 0,
		urls: Array.from({ length: 4 }, (_, i) => `https://origin.bench/article?n=${i}`),
		arrival: { kind: 'closed', concurrency: 2 },
		expected: { title: 'T' },
		requestTimeoutMs: 2000,
		...overrides,
	};
}

test('closed arrival never exceeds concurrency', async () => {
	let active = 0;
	let max = 0;
	const target = await listen((_req, res) => {
		active++;
		max = Math.max(max, active);
		setTimeout(() => {
			active--;
			res.writeHead(200, { 'content-type': 'application/json' }).end(okBody);
		}, 20);
	});
	const urls = Array.from({ length: 50 }, (_, i) => `https://origin.bench/article?n=${i}`);
	const result = await runLoad(await baseSpec(target, { urls, arrival: { kind: 'closed', concurrency: 4 } }));

	expect(max).toBe(4);
	expect(result.ok).toBe(50);
	expect(result.latenciesMs).toHaveLength(50);
});

test('spread arrival sends at even offsets', async () => {
	const arrivals: number[] = [];
	let first = 0;
	const target = await listen((_req, res) => {
		const now = performance.now();

		if (arrivals.length === 0) {
			first = now;
		}

		arrivals.push(now - first);
		res.writeHead(200).end(okBody);
	});
	const urls = Array.from({ length: 10 }, (_, i) => `https://origin.bench/article?n=${i}`);

	await runLoad(await baseSpec(target, { urls, arrival: { kind: 'spread', durationMs: 500 } }));
	arrivals.sort((a, b) => a - b);
	expect(arrivals).toHaveLength(10);
	arrivals.forEach((t, i) => expect(Math.abs(t - i * 50)).toBeLessThan(30));
});

test('wrong title, missing player, non-200 and timeout count as errors with samples', async () => {
	const target = await listen((req, res) => {
		const kind = new URL(new URL(req.url ?? '/', 'http://x').searchParams.get('url') ?? '').searchParams.get('k');

		if (kind === 'title') {
			res.writeHead(200).end(JSON.stringify({ title: 'X', player: { url: 'https://p' } }));
		} else if (kind === 'player') {
			res.writeHead(200).end(JSON.stringify({ title: 'T', player: { url: null } }));
		} else if (kind === 'status') {
			res.writeHead(500).end('x'.repeat(500));
		} else if (kind === 'ok') {
			res.writeHead(200).end(okBody);
		}
		// timeout: 何も返さない
	});
	const urls = ['title', 'player', 'status', 'timeout', 'ok'].map((k) => `https://origin.bench/a?k=${k}`);
	const result = await runLoad(await baseSpec(target, {
		urls,
		expected: { title: 'T', playerUrl: 'https://p' },
		requestTimeoutMs: 200,
	}));

	expect(result.ok).toBe(1);
	expect(result.errors).toBe(4);
	expect(result.errorSamples).toHaveLength(4);
	expect(result.errorSamples.some((s) => s.startsWith('500 ') && s.length === 204)).toBe(true);
	expect(result.errorSamples.some((s) => s.includes('timeout'))).toBe(true);
});

test('caps error samples at 5', async () => {
	const target = await listen((_req, res) => {
		res.writeHead(404).end('nope');
	});
	const result = await runLoad(await baseSpec(target, {
		urls: Array.from({ length: 8 }, (_, i) => `https://origin.bench/a?n=${i}`),
	}));

	expect(result.errors).toBe(8);
	expect(result.errorSamples).toHaveLength(5);
});

test('resets origin stats before load and returns stats after', async () => {
	const calls: string[] = [];
	const control = await fakeControl(calls);
	const target = await listen((_req, res) => {
		calls.push('GET target');
		res.writeHead(200).end(okBody);
	});
	const result = await runLoad(await baseSpec(target, {
		originControlUrl: control,
		rttMs: 80,
		urls: ['https://origin.bench/a'],
	}));

	expect(calls).toEqual(['PUT /rtt', 'POST /reset', 'GET target', 'GET /stats']);
	expect(result.origin).toEqual({ requests: { 'GET /article': 7 }, newConnections: 1, bytesOut: 2 });
});

test('requests target with encoded url and lang', async () => {
	let seen = '';
	const target = await listen((req, res) => {
		seen = req.url ?? '';
		res.writeHead(200).end(okBody);
	});

	await runLoad(await baseSpec(target, { urls: ['https://origin.bench/a?x=1&y=2'] }));
	expect(seen).toBe(`/?url=${encodeURIComponent('https://origin.bench/a?x=1&y=2')}&lang=ja-JP`);
});

test('warmup sets rtt and drives load but returns nothing', async () => {
	const calls: string[] = [];
	const control = await fakeControl(calls);
	const target = await listen((_req, res) => {
		calls.push('GET target');
		res.writeHead(200).end(okBody);
	});

	await expect(warmup(await baseSpec(target, { originControlUrl: control, urls: ['https://origin.bench/a'] }))).resolves.toBeUndefined();
	expect(calls).toContain('PUT /rtt');
	expect(calls).toContain('GET target');
});
