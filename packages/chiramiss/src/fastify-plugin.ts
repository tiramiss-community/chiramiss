// Derived from misskey-dev/summaly (MIT)
import { summaryCacheControl } from '@/cache-control.js';
import { summarize } from '@/index.js';
import type { SummarizeOptions } from '@/types.js';

type ReplyLike = {
	status(code: number): ReplyLike;
	header(name: string, value: string): ReplyLike;
	send(payload: unknown): unknown;
};

type RequestLike = {
	// Fastify types the query as unknown unless a schema is given, so narrow it inside the handler.
	query: unknown;
};

/**
 * The part of a Fastify instance the plugin uses. Defined structurally so that the library
 * (and its published .d.ts) does not depend on fastify.
 */
export type FastifyLike = {
	get(path: string, handler: (req: RequestLike, reply: ReplyLike) => Promise<unknown>): unknown;
};

/**
 * Fastify plugin compatible with upstream summaly's default export.
 * Unlike upstream, responses carry Cache-Control (see summaryCacheControl; `no-store` for a missing url).
 */
export default function summaryPlugin(fastify: FastifyLike, options: SummarizeOptions, done: (err?: Error) => void): void {
	fastify.get('/', async (req, reply) => {
		const query = req.query as { url?: string; lang?: string };
		const url = query.url;

		if (url == null) {
			return reply.status(400).header('cache-control', 'no-store').send({
				error: 'url is required',
			});
		}

		try {
			const summary = await summarize(url, {
				lang: query.lang,
				followRedirects: false,
				...options,
			});

			reply.header('cache-control', summaryCacheControl(options, 'ok'));

			return summary;
		} catch (e) {
			return reply.status(500).header('cache-control', summaryCacheControl(options, 'error')).send({
				error: e,
			});
		}
	});

	done();
}
