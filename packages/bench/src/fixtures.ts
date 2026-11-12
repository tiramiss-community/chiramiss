import type { Expectation, FixtureResponse, Fixtures, PageKind } from './types.ts';

/** ページの種類。article-unique-icon は article の変種なので含めない。 */
export const PAGE_KINDS: readonly PageKind[] = ['article', 'large', 'sjis', 'oembed', 'redirect'];

const PAGE_PATHS: Record<PageKind, string> = {
	'article': '/article',
	'article-unique-icon': '/article-unique-icon',
	'large': '/large',
	'sjis': '/sjis',
	'oembed': '/oembed-page',
	'redirect': '/redirect',
};

const ORIGIN = 'https://origin.bench';
const FAVICON_PATH = '/favicon.ico';
const DESCRIPTION = 'Fixture page for the chiramiss benchmark.';
const SJIS_DESCRIPTION = 'しふとじすでかかれたべんちまあくのぺえじです';
const SITE_NAME = 'origin.bench';
const THUMBNAIL = `${ORIGIN}/image.png`;
const ICON = `${ORIGIN}${FAVICON_PATH}`;
const COMMON: Omit<Expectation, 'title'> = { description: DESCRIPTION, icon: ICON, thumbnail: THUMBNAIL, sitename: SITE_NAME };

const EXPECTATIONS: Record<PageKind, Expectation> = {
	'article': { ...COMMON, title: 'Bench article' },
	// favicon の URL に要約させた URL のクエリを付ける。ページごとに別の URL になり、favicon 確認のキャッシュが当たらない。
	'article-unique-icon': { ...COMMON, title: 'Bench article', icon: `${ICON}{search}` },
	'large': { ...COMMON, title: 'Bench large page' },
	'sjis': { ...COMMON, title: 'べんちまあくのぺえじ', description: SJIS_DESCRIPTION },
	'oembed': { ...COMMON, title: 'Bench oEmbed page', playerUrl: `${ORIGIN}/embed` },
	'redirect': { ...COMMON, title: 'Bench article', finalPath: PAGE_PATHS.article },
};

const WORDS = [
	'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima',
	'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey',
	'xray', 'yankee', 'zulu',
];

export function pagePath(kind: PageKind): string {
	return PAGE_PATHS[kind];
}

export function expectationFor(kind: PageKind): Expectation {
	return EXPECTATIONS[kind];
}

// 固定シードの PRNG。Math.random は使わない。
function mulberry32(seed: number): () => number {
	let a = seed;

	return () => {
		a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);

		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function words(rand: () => number, count: number): string {
	const out: string[] = [];

	for (let i = 0; i < count; i++) {
		out.push(WORDS[Math.floor(rand() * WORDS.length)]);
	}

	return out.join(' ');
}

function paragraphs(rand: () => number, minBytes: number): string {
	let out = '';

	while (out.length < minBytes) {
		out += `<p>${words(rand, 60)}.</p>\n`;
	}

	return out;
}

function faviconLink(href = FAVICON_PATH): string {
	return `<link rel="icon" href="${href}">`;
}

function head(title: string, extra = '', faviconHref = FAVICON_PATH): string {
	return [
		'<!DOCTYPE html>',
		'<html lang="en">',
		'<head>',
		'<meta charset="utf-8">',
		`<title>${title}</title>`,
		`<meta property="og:title" content="${title}">`,
		`<meta property="og:description" content="${DESCRIPTION}">`,
		`<meta property="og:image" content="${THUMBNAIL}">`,
		`<meta property="og:site_name" content="${SITE_NAME}">`,
		faviconLink(faviconHref),
		extra,
		'</head>',
	].filter((line) => line !== '').join('\n') + '\n';
}

function htmlResponse(html: string): FixtureResponse {
	return {
		status: 200,
		headers: { 'content-type': 'text/html; charset=utf-8' },
		body: new TextEncoder().encode(html),
	};
}

// ひらがな U+3041〜U+3093 は Shift_JIS の 0x829F〜0x82F1 に連続して対応する。
function toShiftJis(text: string): Uint8Array {
	const bytes: number[] = [];

	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 0;

		if (code >= 0x3041 && code <= 0x3093) {
			const sjis = 0x829F + (code - 0x3041);

			bytes.push(sjis >> 8, sjis & 0xFF);
		} else if (code < 0x80) {
			bytes.push(code);
		} else {
			throw new Error(`cannot encode U+${code.toString(16)} as Shift_JIS`);
		}
	}

	return Uint8Array.from(bytes);
}

function hiragana(rand: () => number, count: number): string {
	let out = '';

	for (let i = 0; i < count; i++) {
		out += String.fromCodePoint(0x3041 + Math.floor(rand() * 83));
	}

	return out;
}

