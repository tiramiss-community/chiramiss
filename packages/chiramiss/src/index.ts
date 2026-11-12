// Derived from misskey-dev/summaly (MIT)
import { InProcessCoordinator } from '@/coalesce/in-process-coordinator.js';
import { buildRequestKey } from '@/coalesce/key.js';
import { MemorySummaryCache } from '@/coalesce/memory-cache.js';
import { type CoalesceDeps, runCoalesced } from '@/coalesce/run.js';
import { type ScrapeContext, createScrapeContext, fetchWithContext, fixOptions } from '@/context.js';
import { pageRequest, scrapeGeneral, summarizePage, toPage } from '@/extract/general.js';
import { privateIpAllowedByEnv } from '@/http/address-guard.js';
import { GuardedAgentPool } from '@/http/agent-pool.js';
import { DEFAULT_CACHE_TTL, DEFAULT_ERROR_CACHE_TTL } from '@/options.js';
import { builtinProviders } from '@/providers/index.js';
import { type Provider, fromPlugin } from '@/providers/provider.js';
import type { Summary, SummarizeOptions, SummaryResult } from '@/types.js';
import { VERSION } from '@/version.js';

export const version: string = VERSION;

export { summaryCacheControl } from '@/cache-control.js';
export { InProcessCoordinator } from '@/coalesce/in-process-coordinator.js';
export { MemorySummaryCache } from '@/coalesce/memory-cache.js';
export type { MemorySummaryCacheOptions } from '@/coalesce/memory-cache.js';
export { StatusError } from '@/http/status-error.js';
export { default } from '@/fastify-plugin.js';
export type { FastifyLike } from '@/fastify-plugin.js';

export type {
	GeneralScrapingOptions,
	Player,
	ProxyOptions,
	Summary,
	SummarizeOptions,
	SummaryPlugin,
	SummaryResult,
	SummalyOptions,
	SummalyPlugin,
	SummalyResult,
} from '@/types.js';
export type {
	CacheEntry,
	InflightCoordinator,
	SerializedError,
	SummaryCache,
} from '@/coalesce/types.js';

/**
 * Defaults merged under the options of every call.
 */
export const defaultSummarizeOptions: SummarizeOptions = {
	lang: null,
	followRedirects: true,
	plugins: [],
};

/**
 * Alias of `defaultSummarizeOptions`, kept for summaly compatibility.
 */
export const summalyDefaultOptions: SummarizeOptions = defaultSummarizeOptions;

/**
 * Creates a summarize function with its own result cache, in-flight sharing and connection pool.
 * Options given per call are merged over `base`. `cache: false` / `coordinator: false` (in either) turns that part off.
 * Its calls with the same `allowedPrivateNetworks` reuse each other's idle connections for a short time
 * (see GuardedAgentPool); separate summarizers never share connections.
 */
export function createSummarizer(base: SummarizeOptions = {}): (url: string, options?: SummarizeOptions) => Promise<SummaryResult> {
	const memoryCache = new MemorySummaryCache();
	const inProcessCoordinator = new InProcessCoordinator();
	const agentPool = new GuardedAgentPool();

	return (url, options = {}) => {
		// Fixed when the call starts: the summary key, the transport and the favicon check keys are all built from
		// these, whatever the caller or the environment changes while the call runs.
		const opts = fixOptions({
			...defaultSummarizeOptions,
			...base,
			...options,
		});
		const allowPrivateIp = privateIpAllowedByEnv();
		const cache = options.cache ?? base.cache ?? memoryCache;
		const coordinator = options.coordinator ?? base.coordinator ?? inProcessCoordinator;
		const deps: CoalesceDeps = {
			cache: cache === false ? null : cache,
			coordinator: coordinator === false ? null : coordinator,
			cacheTtl: options.cacheTtl ?? base.cacheTtl ?? DEFAULT_CACHE_TTL,
			errorCacheTtl: options.errorCacheTtl ?? base.errorCacheTtl ?? DEFAULT_ERROR_CACHE_TTL,
		};

		return runCoalesced(
			deps,
			() => buildRequestKey(url, opts, allowPrivateIp),
			() => summarizeUncached(url, opts, deps, allowPrivateIp, agentPool),
		);
	};
}

/**
 * Alias of `createSummarizer`, kept for summaly compatibility.
 */
export const createSummaly: (base?: SummarizeOptions) => (url: string, options?: SummarizeOptions) => Promise<SummaryResult> = createSummarizer;

/**
 * Summarize an web page
 */
export const summarize: (url: string, options?: SummarizeOptions) => Promise<SummaryResult> = createSummarizer();

/**
 * Alias of `summarize`, kept for summaly compatibility.
 */
