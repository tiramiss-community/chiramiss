import { createServer, connect } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { startDelayProxy } from '../src/delay-proxy.ts';

let echo: Server;
let echoPort: number;
let proxy: Awaited<ReturnType<typeof startDelayProxy>> | undefined;
const clients: Socket[] = [];
let rtt = 0;
let connections = 0;
let bytesToClient = 0;

beforeEach(async () => {
	rtt = 0;
	connections = 0;
	bytesToClient = 0;
	echo = createServer((socket) => {
		socket.pipe(socket);
		socket.on('error', () => {});
	});
	await new Promise<void>((resolve) => echo.listen(0, '127.0.0.1', resolve));
	echoPort = (echo.address() as AddressInfo).port;
	proxy = await startDelayProxy({
		listenPort: 0,
		listenHost: '127.0.0.1',
		upstream: { host: '127.0.0.1', port: echoPort },
		getRttMs: () => rtt,
		onConnection: () => {
			connections++;
		},
		onBytesToClient: (n) => {
			bytesToClient += n;
		},
	});
});

afterEach(async () => {
	for (const client of clients.splice(0)) {
		client.destroy();
	}

	await proxy?.close();
	await new Promise<void>((resolve) => echo.close(() => resolve()));
});

async function open(): Promise<Socket> {
	const socket = connect((proxy as NonNullable<typeof proxy>).port, '127.0.0.1');

	clients.push(socket);
	socket.on('error', () => {});
	await new Promise<void>((resolve) => socket.once('connect', resolve));

	return socket;
}

async function exchange(socket: Socket, payload: string): Promise<number> {
	const start = performance.now();
	const received = new Promise<void>((resolve) => {
		let got = '';
		const onData = (chunk: Buffer) => {
			got += chunk.toString();
			if (got.length >= payload.length) {
				socket.off('data', onData);
				resolve();
			}
		};

		socket.on('data', onData);
	});

	socket.write(payload);
	await received;

	return performance.now() - start;
}

test('first exchange on a new connection costs about 2 RTT, later ones about 1 RTT', async () => {
	rtt = 100;
	const socket = await open();
	const first = await exchange(socket, 'a');
	const second = await exchange(socket, 'b');

	expect(first).toBeGreaterThanOrEqual(190);
	expect(second).toBeGreaterThanOrEqual(95);
	expect(second).toBeLessThan(190);
});

test('rtt 0 adds no delay', async () => {
	const socket = await open();
	const first = await exchange(socket, 'a');

	expect(first).toBeLessThan(50);
});

test('rtt change applies to an existing connection', async () => {
	const socket = await open();

	await exchange(socket, 'a');
	rtt = 100;
	const next = await exchange(socket, 'b');

	expect(next).toBeGreaterThanOrEqual(95);
});

test('preserves byte order under many small writes', async () => {
	rtt = 20;
	const socket = await open();
	const expected = Array.from({ length: 1000 }, (_, i) => `${i},`).join('');
	const received = new Promise<string>((resolve) => {
		let got = '';

		socket.on('data', (chunk) => {
			got += chunk.toString();
			if (got.length >= expected.length) {
				resolve(got);
			}
		});
	});

	for (let i = 0; i < 1000; i++) {
		socket.write(`${i},`);
		if (i % 100 === 0) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
	}

	expect(await received).toBe(expected);
});

test('counts connections and bytes to client', async () => {
	const a = await open();

	await exchange(a, 'hello');
	const b = await open();

	await exchange(b, 'world!');

	expect(connections).toBe(2);
	expect(bytesToClient).toBe(11);
});
