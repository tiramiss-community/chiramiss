import { DEFAULT_CACHE_TTL, DEFAULT_ERROR_CACHE_TTL } from '@/options.js';
import type { SummarizeOptions } from '@/types.js';

/**
 * Cache-Control for an HTTP response carrying the outcome of a summary, so that a shared cache (reverse proxy, CDN)
 * keeps it for as long as the summarizer itself keeps that outcome: `cacheTtl` for a summary, `errorCacheTtl` for a
 * failure (the lib defaults when unset). The TTL is rounded down to seconds; under one second gives `no-store`.
 * Only the TTL counts, not whether `cache` is turned off.
 */
export function summaryCacheControl(options: Pick<SummarizeOptions, 'cacheTtl' | 'errorCacheTtl'>, outcome: 'ok' | 'error'): string {
	const ttl = outcome === 'ok' ? options.cacheTtl ?? DEFAULT_CACHE_TTL : options.errorCacheTtl ?? DEFAULT_ERROR_CACHE_TTL;
	const maxAge = Math.floor(ttl / 1000);

	return maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store';
}
