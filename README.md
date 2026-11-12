# chiramiss

A [summaly](https://github.com/misskey-dev/summaly)-compatible library and standalone server that summarizes web pages:
give it a URL and it returns the page's title, description, thumbnail, icon, oEmbed player and so on.
Misskey-family servers (tiramiss, endolphin, Misskey itself) use such summaries for URL previews.

- **Library**: [`@tiramiss-community/chiramiss`](https://www.npmjs.com/package/@tiramiss-community/chiramiss) on npm.
  A drop-in replacement for `@misskey-dev/summaly` v5.5.2.
- **Server**: the Docker image `ghcr.io/tiramiss-community/chiramiss` (linux/amd64, linux/arm64).
  Works as the "summary proxy" of a Misskey server (`urlPreviewSummaryProxyUrl`).

Compared with upstream summaly, chiramiss

- blocks requests to private IP addresses **before connecting** (redirects included), not after receiving the response;
- keeps per-call settings (such as the HTTP `agent`) per call instead of in module-level state, so differently
  configured calls in one process do not interfere;
- shares in-flight requests for the same URL and caches results (failures included) for a short time,
  so a URL shown on many timelines at once reaches the target site once;
- parses only what it needs (mostly `<head>`) instead of building a DOM of the whole page;
- supports outbound HTTP(S) proxies in the standalone server, with the private IP block still in effect.

See [Performance](#performance) for how it compares with summaly in speed and in the load it puts on sites.

Requires Node.js `^22.22.2 || ^24.17.0 || >=26.4.0`. ESM only.

## Quick start

### Library

```sh
npm install @tiramiss-community/chiramiss
```

```ts
import { summarize } from '@tiramiss-community/chiramiss';

const summary = await summarize('https://example.com/', { lang: 'ja-JP' });
```

See the [library guide](docs/library.md) for options, caching, custom plugins and proxies.

### Docker server

```sh
docker run --rm -p 127.0.0.1:3000:3000 ghcr.io/tiramiss-community/chiramiss:latest
curl 'http://127.0.0.1:3000/?url=https://example.com/'
```

> [!WARNING]
> The server fetches any URL its clients ask for. Do not expose it to the internet; let only your Misskey server
> reach it.

See the [server guide](docs/server.md) for Docker Compose, configuration, HTTP API and deployment details.

## Using it in Misskey

Use the library as an npm alias for `@misskey-dev/summaly`, import it directly, or run the standalone server
and set its URL as "Summary proxy URL" (`urlPreviewSummaryProxyUrl`) in the control panel.

The [Misskey guide](docs/misskey.md) covers all three approaches. The
[compatibility guide](docs/compatibility.md) describes upstream aliases and behavior differences.

## Documentation

| Guide | What it covers |
|:------|:---------------|
| [Misskey integration](docs/misskey.md) | npm alias, direct imports, summary proxy setup |
| [Library](docs/library.md) | Usage, options, caching, plugins, outbound proxies |
| [Standalone server](docs/server.md) | Docker, Compose, HTTP API, environment variables, operation |
| [summaly compatibility](docs/compatibility.md) | Interface compatibility, aliases, behavior differences, known limitations |
| [Benchmark](docs/benchmark.md) | Full results, measurement conditions, notes and environment |
| [Publishing](docs/publishing.md) | Maintainer release setup (Japanese) |

## About ChiramissBot

If you found `ChiramissBot` in your access logs, this section is for you.

```
ChiramissBot/<version> (+https://github.com/tiramiss-community/chiramiss#readme)
```

**What it does.** ChiramissBot makes link previews. When a user of a Misskey-family server (or another service
that uses chiramiss) posts a URL, the server fetches that page once to build the preview card shown with the post
(title, description, thumbnail). Besides the page itself it may fetch what the page names for the preview (its
oEmbed endpoint and favicon) and follow its redirects. For a few sites (Wikipedia, NVD, npm) it reads their public API
instead of the page's HTML: a posted URL of such a site gets only a HEAD to follow its redirects, and when a URL of
another site redirects there, the GET that followed the redirects stops reading the page once the redirects land on
it. It does not crawl and does not follow other links. chiramiss keeps the summary only in a short-lived cache.

**When it accesses your site.** Only when a URL of your site has been posted and its preview is needed. Concurrent
requests for the same URL are merged into one and the result is cached for a few minutes, so a post that spreads
quickly does not turn into a burst of requests to your site.

**How to identify it.** By the User-Agent above. ChiramissBot is not a central crawler: each server that uses
chiramiss fetches pages itself, from its own IP addresses, so there is no fixed IP range. Server administrators can
change the User-Agent; Misskey-family servers in particular usually send `SummalyBot/<version> (<server URL>; +...)`
instead (see [Known limitations](docs/compatibility.md#known-limitations)), which names the server that made the request.

**Contact.** Please open an issue at <https://github.com/tiramiss-community/chiramiss/issues>.
For problems with requests from one particular server, contacting that server's administrator is usually faster.

## Performance

At commit [`90e1c62`](https://github.com/tiramiss-community/chiramiss/commit/90e1c627b5c3ab6d322e501e5f5f396a82b4cf29)
(measured 2026-11-12, before the GET-first change in PR #16), chiramiss summarized a typical article page
**6.6× faster** than summaly (median, no added network latency). This includes the favicon-check cache:
summaly sent 1.0 `HEAD /favicon.ico` per page and chiramiss 0.0. With a unique favicon URL per page,
the measured ratio was **5.5×**.

The benchmark uses a local fake site under equal CPU and memory limits; no third-party site is contacted.
See the [full report](docs/benchmark.md) for tables, caveats and environment, and the
[benchmark guide](packages/bench/README.md) to reproduce the measurements.

## License and credits

[MIT](./LICENSE).

chiramiss is derived from [misskey-dev/summaly](https://github.com/misskey-dev/summaly)
(Copyright (c) 2016-2024 syuilo, MIT). Files derived from summaly carry a `Derived from misskey-dev/summaly (MIT)`
header, and the [LICENSE](./LICENSE) keeps summaly's copyright notice. Thanks to the summaly authors and contributors.
