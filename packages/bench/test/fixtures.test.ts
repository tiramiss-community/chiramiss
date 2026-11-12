import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { PAGE_KINDS, buildFixtures, expectationFor, pagePath } from '../src/fixtures.ts';

const sha256 = (body: Uint8Array): string => createHash('sha256').update(body).digest('hex');
const origin = 'https://origin.bench';
const decode = (body: Uint8Array): string => new TextDecoder('utf-8').decode(body);

describe('fixtures', () => {
	const fixtures = buildFixtures();

	test('bytes are deterministic', () => {
		const other = buildFixtures();
		const paths = [...PAGE_KINDS.map(pagePath), '/oembed.json', '/favicon.ico'];

		for (const path of paths) {
			const a = fixtures.respond('GET', new URL(path, origin));
			const b = other.respond('GET', new URL(path, origin));

			expect(sha256(a.body)).toBe(sha256(b.body));
		}
	});

	test('article is tens of KB with OGP', () => {
		const { body } = fixtures.respond('GET', new URL('/article', origin));
		const html = decode(body);

		expect(body.length).toBeGreaterThanOrEqual(20_000);
		expect(body.length).toBeLessThanOrEqual(80_000);
		expect(html).toContain('og:title');
		expect(html).toContain('og:image');
		expect(html).toContain(expectationFor('article').title);
	});

	test('large page is 1-2 MB and its <head> ends within the first 16 KB', () => {
		const { body } = fixtures.respond('GET', new URL('/large', origin));
		const html = decode(body);

		expect(body.length).toBeGreaterThanOrEqual(1_000_000);
		expect(body.length).toBeLessThanOrEqual(2_000_000);
		expect(html.indexOf('</head>')).toBeGreaterThan(0);
		expect(html.indexOf('</head>')).toBeLessThan(16_384);
		expect(html).toContain(expectationFor('large').title);
	});

	test('sjis page is real Shift_JIS', () => {
		const res = fixtures.respond('GET', new URL('/sjis', origin));

		expect(new TextDecoder('shift_jis').decode(res.body)).toContain(expectationFor('sjis').title);
		expect(() => new TextDecoder('utf-8', { fatal: true }).decode(res.body)).toThrow();
		expect(res.headers['content-type']).toBe('text/html');
		expect(new TextDecoder('latin1').decode(res.body)).toContain('<meta charset="Shift_JIS">');
	});

	test('oembed page links oEmbed JSON whose iframe src is the expected player url', () => {
		const page = decode(fixtures.respond('GET', new URL('/oembed-page', origin)).body);

		expect(page).toContain('<link rel="alternate" type="application/json+oembed" href="https://origin.bench/oembed.json">');
		expect(page).toContain(expectationFor('oembed').title);

		const json = JSON.parse(decode(fixtures.respond('GET', new URL('/oembed.json', origin)).body)) as { html: string };
		const src = /<iframe src="([^"]+)"/.exec(json.html)?.[1];

		expect(src).toBe(expectationFor('oembed').playerUrl);
		expect(src).toBe('https://origin.bench/embed');
	});

	test('redirect answers 302 to /article keeping the query', () => {
		const res = fixtures.respond('GET', new URL('/redirect?n=7', origin));

		expect(res.status).toBe(302);
		expect(res.headers['location']).toBe('/article?n=7');
		expect(expectationFor('redirect')).toEqual(expectationFor('article'));
	});

	test('every page links the favicon', () => {
		for (const kind of PAGE_KINDS) {
			const res = fixtures.respond('GET', new URL(pagePath(kind), origin));

			if (res.status === 200) {
				expect(new TextDecoder('latin1').decode(res.body)).toContain('<link rel="icon" href="/favicon.ico">');
			}
		}
	});

	test('favicon answers GET and HEAD; HEAD has no body', () => {
		const get = fixtures.respond('GET', new URL('/favicon.ico', origin));
		const head = fixtures.respond('HEAD', new URL('/favicon.ico', origin));

		expect(get.status).toBe(200);
		expect(get.headers['content-type']).toBe('image/x-icon');
		expect(get.body.length).toBeGreaterThan(100);
		expect(head.status).toBe(200);
		expect(head.headers['content-type']).toBe('image/x-icon');
		expect(head.body.length).toBe(0);
	});

	test('query string does not change the bytes', () => {
		const a = fixtures.respond('GET', new URL('/article?n=1', origin));
		const b = fixtures.respond('GET', new URL('/article?n=2', origin));

		expect(sha256(a.body)).toBe(sha256(b.body));
	});

	test('unknown path is 404', () => {
		expect(fixtures.respond('GET', new URL('/nope', origin)).status).toBe(404);
	});
});
