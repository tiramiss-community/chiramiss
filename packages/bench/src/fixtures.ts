import type { Expectation, FixtureResponse, Fixtures, PageKind } from './types.ts';

export const PAGE_KINDS: readonly PageKind[] = ['article', 'large', 'sjis', 'oembed', 'redirect'];

const PAGE_PATHS: Record<PageKind, string> = {
	article: '/article',
	large: '/large',
	sjis: '/sjis',
	oembed: '/oembed-page',
	redirect: '/redirect',
};

const EXPECTATIONS: Record<PageKind, Expectation> = {
	article: { title: 'Bench article' },
	large: { title: 'Bench large page' },
	sjis: { title: 'べんちまあくのぺえじ' },
	oembed: { title: 'Bench oEmbed page', playerUrl: 'https://origin.bench/embed' },
	redirect: { title: 'Bench article' },
};

const ORIGIN = 'https://origin.bench';
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

const FAVICON_LINK = '<link rel="icon" href="/favicon.ico">';

function head(title: string, extra = ''): string {
	return [
		'<!DOCTYPE html>',
		'<html lang="en">',
		'<head>',
		'<meta charset="utf-8">',
		`<title>${title}</title>`,
		`<meta property="og:title" content="${title}">`,
		'<meta property="og:description" content="Fixture page for the chiramiss benchmark.">',
		`<meta property="og:image" content="${ORIGIN}/image.png">`,
		'<meta property="og:site_name" content="origin.bench">',
		FAVICON_LINK,
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

function articlePage(): string {
	const rand = mulberry32(1);

	return `${head(EXPECTATIONS.article.title)}<body>\n<h1>${EXPECTATIONS.article.title}</h1>\n${paragraphs(rand, 40_000)}</body>\n</html>\n`;
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
		`<meta property="og:description" content="${hiragana(rand, 40)}">\n`,
		`${FAVICON_LINK}\n</head>\n<body>\n<h1>${title}</h1>\n`,
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

export function buildFixtures(): Fixtures {
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
		['/favicon.ico', {
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

			const found = pages.get(url.pathname);

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
