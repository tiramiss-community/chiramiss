import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test } from 'vitest';
import { expectedFields, runLoad, warmup } from '../src/loadgen.ts';
import type { Expectation, LoadSpec } from '../src/types.ts';

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

const EXPECTED: Expectation = {
	title: 'T',
	description: 'D',
	icon: 'https://origin.bench/favicon.ico',
	thumbnail: 'https://origin.bench/image.png',
	sitename: 'S',
};

/** 要約させた URL（url パラメータ）を取り出す。 */
function summarizedUrl(req: IncomingMessage): string {
	return new URL(req.url ?? '/', 'http://x').searchParams.get('url') ?? '';
}

/** EXPECTED と一致する応答。overrides で一部のフィールドを壊す。 */
function okBody(req: IncomingMessage, overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		title: 'T',
		description: 'D',
		icon: 'https://origin.bench/favicon.ico',
		thumbnail: 'https://origin.bench/image.png',
		sitename: 'S',
		url: summarizedUrl(req),
		player: { url: 'https://p' },
		...overrides,
	});
}

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
		expected: EXPECTED,
		requestTimeoutMs: 2000,
		...overrides,
	};
}

test('closed arrival never exceeds concurrency', async () => {
	let active = 0;
	let max = 0;
	const target = await listen((req, res) => {
		active++;
		max = Math.max(max, active);
		setTimeout(() => {
			active--;
			res.writeHead(200, { 'content-type': 'application/json' }).end(okBody(req));
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
	const target = await listen((req, res) => {
		const now = performance.now();

		if (arrivals.length === 0) {
			first = now;
		}

		arrivals.push(now - first);
		res.writeHead(200).end(okBody(req));
	});
	const urls = Array.from({ length: 10 }, (_, i) => `https://origin.bench/article?n=${i}`);

	await runLoad(await baseSpec(target, { urls, arrival: { kind: 'spread', durationMs: 500 } }));
	arrivals.sort((a, b) => a - b);
	expect(arrivals).toHaveLength(10);
	arrivals.forEach((t, i) => expect(Math.abs(t - i * 50)).toBeLessThan(30));
});

test('wrong title, missing player, non-200 and timeout count as errors with samples', async () => {
	const target = await listen((req, res) => {
		const kind = new URL(summarizedUrl(req)).searchParams.get('k');

		if (kind === 'title') {
			res.writeHead(200).end(okBody(req, { title: 'X' }));
		} else if (kind === 'player') {
			res.writeHead(200).end(okBody(req, { player: { url: null } }));
		} else if (kind === 'status') {
			res.writeHead(500).end('x'.repeat(500));
		} else if (kind === 'ok') {
			res.writeHead(200).end(okBody(req));
		}
		// timeout: 何も返さない
	});
	const urls = ['title', 'player', 'status', 'timeout', 'ok'].map((k) => `https://origin.bench/a?k=${k}`);
	const result = await runLoad(await baseSpec(target, {
		urls,
		expected: { ...EXPECTED, playerUrl: 'https://p' },
		requestTimeoutMs: 200,
	}));

	expect(result.ok).toBe(1);
	expect(result.errors).toBe(4);
	expect(result.errorSamples).toHaveLength(4);
	expect(result.errorSamples.some((s) => s.startsWith('500 ') && s.length === 204)).toBe(true);
	expect(result.errorSamples.some((s) => s.includes('timeout'))).toBe(true);
});

test('responses that skip work count as errors even when the title matches', async () => {
	const broken: Record<string, Record<string, unknown>> = {
		'icon-null': { icon: null },
		'no-description': { description: undefined },
		'thumbnail-null': { thumbnail: null },
		'wrong-sitename': { sitename: 'origin' },
		'wrong-url': { url: 'https://origin.bench/elsewhere' },
	};
	const target = await listen((req, res) => {
		const kind = new URL(summarizedUrl(req)).searchParams.get('k') ?? '';

		res.writeHead(200).end(okBody(req, broken[kind] ?? {}));
	});
	const urls = [...Object.keys(broken), 'ok'].map((k) => `https://origin.bench/a?k=${k}`);
	const result = await runLoad(await baseSpec(target, { urls, arrival: { kind: 'closed', concurrency: 1 } }));

	expect(result.ok).toBe(1);
	expect(result.errors).toBe(5);
	expect(result.errorSamples).toEqual([
		'200 icon: expected "https://origin.bench/favicon.ico", got null',
		'200 description: expected "D", got undefined',
		'200 thumbnail: expected "https://origin.bench/image.png", got null',
		'200 sitename: expected "S", got "origin"',
		'200 url: expected "https://origin.bench/a?k=wrong-url", got "https://origin.bench/elsewhere"',
	]);
});

test('redirect expects the final url; {search} in icon is the summarized url query', async () => {
	const expected: Expectation = { ...EXPECTED, icon: 'https://origin.bench/favicon.ico{search}', finalPath: '/article' };

	expect(expectedFields(expected, 'https://origin.bench/redirect?n=a-1')).toEqual({
		title: 'T',
		description: 'D',
		icon: 'https://origin.bench/favicon.ico?n=a-1',
		thumbnail: 'https://origin.bench/image.png',
		sitename: 'S',
		url: 'https://origin.bench/article?n=a-1',
	});
	expect(expectedFields({ ...EXPECTED, playerUrl: 'https://p' }, 'https://origin.bench/a')).toMatchObject({
		'url': 'https://origin.bench/a',
		'player.url': 'https://p',
	});

	const target = await listen((req, res) => {
		const summarized = new URL(summarizedUrl(req));
		const final = new URL(summarized);

		final.pathname = '/article';
		// stay=1 はリダイレクトを追わなかった応答（url が元の URL のまま）を返す。
		res.writeHead(200).end(okBody(req, {
			icon: `https://origin.bench/favicon.ico${summarized.search}`,
			url: summarized.searchParams.has('stay') ? summarized.href : final.href,
		}));
	});
	const result = await runLoad(await baseSpec(target, {
		urls: ['https://origin.bench/redirect?n=1', 'https://origin.bench/redirect?n=2&stay=1'],
		arrival: { kind: 'closed', concurrency: 1 },
		expected,
	}));

	expect(result.ok).toBe(1);
	expect(result.errorSamples).toEqual([
		'200 url: expected "https://origin.bench/article?n=2&stay=1", got "https://origin.bench/redirect?n=2&stay=1"',
	]);
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
	const target = await listen((req, res) => {
		calls.push('GET target');
		res.writeHead(200).end(okBody(req));
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
		res.writeHead(200).end(okBody(req));
	});

	await runLoad(await baseSpec(target, { urls: ['https://origin.bench/a?x=1&y=2'] }));
	expect(seen).toBe(`/?url=${encodeURIComponent('https://origin.bench/a?x=1&y=2')}&lang=ja-JP`);
});

test('warmup sets rtt and drives load but returns nothing', async () => {
	const calls: string[] = [];
	const control = await fakeControl(calls);
	const target = await listen((req, res) => {
		calls.push('GET target');
		res.writeHead(200).end(okBody(req));
	});

	await expect(warmup(await baseSpec(target, { originControlUrl: control, urls: ['https://origin.bench/a'] }))).resolves.toBeUndefined();
	expect(calls).toContain('PUT /rtt');
	expect(calls).toContain('GET target');
});
