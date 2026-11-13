// Derived from misskey-dev/summaly (MIT)
import { readFileSync } from 'node:fs';
import http, { Agent as httpAgent } from 'node:http';
import { Agent as httpsAgent } from 'node:https';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createSummarizer, defaultSummarizeOptions } from '@/index.js';
import { StatusError } from '@/http/status-error.js';
import type { GeneralScrapingOptions, Summary, SummaryPlugin } from '@/types.js';
import { DEFAULT_BOT_UA } from '@/version.js';
import { loopbackAgents } from './helpers/loopback-agent.js';
import { startTestServer, type TestServer } from './helpers/test-server.js';

/** These tests serve different content at the same URL, so results must not be cached across calls. */
const summarize = createSummarizer({ cache: false });

/** Replaces upstream's SUMMALY_ALLOW_PRIVATE_IP=true for tests that do not exercise the env var itself. */
const allowedPrivateNetworks = ['127.0.0.0/8', '::1/128'];

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

const servers: TestServer[] = [];
const cleanups: (() => void)[] = [];
const ALLOW_PRIVATE_IP_VARS = ['CHIRAMISS_ALLOW_PRIVATE_IP', 'SUMMALY_ALLOW_PRIVATE_IP'] as const;
const originalAllowPrivateIp = ALLOW_PRIVATE_IP_VARS.map(name => [name, process.env[name]] as const);

beforeEach(() => {
	for (const name of ALLOW_PRIVATE_IP_VARS) {
		delete process.env[name];
	}
});

afterEach(async () => {
	for (const [name, value] of originalAllowPrivateIp) {
		if (value === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = value;
		}
	}
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
	await Promise.all(servers.splice(0).map(s => s.close()));
});

/** Starts a test server on an ephemeral port and returns its origin such as `http://127.0.0.1:12345`. */
async function serve(handler: Handler, host?: string): Promise<string> {
	const server = await startTestServer(handler, host);

	servers.push(server);

	return server.url.replace(/\/$/, '');
}

function fixture(path: string): Buffer {
	return readFileSync(new URL(`./fixtures/${path}`, import.meta.url));
}

/** Like the upstream fastify `app.get('/')` routes: `/` (GET and HEAD) gets `handler`, anything else is 404. */
function onlyRoot(handler: Handler): Handler {
	return (req, res) => {
		if (new URL(req.url ?? '/', 'http://localhost').pathname === '/') {
			handler(req, res);
		} else {
			res.writeHead(404).end();
		}
	};
}

function sendWithLength(res: http.ServerResponse, content: Buffer) {
	res.writeHead(200, { 'content-length': content.byteLength, 'content-type': 'text/html' });
	res.end(content);
}

/** Sends the body without content-length (chunked), like upstream's `reply.send(stream)`. */
function sendStream(res: http.ServerResponse, chunks: Buffer[]) {
	res.writeHead(200, { 'content-type': 'text/html' });
	for (const chunk of chunks) {
		res.write(chunk);
	}
	res.end();
}

/** An agent that records the port of every connection it opens. */
function hookedAgent(): { agent: http.Agent; ports: number[] } {
	const agent = new http.Agent();
	const ports: number[] = [];
	const original = agent.createConnection.bind(agent);

	agent.createConnection = ((...args: Parameters<typeof original>) => {
		ports.push(Number(args[0].port));

		return original(...args);
	}) as typeof agent.createConnection;
	cleanups.push(() => agent.destroy());

	return { agent, ports };
}

describe('network tests', () => {
	test('Should block localhost by default', async () => {
		const content = fixture('htmls/basic.html');
		const host = await serve((_req, res) => sendWithLength(res, content));

		const summary = await summarize(host).catch((e: StatusError) => e);

		if (summary instanceof StatusError) {
			expect(summary.name).toBe('StatusError');
			expect(summary.statusCode).toBe(400);
			expect(summary.message).toContain('Private IP rejected');
		} else {
			expect(summary).toBeInstanceOf(StatusError);
		}
	});
});

