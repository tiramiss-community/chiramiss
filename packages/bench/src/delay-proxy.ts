import { createServer, connect } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';

export interface DelayProxyOptions {
	listenPort: number;
	listenHost?: string;
	upstream: { host: string; port: number };
	getRttMs: () => number;
	onConnection?: () => void;
	onBytesToClient?: (n: number) => void;
}

/**
 * 一方向分の遅延キュー。各アクションを `max(now + delay, 前に予定した時刻)` に実行し、順序を保つ。
 * 遅延が 0 で待機中のアクションがなければ、その場で実行する。
 * タイマーは先頭の 1 本だけ張る（長さの違うタイマー同士は同時刻でも発火順が入れ替わりうるため）。
 */
class DelayQueue {
	private lastAt = 0;
	private readonly queue: { at: number; action: () => void }[] = [];
	private timer: NodeJS.Timeout | undefined;

	run(delayMs: number, action: () => void): void {
		const now = performance.now();
		const at = Math.max(now + delayMs, this.lastAt);

		if (this.queue.length === 0 && at <= now) {
			action();

			return;
		}

		this.lastAt = at;
		this.queue.push({ at, action });
		this.arm();
	}

	private arm(): void {
		if (this.timer !== undefined || this.queue.length === 0) {
			return;
		}

		this.timer = setTimeout(
			() => {
				this.timer = undefined;
				this.flush();
			},
			Math.max(0, this.queue[0].at - performance.now()),
		);
	}

	private flush(): void {
		const now = performance.now();

		while (this.queue.length > 0 && this.queue[0].at <= now) {
			const entry = this.queue.shift();

			entry?.action();
		}

		this.arm();
	}
}

export function startDelayProxy(opts: DelayProxyOptions): Promise<{ port: number; close(): Promise<void> }> {
	const sockets = new Set<Socket>();

	const server = createServer((client) => {
		opts.onConnection?.();

		const upstream = connect(opts.upstream.port, opts.upstream.host);
		const toUpstream = new DelayQueue();
		const toClient = new DelayQueue();
		let firstChunk = true;

		sockets.add(client);
		sockets.add(upstream);

		const destroyBoth = () => {
			client.destroy();
			upstream.destroy();
		};

		client.on('error', destroyBoth);
		upstream.on('error', destroyBoth);
		client.on('close', () => {
			sockets.delete(client);
			upstream.destroy();
		});
		upstream.on('close', () => {
			sockets.delete(upstream);
			client.destroy();
		});

		client.on('data', (chunk) => {
			const rtt = opts.getRttMs();
			// 新しい接続の最初のチャンクには、接続確立の 1 往復を足す
			const delay = rtt > 0 ? rtt / 2 + (firstChunk ? rtt : 0) : 0;

			firstChunk = false;
			toUpstream.run(delay, () => {
				upstream.write(chunk);
			});
		});
		client.on('end', () => {
			toUpstream.run(opts.getRttMs() / 2, () => {
				upstream.end();
			});
		});

		upstream.on('data', (chunk) => {
			toClient.run(opts.getRttMs() / 2, () => {
				opts.onBytesToClient?.(chunk.length);
				client.write(chunk);
			});
		});
		upstream.on('end', () => {
			toClient.run(opts.getRttMs() / 2, () => {
				client.end();
			});
		});
	});

	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(opts.listenPort, opts.listenHost, () => {
			resolve({
				port: (server.address() as AddressInfo).port,
				close: () =>
					new Promise<void>((done) => {
						for (const socket of sockets) {
							socket.destroy();
						}

						server.close(() => done());
					}),
			});
		});
	});
}
