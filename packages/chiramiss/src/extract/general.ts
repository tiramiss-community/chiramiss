// Derived from misskey-dev/summaly (MIT)
import type http from 'node:http';
import { type ContextRequest, type ScrapeContext, fetchWithContext } from '@/context.js';
import { parseHead } from '@/html/head.js';
import { decodeHtml } from '@/http/decode.js';
import type { FetchResult } from '@/http/request.js';
import type { Summary } from '@/types.js';
import {
	pickActivityPub,
	pickDescription,
	pickFaviconHref,
	pickFediverseCreator,
	pickImage,
	pickMetaPlayer,
	pickSiteName,
	pickThumbnailStyle,
	pickTitle,
} from './fields.js';
import { resolveIcon } from './icon.js';
import { fetchOEmbedPlayer } from './oembed.js';
import { isSensitive } from './sensitive.js';
import { cleanupTitle } from './text.js';

export type Page = {
	/** Final URL after redirects */
	url: URL;
	/** Decoded HTML */
	html: string;
	headers: http.IncomingHttpHeaders;
};

/** The GET of an HTML page with the context's settings. Rejects non-HTML responses. */
export function pageRequest(ctx: ScrapeContext, url: string): ContextRequest {
	return {
		url,
		method: 'GET',
		headers: {
			'accept': 'text/html,application/xhtml+xml',
			'accept-language': ctx.options.lang ?? undefined,
		},
		typeFilter: /^(text\/html|application\/xhtml\+xml)/,
	};
}

/** The page of a response to pageRequest. */
export function toPage(res: FetchResult): Page {
	return {
		url: new URL(res.url),
		html: decodeHtml(res.body, res.headers['content-type']),
		headers: res.headers,
	};
}

/** GETs an HTML page with the context's settings. Rejects non-HTML responses. */
export async function fetchPage(ctx: ScrapeContext, url: URL): Promise<Page> {
	return toPage(await fetchWithContext(ctx, pageRequest(ctx, url.href)));
}

/**
 * Builds a summary from a fetched page (upstream parseGeneral()).
 * `url` is the page URL used for the site name and for resolving relative links.
 */
export async function summarizePage(ctx: ScrapeContext, url: URL, page: Pick<Page, 'html' | 'headers'>): Promise<Summary | null> {
	const head = parseHead(page.html);

	const title = pickTitle(head);
	const description = pickDescription(head);
	const siteName = pickSiteName(head, url);

	const [icon, oEmbed] = await Promise.all([
		resolveIcon(ctx, pickFaviconHref(head), url),
		fetchOEmbedPlayer(ctx, head, url),
	]);

	return {
		title: cleanupTitle(title, siteName) || siteName || null,
		icon,
		description: description === title ? null : description,
		thumbnail: pickImage(head, url),
		thumbnailStyle: pickThumbnailStyle(head),
		player: oEmbed ?? pickMetaPlayer(head),
		sitename: siteName || null,
		sensitive: isSensitive(head, page.headers),
		activityPub: pickActivityPub(head),
		fediverseCreator: pickFediverseCreator(head),
	};
}

/** Fetches `url` and summarizes it with the generic (non-provider) rules. */
export async function scrapeGeneral(ctx: ScrapeContext, url: URL): Promise<Summary | null> {
	const page = await fetchPage(ctx, url);

	// Like upstream general(), the requested URL (not the post-redirect one) is the base.
	return await summarizePage(ctx, url, page);
}