describe('local tests', () => {
	describe('Private IP blocking', () => {
		let host: string;

		beforeEach(async () => {
			process.env.SUMMALY_ALLOW_PRIVATE_IP = 'false';
			const content = fixture('htmls/og-title.html');

			host = await serve((_req, res) => sendWithLength(res, content));
		});

		test('private ipなサーバーの情報を取得できない', async () => {
			const summary = await summarize(host).catch((e: StatusError) => e);

			if (summary instanceof StatusError) {
				expect(summary.name).toBe('StatusError');
			} else {
				expect(summary).toBeInstanceOf(StatusError);
			}
		});

		test('agentが指定されている場合はprivate ipを許可', async () => {
			const agent = {
				http: new httpAgent({ keepAlive: true }),
				https: new httpsAgent({ keepAlive: true }),
			};

			cleanups.push(() => {
				agent.http.destroy();
				agent.https.destroy();
			});
			const summary = await summarize(host, { agent });

			expect(summary.title).toBe('Strawberry Pasta');
		});

		test('agentが空のオブジェクトの場合はprivate ipを許可しない', async () => {
			const summary = await summarize(host, { agent: {} }).catch((e: StatusError) => e);

			if (summary instanceof StatusError) {
				expect(summary.name).toBe('StatusError');
			} else {
				expect(summary).toBeInstanceOf(StatusError);
			}
		});
	});

	describe('UserAgent', () => {
		test('UA設定が反映されていること', async () => {
			const content = fixture('htmls/basic.html');
			let ua: string | undefined = undefined;

			const host = await serve(onlyRoot((req, res) => {
				ua = req.headers['user-agent'];
				sendWithLength(res, content);
			}));

			await summarize(host, { userAgent: 'test-ua', allowedPrivateNetworks });

			expect(ua).toBe('test-ua');
		});
	});

	describe('options', () => {
		test('指定したオプションが以降の呼び出しに引き継がれないこと', async () => {
			const content = fixture('htmls/basic.html');
			const defaults = { ...defaultSummarizeOptions };

			const host = await serve(onlyRoot((_req, res) => sendWithLength(res, content)));

			await expect(summarize(host, { contentLengthLimit: content.byteLength - 1, userAgent: 'test-ua', allowedPrivateNetworks })).rejects.toThrow();
			expect(defaultSummarizeOptions).toEqual(defaults);
			expect(await summarize(host, { allowedPrivateNetworks })).toBeDefined();
		});
	});

	describe('content-length limit', () => {
		test('content-lengthの上限以内であればエラーが起こらないこと', async () => {
			const content = fixture('htmls/basic.html');
			const host = await serve(onlyRoot((_req, res) => sendWithLength(res, content)));

			expect(await summarize(host, { contentLengthLimit: content.byteLength, allowedPrivateNetworks })).toBeDefined();
		});

		test('content-lengthの上限を超えているとエラーになる事', async () => {
			const content = fixture('htmls/basic.html');
			const host = await serve(onlyRoot((_req, res) => sendWithLength(res, content)));

			await expect(summarize(host, { contentLengthLimit: content.byteLength - 1, allowedPrivateNetworks })).rejects.toThrow();
		});

		test('content-lengthなしのストリーム受信中に上限を超えるとエラーになること', async () => {
			const chunk = Buffer.alloc(32, 'a');
			const host = await serve(onlyRoot((_req, res) => sendStream(res, [chunk, chunk])));

			await expect(summarize(host, { contentLengthLimit: 16, allowedPrivateNetworks })).rejects.toThrow(/maxSize exceeded \(\d+ > 16\) on response/);
		});
	});

	describe('content-length required', () => {
		test('[オプション有効化時] content-lengthが返された場合はエラーとならないこと', async () => {
			const content = fixture('htmls/basic.html');
			const host = await serve(onlyRoot((_req, res) => sendWithLength(res, content)));

			expect(await summarize(host, { contentLengthRequired: true, contentLengthLimit: content.byteLength, allowedPrivateNetworks })).toBeDefined();
		});

		test('[オプション有効化時] content-lengthが返されない場合はエラーとなること', async () => {
			const content = fixture('htmls/basic.html');
			const host = await serve(onlyRoot((_req, res) => sendStream(res, [content])));

			await expect(summarize(host, { contentLengthRequired: true, allowedPrivateNetworks })).rejects.toThrow();
		});

		test('[オプション無効化時] content-lengthが返された場合はエラーとならないこと', async () => {
			const content = fixture('htmls/basic.html');
			const host = await serve(onlyRoot((_req, res) => sendWithLength(res, content)));

			expect(await summarize(host, { contentLengthRequired: false, contentLengthLimit: content.byteLength, allowedPrivateNetworks })).toBeDefined();
		});

		test('[オプション無効化時] content-lengthが返されなくてもエラーとならないこと', async () => {
			const content = fixture('htmls/basic.html');
			const host = await serve(onlyRoot((_req, res) => sendStream(res, [content])));

			expect(await summarize(host, { contentLengthRequired: false, allowedPrivateNetworks })).toBeDefined();
		});
	});
});

