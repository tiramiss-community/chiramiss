// Derived from misskey-dev/summaly (MIT)
/**
 * HTTP endpoints of the standalone chiramiss server
 */

import Fastify, { type FastifyInstance } from 'fastify';
import {
	createSummarizer,
	summaryCacheControl,
	type InflightCoordinator,
	type SummaryCache,
} from '@tiramiss-community/chiramiss';
import type { ServerConfig } from './config.js';
import { resolveRequestOptions } from './query.js';

export type AppDeps = {
	/**
	 * Result cache. Defaults to the lib's in-process cache.
	 * The hook for a shared cache (e.g. one built from REDIS_URL in the future).
	 */
	cache?: SummaryCache;

	/**
	 * In-flight request sharing. Defaults to the lib's in-process coordinator.
	 */
	coordinator?: InflightCoordinator;
};

export type AppOptions = {
	/**
	 * Enables Fastify's request log on standard output (default false)
	 */
	logger?: boolean;
};

/**
 * Builds the server: `GET /` (upstream-compatible summary endpoint) and `GET /healthz`.
 */
export function buildApp(config: ServerConfig, deps: AppDeps = {}, options: AppOptions = {}): FastifyInstance {
	const app = Fastify({ logger: options.logger ?? false });

	// One instance per app, so concurrent and repeated requests share its in-flight runs and cache.
	const summarize = createSummarizer({ ...config.summarizeOptions, ...deps });

	// A shared cache may keep a summary or a failure as long as the summarizer does; a bad request not at all.
	const okCacheControl = summaryCacheControl(config.summarizeOptions, 'ok');
	const errorCacheControl = summaryCacheControl(config.summarizeOptions, 'error');

	app.get('/', async (req, reply) => {
		const query = req.query as Record<string, unknown>;
		const url = query.url;

		if (typeof url !== 'string') {
			return reply.status(400).header('cache-control', 'no-store').send({
				error: 'url is required',
			});
		}

		try {
			const summary = await summarize(url, resolveRequestOptions(query, config.summarizeOptions));

			reply.header('cache-control', okCacheControl);

			return summary;
		} catch (e) {
			return reply.status(500).header('cache-control', errorCacheControl).send({
				error: e,
			});
		}
	});

	app.get('/healthz', async (_req, reply) => {
		reply.header('cache-control', 'no-store');

		return { status: 'ok' };
	});

	return app;
}
