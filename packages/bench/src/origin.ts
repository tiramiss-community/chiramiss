import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startDelayProxy } from './delay-proxy.ts';
import { buildFixtures } from './fixtures.ts';
import type { OriginStats } from './types.ts';

export interface OriginOptions {
	httpsPort: number;
	controlPort: number;
	host?: string;
	certDir: string;
	initialRttMs?: number;
}

function listen(server: Server, port: number, host: string | undefined): Promise<number> {
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, host, () => resolve((server.address() as AddressInfo).port));
	});
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolve) => {
		server.closeAllConnections();
		server.close(() => resolve());
	});
}

export async function startOrigin(
	opts: OriginOptions,
): Promise<{ httpsPort: number; controlPort: number; close(): Promise<void> }> {
	const fixtures = buildFixtures();
	let rttMs = opts.initialRttMs ?? 0;
	let stats: OriginStats = { requests: {}, newConnections: 0, bytesOut: 0 };

	const https = createHttpsServer(
		{
			cert: readFileSync(`${opts.certDir}/origin.pem`),
			key: readFileSync(`${opts.certDir}/origin-key.pem`),
		},
		(req, res) => {
			const url = new URL(req.url ?? '/', 'https://origin.bench');
			const method = req.method ?? 'GET';
			const key = `${method} ${url.pathname}`;
			const fixture = fixtures.respond(method, url);

			stats.requests[key] = (stats.requests[key] ?? 0) + 1;
			res.writeHead(fixture.status, fixture.headers);
			res.end(method === 'HEAD' ? undefined : fixture.body);
		},
	);

	https.keepAliveTimeout = 5000;

	const httpsInnerPort = await listen(https, 0, '127.0.0.1');
	const proxy = await startDelayProxy({
		listenPort: opts.httpsPort,
		listenHost: opts.host,
		upstream: { host: '127.0.0.1', port: httpsInnerPort },
		getRttMs: () => rttMs,
		onConnection: () => {
			stats.newConnections++;
		},
		onBytesToClient: (n) => {
			stats.bytesOut += n;
		},
	});

	const control = createHttpServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://control.bench');

		if (req.method === 'GET' && url.pathname === '/stats') {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify(stats));

			return;
		}

		if (req.method === 'POST' && url.pathname === '/reset') {
			stats = { requests: {}, newConnections: 0, bytesOut: 0 };
			res.writeHead(204).end();

			return;
		}

		if (req.method === 'PUT' && url.pathname === '/rtt') {
			const ms = Number(url.searchParams.get('ms'));

			if (!Number.isFinite(ms) || ms < 0) {
				res.writeHead(400).end();

				return;
			}

			rttMs = ms;
			res.writeHead(204).end();

			return;
		}

		res.writeHead(404).end();
	});

	const controlPort = await listen(control, opts.controlPort, opts.host);

	return {
		httpsPort: proxy.port,
		controlPort,
		close: async () => {
			await proxy.close();
			await closeServer(https);
			await closeServer(control);
		},
	};
}