export const summaly: (url: string, options?: SummarizeOptions) => Promise<SummaryResult> = summarize;

/**
 * The whole summary without caching or sharing it: final URL, provider match, scraping.
 * `deps` is handed on for the favicon checks, whose results are cached and shared across summaries.
 * `allowPrivateIp` is the value the summary key was built with, so the transport uses it too.
 * `agentPool` is the summarizer's connection pool.
 */
async function summarizeUncached(
	url: string,
	opts: SummarizeOptions,
	deps: CoalesceDeps,
	allowPrivateIp: boolean,
	agentPool: GuardedAgentPool,
): Promise<SummaryResult> {
	const ctx = createScrapeContext(opts, deps, allowPrivateIp, agentPool);

	// The requests of this call share the transport's connections. Guarded connections that completed their responses
	// stay idle in the summarizer's pool for later calls; proxy connections end with the call (see Transport#close).
	try {
		const providers = [...builtinProviders, ...(opts.plugins ?? []).map(fromPlugin)];
		const requested = new URL(url);
		const { summary, url: actualUrl } = opts.followRedirects && !providers.some(provider => provider.test(requested))
			? await summarizeGetFirst(ctx, url, providers)
			: await summarizeAfterHead(ctx, url, providers, opts.followRedirects ?? false);

		if (summary == null) {
			throw new Error('failed summarize');
		}

		return Object.assign(summary, {
			url: actualUrl,
		});
	} finally {
		ctx.transport.close();
	}
}

/** A summary and the URL reported as its `url`. */
type Summarized = { summary: Summary | null; url: string };

/**
 * For a URL that no provider takes: GETs the page following redirects and picks the provider by the final URL once the
 * response headers arrive, so the page is fetched once (upstream sends a HEAD for the final URL, then GETs the page).
 * - No provider takes the final URL either: that response is summarized as the page.
 * - A provider that reads the page (`fromPage`) gets that response.
 * - Any other provider gets the final URL, whatever the response's status, and the body is dropped unread (see
 *   FetchRequest.onFinalUrl): it fetches what it needs itself, as it does after upstream's HEAD.
 * A failed GET otherwise fails the summary: upstream falls back to the requested URL, which no provider takes, and GETs
 * it again.
 */
async function summarizeGetFirst(ctx: ScrapeContext, url: string, providers: Provider[]): Promise<Summarized> {
	const found: { provider?: Provider } = {};
	const res = await fetchWithContext(ctx, {
		...pageRequest(ctx, url),
		onFinalUrl: finalUrl => {
			found.provider = providers.find(provider => provider.test(finalUrl));
			if (!found.provider) {
				return undefined;
			}

			return found.provider.fromPage ? found.provider.fromPage.checks : 'drop';
		},
	});
	const finalUrl = new URL(res.url);
	const { provider } = found;

	if (provider?.fromPage) {
		return { summary: await provider.fromPage.summarize(ctx, finalUrl, toPage(res)), url: res.url };
	}
	if (provider) {
		return { summary: await provider.summarize(ctx, finalUrl), url: res.url };
	}

	// The final URL is the base for relative links, as it is when upstream GETs the URL its HEAD ended on.
	return { summary: await summarizePage(ctx, finalUrl, toPage(res)), url: res.url };
}

/**
 * For a URL that a provider takes (or with followRedirects off), as upstream does: the final URL from a HEAD picks the
 * provider, so a provider that reads an API instead of the page never has the page fetched.
 */
async function summarizeAfterHead(ctx: ScrapeContext, url: string, providers: Provider[], followRedirects: boolean): Promise<Summarized> {
	const actualUrl = followRedirects ? await resolveFinalUrl(ctx, url) : url;
	const target = new URL(actualUrl);
	const match = providers.find(provider => provider.test(target));

	return { summary: match ? await match.summarize(ctx, target) : await scrapeGeneral(ctx, target), url: actualUrl };
}

/**
 * Follows redirects with HEAD to find the page's final URL. Falls back to `url` on any failure, as upstream does.
 * Goes through the context's transport, so every hop is checked against the private IP guard.
 */
async function resolveFinalUrl(ctx: ScrapeContext, url: string): Promise<string> {
	try {
		const res = await fetchWithContext(ctx, {
			url,
			method: 'HEAD',
			headers: {
				'accept': 'text/html,application/xhtml+xml',
				'accept-language': ctx.options.lang ?? undefined,
			},
			followRedirects: true,
			// Like upstream's plain got.head(): no size or content-length checks (a HEAD has no body).
			contentLengthLimit: Number.POSITIVE_INFINITY,
			contentLengthRequired: false,
		});

		return res.url;
	} catch {
		return url;
	}
}
