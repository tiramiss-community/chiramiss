import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { Agent, request as httpsRequest } from 'node:https';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildFixtures } from '../src/fixtures.ts';
import { startOrigin } from '../src/origin.ts';
import type { OriginStats } from '../src/types.ts';

const certDir = fileURLToPath(new URL('../certs', import.meta.url));
const ca = readFileSync(`${certDir}/ca.pem`);

let origin: Awaited<ReturnType<typeof startOrigin>>;
const agents: Agent[] = [];

beforeEach(async () => {
	origin = await startOrigin({ httpsPort: 0, controlPort: 0, host: '127.0.0.1', certDir });
});

afterEach(async () => {
	for (const agent of agents.splice(0)) {
		agent.destroy();
	}

	await origin.close();
});

function newAgent(keepAlive: boolean): Agent {
	const agent = new Agent({ keepAlive, maxSockets: 1 });

	agents.push(agent);

	return agent;
}

function get(agent: Agent, method: string, path: string): Promise<{ status: number; body: Buffer }> {
	return new Promise((resolve, reject) => {
		const req = httpsRequest(
			{ host: '127.0.0.1', port: origin.httpsPort, method, path, ca, servername: 'origin.bench', agent },
			(res) => {
				const chunks: Buffer[] = [];

				res.on('data', (chunk: Buffer) => chunks.push(chunk));
				res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
			},
		);

		req.on('error', reject);
		req.end();
	});
}

function control(method: string, path: string): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const req = httpRequest({ host: '127.0.0.1', port: origin.controlPort, method, path }, (res) => {
			let body = '';

			res.setEncoding('utf8');
			res.on('data', (chunk: string) => {
				body += chunk;
			});
			res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
		});

		req.on('error', reject);
		req.end();
	});
}

async function stats(): Promise<OriginStats> {
	return JSON.parse((await control('GET', '/stats')).body) as OriginStats;
}

test('serves fixtures over TLS valid for origin.bench', async () => {
	const res = await get(newAgent(false), 'GET', '/article?n=1');
	const expected = buildFixtures().respond('GET', new URL('https://origin.bench/article?n=1'));

	expect(res.status).toBe(200);
	expect(res.body.equals(Buffer.from(expected.body))).toBe(true);
});

test('stats count requests by method and path, connections and bytes; reset zeroes them', async () => {
	const agent = newAgent(true);
	const article = await get(agent, 'GET', '/article?n=1');

	await get(agent, 'HEAD', '/favicon.ico');

	const counted = await stats();

	expect(counted.requests['GET /article']).toBe(1);
	expect(counted.requests['HEAD /favicon.ico']).toBe(1);
	expect(counted.newConnections).toBe(1);
	expect(counted.bytesOut).toBeGreaterThan(article.body.length);

	expect((await control('POST', '/reset')).status).toBe(204);
	expect(await stats()).toEqual({ requests: {}, newConnections: 0, bytesOut: 0 });
});

test('PUT /rtt changes latency', async () => {
	expect((await control('PUT', '/rtt?ms=100')).status).toBe(204);

	const start = performance.now();

	await get(newAgent(false), 'GET', '/article');

	expect(performance.now() - start).toBeGreaterThanOrEqual(190);
});