describe('chiramiss additions', () => {
	test('SUMMALY_ALLOW_PRIVATE_IP=true なら allowedPrivateNetworks や agent なしでもローカルサーバーを要約できる (本家互換)', async () => {
		// The top-level afterEach restores the original value.
		process.env.SUMMALY_ALLOW_PRIVATE_IP = 'true';
		const content = fixture('htmls/og-title.html');
		const host = await serve((_req, res) => sendWithLength(res, content));

		const summary = await summarize(host);

		expect(summary.title).toBe('Strawberry Pasta');
	});

	test('CHIRAMISS_ALLOW_PRIVATE_IP=true でも allowedPrivateNetworks や agent なしでローカルサーバーを要約できる', async () => {
		// The top-level afterEach restores the original values.
		process.env.CHIRAMISS_ALLOW_PRIVATE_IP = 'true';
		const content = fixture('htmls/og-title.html');
		const host = await serve((_req, res) => sendWithLength(res, content));

		const summary = await summarize(host);

		expect(summary.title).toBe('Strawberry Pasta');
	});

	test('CHIRAMISS_ALLOW_PRIVATE_IP=false と SUMMALY_ALLOW_PRIVATE_IP=true が両方あれば CHIRAMISS_ALLOW_PRIVATE_IP が優先され、ローカルサーバーは拒否される', async () => {
		// The top-level afterEach restores the original values.
		process.env.CHIRAMISS_ALLOW_PRIVATE_IP = 'false';
		process.env.SUMMALY_ALLOW_PRIVATE_IP = 'true';
		const content = fixture('htmls/og-title.html');
		const host = await serve((_req, res) => sendWithLength(res, content));

		await expect(summarize(host)).rejects.toThrow(StatusError);
	});

	test('Amazon のページ取得は followRedirects: false / contentLengthRequired: true を指定しても本家と同じくリダイレクトに従い content-length を要求しない', async () => {
		const page = fixture('amazon.html');
		const requests: string[] = [];
		const server = await serve((req, res) => {
			requests.push(`${req.method} ${req.headers.host}${req.url}`);
			if (req.url === '/dp/OLD') {
				res.writeHead(301, { location: '/dp/B000000000' });
				res.end();
			} else if (req.url === '/dp/B000000000') {
				sendStream(res, [page]);
			} else {
				res.writeHead(404).end();
			}
		});
		const agents = loopbackAgents(Number(new URL(server).port));

		cleanups.push(() => agents.destroy());

		const summary = await summarize('https://www.amazon.co.jp/dp/OLD', {
			followRedirects: false,
			contentLengthRequired: true,
			agent: { http: agents.http, https: agents.https },
		});

		expect(summary).toMatchObject({
			title: 'KISS 原則の本',
			sitename: 'Amazon',
			url: 'https://www.amazon.co.jp/dp/OLD',
		});
		expect(requests).toEqual(['GET www.amazon.co.jp/dp/OLD', 'GET www.amazon.co.jp/dp/B000000000']);
	});

	test('NVD の CVE ページはリダイレクト後の URL で nvd プロバイダに渡り、API から要約する', async () => {
		const body = Buffer.from(JSON.stringify({
			vulnerabilities: [{
				cve: {
					descriptions: [{ lang: 'en', value: 'A vulnerability.' }],
					metrics: { cvssMetricV31: [{ type: 'Primary', cvssData: { baseScore: 7, baseSeverity: 'HIGH' } }] },
				},
			}],
		}));
		const requests: string[] = [];
		const server = await serve((req, res) => {
			requests.push(`${req.method} ${req.headers.host}${req.url}`);
			if (req.url === '/vuln/detail/CVE-2026-16478') {
				// nvd.nist.gov redirects the uppercase ID to the lowercase one.
				res.writeHead(301, { location: '/vuln/detail/cve-2026-16478' }).end();
			} else if (req.url === '/vuln/detail/cve-2026-16478') {
				res.writeHead(200, { 'content-type': 'text/html' }).end();
			} else if (req.url === '/rest/json/cves/2.0?cveId=CVE-2026-16478') {
				res.writeHead(200, { 'content-type': 'application/json', 'content-length': body.byteLength }).end(body);
			} else {
				res.writeHead(404).end();
			}
		});
		const agents = loopbackAgents(Number(new URL(server).port));

		cleanups.push(() => agents.destroy());

		const summary = await summarize('https://nvd.nist.gov/vuln/detail/CVE-2026-16478', { agent: { http: agents.http, https: agents.https } });

		expect(summary).toMatchObject({
			title: 'CVE-2026-16478 (HIGH 7.0)',
			description: 'A vulnerability.',
			sitename: 'NVD',
			url: 'https://nvd.nist.gov/vuln/detail/cve-2026-16478',
		});
		expect(requests).toEqual([
			'HEAD nvd.nist.gov/vuln/detail/CVE-2026-16478',
			'HEAD nvd.nist.gov/vuln/detail/cve-2026-16478',
			'GET services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2026-16478',
		]);
	});

	test('npm のパッケージページは HEAD が 403 でも投稿された URL のまま npm プロバイダに渡り、registry から要約する', async () => {
		const body = Buffer.from(JSON.stringify({ name: 'misskey-js', description: 'Misskey SDK for JavaScript' }));
		const requests: string[] = [];
		const server = await serve((req, res) => {
			requests.push(`${req.method} ${req.headers.host}${req.url}`);
			if (req.headers.host === 'npmjs.com') {
				res.writeHead(301, { location: `https://www.npmjs.com${req.url}` }).end();
			} else if (req.headers.host === 'www.npmjs.com') {
				// www.npmjs.com answers bots with a Cloudflare challenge.
				res.writeHead(403, { 'content-type': 'text/html' }).end();
			} else if (req.url === '/misskey-js/latest') {
				res.writeHead(200, { 'content-type': 'application/json', 'content-length': body.byteLength }).end(body);
			} else {
				res.writeHead(404).end();
			}
		});
		const agents = loopbackAgents(Number(new URL(server).port));

		cleanups.push(() => agents.destroy());

		const summary = await summarize('https://npmjs.com/package/misskey-js', { agent: { http: agents.http, https: agents.https } });

		expect(summary).toMatchObject({
			title: 'misskey-js',
			description: 'Misskey SDK for JavaScript',
			sitename: 'npm',
			url: 'https://npmjs.com/package/misskey-js',
		});
		expect(requests).toEqual([
			'HEAD npmjs.com/package/misskey-js',
			'HEAD www.npmjs.com/package/misskey-js',
			'GET registry.npmjs.org/misskey-js/latest',
		]);
	});

	test('設定の違う agent を並行に渡しても互いに干渉しない', async () => {
		const pageA = Buffer.from('<html><head><title>A</title></head></html>');
		const pageB = Buffer.from('<html><head><title>B</title></head></html>');
		const hostA = await serve(onlyRoot((_req, res) => sendWithLength(res, pageA)));
		const hostB = await serve(onlyRoot((_req, res) => sendWithLength(res, pageB)));
		const portA = Number(new URL(hostA).port);
		const portB = Number(new URL(hostB).port);
		const a = hookedAgent();
		const b = hookedAgent();

		const [summaryA, summaryB] = await Promise.all([
			summarize(hostA, { agent: { http: a.agent }, userAgent: 'ua-a' }),
			summarize(hostB, { agent: { http: b.agent }, userAgent: 'ua-b' }),
		]);

		expect(summaryA.title).toBe('A');
		expect(summaryB.title).toBe('B');
		// GET (page) and HEAD (/favicon.ico) each went through the caller's own agent only.
		expect(a.ports.length).toBeGreaterThanOrEqual(2);
		expect(b.ports.length).toBeGreaterThanOrEqual(2);
		expect(a.ports.every(port => port === portA)).toBe(true);
		expect(b.ports.every(port => port === portB)).toBe(true);
	});

	/** An origin on 127.0.0.2 that redirects `/` to `target` (for `method` only, if given); skips where 127.0.0.2 is missing. */
	async function redirectingTo(target: string, skip: (note: string) => void, method?: string): Promise<{ origin: string; methods: string[] }> {
		const methods: string[] = [];
		const origin = await serve((req, res) => {
			methods.push(`${req.method} ${req.url}`);
			if (req.url === '/' && (method === undefined || req.method === method)) {
				res.writeHead(302, { location: `${target}/` });
				res.end();
			} else if (req.url === '/') {
				sendWithLength(res, Buffer.from('<html><head><title>origin</title></head></html>'));
			} else {
				res.writeHead(404).end();
			}
		}, '127.0.0.2').catch((e: NodeJS.ErrnoException) => {
			if (e.code === 'EADDRNOTAVAIL') {
				skip('cannot bind 127.0.0.2 on this host (e.g. macOS has no 127.0.0.0/8 loopback aliases); covered on Linux CI');
			}
			throw e;
		});

		return { origin, methods };
	}

	test('ページの GET のリダイレクト先がプライベート IP なら、接続する前に拒否する', async ({ skip }) => {
		let targetHits = 0;
		const target = await serve((_req, res) => {
			targetHits++;
			sendWithLength(res, Buffer.from('<html><head><title>secret</title></head></html>'));
		}, '127.0.0.1');
		const { origin, methods } = await redirectingTo(target, skip);

		const e = await summarize(`${origin}/`, { allowedPrivateNetworks: ['127.0.0.2/32'] }).catch((e: unknown) => e);

		expect(e).toBeInstanceOf(StatusError);
		expect((e as StatusError).message).toBe('Private IP rejected 127.0.0.1');
		expect(methods).toEqual(['GET /']);
		expect(targetHits).toBe(0);
	});

	test('最終 URL 解決の HEAD もリダイレクト先がプライベート IP なら拒否され、元の URL のままプロバイダに渡る', async ({ skip }) => {
		let targetHits = 0;
		const target = await serve((_req, res) => {
			targetHits++;
			res.end();
		}, '127.0.0.1');
		const { origin, methods } = await redirectingTo(target, skip, 'HEAD');
		const urls: string[] = [];
		// A provider for the origin's URLs, so the final URL is resolved with a HEAD.
		const plugin: SummaryPlugin = {
			test: url => url.hostname === '127.0.0.2',
			summarize: async url => {
				urls.push(url.href);

				return { title: 'plugin', icon: null, description: null, thumbnail: null, thumbnailStyle: null, sitename: null, player: { url: null, width: null, height: null, allow: [] }, activityPub: null, fediverseCreator: null };
			},
		};

		const summary = await summarize(`${origin}/`, { plugins: [plugin], allowedPrivateNetworks: ['127.0.0.2/32'] });

		// The HEAD's redirect to 127.0.0.1 is rejected before connecting, so the original URL is used (as upstream does on HEAD failure).
		expect(methods).toEqual(['HEAD /']);
		expect(targetHits).toBe(0);
		expect(summary.url).toBe(`${origin}/`);
		expect(urls).toEqual([`${origin}/`]);
	});

	test('既定 UA は DEFAULT_BOT_UA', async () => {
		const content = fixture('htmls/basic.html');
		const uas: (string | undefined)[] = [];
		const page = onlyRoot((_req, res) => sendWithLength(res, content));
		const host = await serve((req, res) => {
			uas.push(req.headers['user-agent']);
			page(req, res);
		});

		await summarize(host, { allowedPrivateNetworks });

		expect(DEFAULT_BOT_UA).toMatch(/^ChiramissBot\//);
		// The page GET and the favicon HEAD.
		expect(uas.length).toBeGreaterThanOrEqual(2);
		expect(uas.every(ua => ua === DEFAULT_BOT_UA)).toBe(true);
	});

	test('カスタムプラグインは組み込みより後に評価され、GeneralScrapingOptions を受け取る', async () => {
		const pluginSummary: Summary = {
			title: 'from plugin',
			icon: null,
			description: null,
			thumbnail: null,
			thumbnailStyle: null,
			player: { url: null, width: null, height: null, allow: [] },
			sitename: null,
			activityPub: null,
			fediverseCreator: null,
		};
		const calls: { url: string; opts?: GeneralScrapingOptions }[] = [];
		const plugin: SummaryPlugin = {
			test: () => true,
			summarize: async (url, opts) => {
				calls.push({ url: url.href, opts });

				return { ...pluginSummary };
			},
		};

		// A URL no builtin matches goes to the plugin, with the GeneralScrapingOptions upstream builds:
		// the caller's raw values merged over defaultSummarizeOptions, so unset keys stay undefined and lang is not validated.
		const host = await serve(onlyRoot((_req, res) => sendWithLength(res, Buffer.from('<html></html>'))));
		const custom = await summarize(host, { plugins: [plugin], lang: 'not a valid lang!', allowedPrivateNetworks });

		expect(custom).toEqual({ ...pluginSummary, url: `${host}/` });
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(`${host}/`);
		expect(calls[0].opts).toStrictEqual({
			lang: 'not a valid lang!',
			userAgent: undefined,
			followRedirects: true,
			responseTimeout: undefined,
			operationTimeout: undefined,
			contentLengthLimit: undefined,
			contentLengthRequired: undefined,
		});

		// Values the caller does give are passed through as given.
		const given = await summarize(host, {
			plugins: [plugin],
			lang: 'ja',
			userAgent: 'test-ua',
			followRedirects: false,
			responseTimeout: 1000,
			operationTimeout: 2000,
			contentLengthLimit: 3000,
			contentLengthRequired: true,
			allowedPrivateNetworks,
		});

		expect(given).toEqual({ ...pluginSummary, url: host });
		expect(calls).toHaveLength(2);
		expect(calls[1].opts).toStrictEqual({
			lang: 'ja',
			userAgent: 'test-ua',
			followRedirects: false,
			responseTimeout: 1000,
			operationTimeout: 2000,
			contentLengthLimit: 3000,
			contentLengthRequired: true,
		});

		// A URL a builtin matches goes to the builtin even though the plugin matches too.
		const wikiBody = Buffer.from(JSON.stringify({ query: { pages: { 1: { title: 'Wiki', extract: 'text' } } } }));
		const wiki = await serve((_req, res) => {
			res.writeHead(200, { 'content-type': 'application/json', 'content-length': wikiBody.byteLength });
			res.end(wikiBody);
		});
		const agents = loopbackAgents(Number(new URL(wiki).port));

		cleanups.push(() => agents.destroy());
		const builtin = await summarize('https://ja.wikipedia.org/wiki/Wiki', { plugins: [plugin], agent: { http: agents.http, https: agents.https } });

		expect(builtin).toMatchObject({ title: 'Wiki', description: 'text', sitename: 'Wikipedia', url: 'https://ja.wikipedia.org/wiki/Wiki' });
		expect(calls).toHaveLength(2);
	});
});

describe('最終 URL の解決とページの取得', () => {
	const PAGE = Buffer.from('<html><head><title>page</title></head><body></body></html>');
	const pluginResult: Summary = {
		title: 'from plugin',
		icon: null,
		description: null,
		thumbnail: null,
		thumbnailStyle: null,
		player: { url: null, width: null, height: null, allow: [] },
		sitename: null,
		activityPub: null,
		fediverseCreator: null,
	};

	/** A plugin for the URLs whose path starts with `prefix`; records the URLs it summarizes. */
	function pathPlugin(prefix: string): { plugin: SummaryPlugin; urls: string[] } {
		const urls: string[] = [];

		return {
			plugin: {
				test: url => url.pathname.startsWith(prefix),
				summarize: async url => {
					urls.push(url.href);

					return { ...pluginResult };
				},
			},
			urls,
		};
	}

	/** Records `METHOD path` of the page requests (the favicon check is left out) and the connections. */
	async function recordingServer(handler: Handler): Promise<{ host: string; requests: string[]; connections: () => number }> {
		const requests: string[] = [];
		const sockets = new Set<unknown>();
		const host = await serve((req, res) => {
			sockets.add(req.socket);
			if (req.url !== '/favicon.ico') {
				requests.push(`${req.method} ${req.url}`);
			}
			handler(req, res);
		});

		return { host, requests, connections: () => sockets.size };
	}

	test('プロバイダに当たらない URL は HEAD を送らず、GET でリダイレクトをたどった応答をそのまま要約する', async () => {
		const { host, requests } = await recordingServer((req, res) => {
			if (req.url === '/') {
				res.writeHead(302, { location: '/page', 'content-length': 0 }).end();
			} else if (req.url === '/page') {
				sendWithLength(res, PAGE);
			} else {
				res.writeHead(404, { 'content-length': 0 }).end();
			}
		});

		const summary = await summarize(`${host}/`, { allowedPrivateNetworks });

		expect(summary.title).toBe('page');
		expect(summary.url).toBe(`${host}/page`);
		expect(requests).toEqual(['GET /', 'GET /page']);
	});

	test('GET のリダイレクト先がプロバイダに当たれば、本文を読まずに最終 URL でプロバイダに渡す', async () => {
		const { plugin, urls } = pathPlugin('/target');
		const { host, requests, connections } = await recordingServer((req, res) => {
			if (req.url?.startsWith('/short')) {
				res.writeHead(302, { location: `/target${req.url.slice('/short'.length)}`, 'content-length': 0 }).end();
			} else {
				sendWithLength(res, PAGE);
			}
		});

		const summary = await summarize(`${host}/short-1`, { plugins: [plugin], allowedPrivateNetworks });

		expect(summary).toEqual({ ...pluginResult, url: `${host}/target-1` });
		expect(urls).toEqual([`${host}/target-1`]);
		expect(requests).toEqual(['GET /short-1', 'GET /target-1']);
		// The short body of the handed-off response was read to its end, so its connection serves the next summary.
		await summarize(`${host}/short-2`, { plugins: [plugin], allowedPrivateNetworks });
		expect(connections()).toBe(1);
	});

	test('プロバイダに渡す応答の本文が大きいときは、読まずに接続を切る', async () => {
		const { plugin, urls } = pathPlugin('/target');
		const big = Buffer.alloc(1024 * 1024, 'x');
		const { host, connections } = await recordingServer((req, res) => {
			if (req.url?.startsWith('/short')) {
				res.writeHead(302, { location: `/target${req.url.slice('/short'.length)}`, 'content-length': 0 }).end();
			} else {
				res.writeHead(200, { 'content-type': 'text/html', 'content-length': big.byteLength }).end(big);
			}
		});

		await summarize(`${host}/short-1`, { plugins: [plugin], allowedPrivateNetworks });
		await summarize(`${host}/short-2`, { plugins: [plugin], allowedPrivateNetworks });

		expect(urls).toEqual([`${host}/target-1`, `${host}/target-2`]);
		expect(connections()).toBe(2);
	});

	// As with the HEAD upstream sends: the provider fetches what it needs itself, under its own checks.
	test('プロバイダに渡す応答は、ページの型と大きさを確かめない', async () => {
		const { plugin, urls } = pathPlugin('/target');
		const { host } = await recordingServer((req, res) => {
			if (req.url === '/short') {
				res.writeHead(302, { location: '/target', 'content-length': 0 }).end();
			} else {
				res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': 100 }).end(Buffer.alloc(100));
			}
		});

		const summary = await summarize(`${host}/short`, { plugins: [plugin], allowedPrivateNetworks, contentLengthLimit: 10, contentLengthRequired: true });

		expect(summary.title).toBe('from plugin');
		expect(urls).toEqual([`${host}/target`]);
	});

	test('リダイレクト先がページを読むプロバイダ（Amazon）なら、GET した本文をそのまま渡し、ページを取り直さない', async () => {
		const page = fixture('amazon.html');
		const requests: string[] = [];
		const server = await serve((req, res) => {
			requests.push(`${req.method} ${req.headers.host}${req.url}`);
			if (req.headers.host === 'amzn.test') {
				res.writeHead(302, { location: 'https://www.amazon.co.jp/dp/B000000000', 'content-length': 0 }).end();
			} else if (req.url === '/dp/B000000000') {
				// No content-length: Amazon's own fetch does not require it, whatever contentLengthRequired says.
				sendStream(res, [page]);
			} else {
				res.writeHead(404).end();
			}
		});
		const agents = loopbackAgents(Number(new URL(server).port));

		cleanups.push(() => agents.destroy());

		const summary = await summarize('https://amzn.test/x', { contentLengthRequired: true, agent: { http: agents.http, https: agents.https } });

		expect(summary).toMatchObject({ title: 'KISS 原則の本', sitename: 'Amazon', url: 'https://www.amazon.co.jp/dp/B000000000' });
		expect(requests).toEqual(['GET amzn.test/x', 'GET www.amazon.co.jp/dp/B000000000']);
	});

	// Before, the HEAD got the 403 too, the summary fell back to the short URL (no provider) and its page GET failed.
	test('リダイレクト先のプロバイダの URL が 2xx 以外を返しても、プロバイダに渡す', async () => {
		const body = Buffer.from(JSON.stringify({ name: 'misskey-js', description: 'Misskey SDK for JavaScript' }));
		const requests: string[] = [];
		const server = await serve((req, res) => {
			requests.push(`${req.method} ${req.headers.host}${req.url}`);
			if (req.headers.host === 'npm.test') {
				res.writeHead(302, { location: `https://www.npmjs.com/package${req.url}`, 'content-length': 0 }).end();
			} else if (req.headers.host === 'www.npmjs.com') {
				res.writeHead(403, { 'content-type': 'text/html', 'content-length': 0 }).end();
			} else if (req.url === '/misskey-js/latest') {
				res.writeHead(200, { 'content-type': 'application/json', 'content-length': body.byteLength }).end(body);
			} else {
				res.writeHead(404).end();
			}
		});
		const agents = loopbackAgents(Number(new URL(server).port));

		cleanups.push(() => agents.destroy());

		const summary = await summarize('https://npm.test/misskey-js', { agent: { http: agents.http, https: agents.https } });

		expect(summary).toMatchObject({ title: 'misskey-js', sitename: 'npm', url: 'https://www.npmjs.com/package/misskey-js' });
		expect(requests).toEqual([
			'GET npm.test/misskey-js',
			'GET www.npmjs.com/package/misskey-js',
			'GET registry.npmjs.org/misskey-js/latest',
		]);
	});

	test('最終 URL でプロバイダを選ぶときにプラグインの test() が例外を投げたら、その例外で失敗する', async () => {
		const { host } = await recordingServer((req, res) => {
			if (req.url === '/short') {
				res.writeHead(302, { location: '/target', 'content-length': 0 }).end();
			} else {
				sendWithLength(res, PAGE);
			}
		});
		const plugin: SummaryPlugin = {
			test: url => {
				if (url.pathname === '/target') {
					throw new Error('test threw');
				}

				return false;
			},
			summarize: async () => ({ ...pluginResult }),
		};

		await expect(summarize(`${host}/short`, { plugins: [plugin], allowedPrivateNetworks })).rejects.toThrow('test threw');
	});

	// The body is dropped anyway; reading it is only so the connection can be reused, so running out of time there is no failure.
	test('プロバイダに渡す応答の本文を読み切る前に operationTimeout が来ても、プロバイダには渡す', async () => {
		const { plugin, urls } = pathPlugin('/target');
		const { host } = await recordingServer((req, res) => {
			if (req.url === '/short') {
				res.writeHead(302, { location: '/target', 'content-length': 0 }).end();
			} else {
				res.writeHead(200, { 'content-type': 'text/html' });
				res.write('<html>');
				// The rest never comes.
			}
		});
		const started = performance.now();
		const summary = await summarize(`${host}/short`, { plugins: [plugin], allowedPrivateNetworks, operationTimeout: 200 });

		expect(summary.title).toBe('from plugin');
		expect(urls).toEqual([`${host}/target`]);
		expect(performance.now() - started).toBeLessThan(2000);
	});

	test('元の URL がプロバイダに当たるときは、これまでどおり HEAD で最終 URL を求めてから渡す', async () => {
		const { plugin, urls } = pathPlugin('/p');
		const { host, requests } = await recordingServer((req, res) => {
			if (req.url === '/p') {
				res.writeHead(301, { location: '/p/moved', 'content-length': 0 }).end();
			} else {
				sendWithLength(res, PAGE);
			}
		});

		const summary = await summarize(`${host}/p`, { plugins: [plugin], allowedPrivateNetworks });

		expect(summary.url).toBe(`${host}/p/moved`);
		expect(urls).toEqual([`${host}/p/moved`]);
		expect(requests).toEqual(['HEAD /p', 'HEAD /p/moved']);
	});

	test('プロバイダに当たらない URL の GET が失敗したら、同じ URL を取り直さずにエラーにする', async () => {
		const { host, requests } = await recordingServer((_req, res) => res.writeHead(404, { 'content-length': 0 }).end());

		const e = await summarize(`${host}/missing`, { allowedPrivateNetworks }).catch((e: unknown) => e);

		expect(e).toBeInstanceOf(StatusError);
		expect((e as StatusError).statusCode).toBe(404);
		expect(requests).toEqual(['GET /missing']);
	});
});