function articlePage(faviconHref = FAVICON_PATH): string {
	const rand = mulberry32(1);

	return `${head(EXPECTATIONS.article.title, '', faviconHref)}<body>\n<h1>${EXPECTATIONS.article.title}</h1>\n${paragraphs(rand, 40_000)}</body>\n</html>\n`;
}

function largePage(): string {
	const rand = mulberry32(2);

	return `${head(EXPECTATIONS.large.title)}<body>\n<h1>${EXPECTATIONS.large.title}</h1>\n${paragraphs(rand, 1_500_000)}</body>\n</html>\n`;
}

function sjisPage(): FixtureResponse {
	const rand = mulberry32(3);
	const title = EXPECTATIONS.sjis.title;
	const parts = [
		'<!DOCTYPE html>\n<html>\n<head>\n<meta charset="Shift_JIS">\n',
		`<title>${title}</title>\n`,
		`<meta property="og:title" content="${title}">\n`,
		`<meta property="og:description" content="${SJIS_DESCRIPTION}">\n`,
		`<meta property="og:image" content="${THUMBNAIL}">\n`,
		`<meta property="og:site_name" content="${SITE_NAME}">\n`,
		`${faviconLink()}\n</head>\n<body>\n<h1>${title}</h1>\n`,
	];

	for (let i = 0; i < 200; i++) {
		parts.push(`<p>${hiragana(rand, 80)}</p>\n`);
	}

	parts.push('</body>\n</html>\n');

	return {
		status: 200,
		headers: { 'content-type': 'text/html' },
		body: toShiftJis(parts.join('')),
	};
}

function oembedPage(): string {
	const rand = mulberry32(4);
	const link = `<link rel="alternate" type="application/json+oembed" href="${ORIGIN}/oembed.json">`;

	return `${head(EXPECTATIONS.oembed.title, link)}<body>\n<h1>${EXPECTATIONS.oembed.title}</h1>\n${paragraphs(rand, 2_000)}</body>\n</html>\n`;
}

const OEMBED_JSON = '{"version":"1.0","type":"rich","html":"<iframe src=\\"https://origin.bench/embed\\" width=\\"480\\" height=\\"270\\"></iframe>","width":480,"height":270}';

function faviconBytes(): Uint8Array {
	const rand = mulberry32(5);
	const bytes = new Uint8Array(400);

	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Math.floor(rand() * 256);
	}

	return bytes;
}

// 属性値に入れるので & と " だけ逃がす。URL#search は < > をすでにパーセントエンコードしている。
function escapeAttribute(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

/** article と同じバイト列で、favicon の href だけを `/favicon.ico<要約させた URL のクエリ>` にしたページ。 */
function uniqueIconArticle(): (url: URL) => FixtureResponse {
	const mark = '\u0000';
	const [before, after] = articlePage(`${FAVICON_PATH}${mark}`).split(mark).map((part) => new TextEncoder().encode(part)) as [Uint8Array, Uint8Array];
	const headers = { 'content-type': 'text/html; charset=utf-8' };

	return (url) => {
		const search = new TextEncoder().encode(escapeAttribute(url.search));
		const body = new Uint8Array(before.length + search.length + after.length);

		body.set(before, 0);
		body.set(search, before.length);
		body.set(after, before.length + search.length);

		return { status: 200, headers, body };
	};
}

export function buildFixtures(): Fixtures {
	const uniqueIcon = uniqueIconArticle();
	const pages = new Map<string, FixtureResponse>([
		[PAGE_PATHS.article, htmlResponse(articlePage())],
		[PAGE_PATHS.large, htmlResponse(largePage())],
		[PAGE_PATHS.sjis, sjisPage()],
		[PAGE_PATHS.oembed, htmlResponse(oembedPage())],
		['/oembed.json', {
			status: 200,
			headers: { 'content-type': 'application/json' },
			body: new TextEncoder().encode(OEMBED_JSON),
		}],
		[FAVICON_PATH, {
			status: 200,
			headers: { 'content-type': 'image/x-icon' },
			body: faviconBytes(),
		}],
	]);

	return {
		respond(method, url) {
			if (url.pathname === PAGE_PATHS.redirect) {
				return { status: 302, headers: { location: `${PAGE_PATHS.article}${url.search}` }, body: new Uint8Array(0) };
			}

			const found = url.pathname === PAGE_PATHS['article-unique-icon'] ? uniqueIcon(url) : pages.get(url.pathname);

			if (found === undefined) {
				return { status: 404, headers: { 'content-type': 'text/plain' }, body: new TextEncoder().encode('not found') };
			}

			if (method === 'HEAD') {
				return { status: found.status, headers: found.headers, body: new Uint8Array(0) };
			}

			return found;
		},
	};
}
