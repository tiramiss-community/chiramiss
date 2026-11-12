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

See [Benchmark](#benchmark) for how it compares with summaly in speed and in the load it puts on sites.

Requires Node.js `^22.22.2 || ^24.17.0 || >=26.4.0`. ESM only.

## Contents

- [About ChiramissBot](#about-chiramissbot)
- [Compatibility with summaly](#compatibility-with-summaly)
- [Names kept for summaly compatibility](#names-kept-for-summaly-compatibility)
- [Using it in Misskey](#using-it-in-misskey)
- [Library usage](#library-usage)
- [Standalone server](#standalone-server)
- [Docker](#docker)
- [Benchmark](#benchmark)
- [Known limitations](#known-limitations)
- [License and credits](#license-and-credits)

## About ChiramissBot

If you found `ChiramissBot` in your access logs, this section is for you.

```
ChiramissBot/<version> (+https://github.com/tiramiss-community/chiramiss#readme)
```

**What it does.** ChiramissBot makes link previews. When a user of a Misskey-family server (or another service
that uses chiramiss) posts a URL, the server fetches that page once to build the preview card shown with the post
(title, description, thumbnail). Besides the page itself it may fetch what the page names for the preview (its
oEmbed endpoint and favicon) and follow its redirects. For a few sites (Wikipedia, NVD, npm) it reads their public API
instead of the page's HTML (the page URL still gets a HEAD to follow its redirects). It does not crawl and does not
follow other links. chiramiss keeps the summary only in a short-lived cache.

**When it accesses your site.** Only when a URL of your site has been posted and its preview is needed. Concurrent
requests for the same URL are merged into one and the result is cached for a few minutes, so a post that spreads
quickly does not turn into a burst of requests to your site.

**How to identify it.** By the User-Agent above. ChiramissBot is not a central crawler: each server that uses
chiramiss fetches pages itself, from its own IP addresses, so there is no fixed IP range. Server administrators can
change the User-Agent; Misskey-family servers in particular usually send `SummalyBot/<version> (<server URL>; +...)`
instead (see [Known limitations](#known-limitations)), which names the server that made the request.

**Contact.** Please open an issue at <https://github.com/tiramiss-community/chiramiss/issues>.
For problems with requests from one particular server, contacting that server's administrator is usually faster.

## Compatibility with summaly

chiramiss keeps the public interface of summaly v5.5.2. Results can differ from upstream in details (how a title or
thumbnail is picked); the compatibility target is the interface, not byte-identical output.

chiramiss has its own names (`summarize`, `SummaryResult`, `CHIRAMISS_*`, ...). summaly's names are kept as aliases of
them, so code and configuration written for summaly keep working (see
[Names kept for summaly compatibility](#names-kept-for-summaly-compatibility)).

### Library (`@tiramiss-community/chiramiss`)

- Exports: `summarize(url, options?)`, `version`, `defaultSummarizeOptions`, the types `SummaryResult`,
  `SummarizeOptions`, `SummaryPlugin` (and `Summary`, `Player`, `GeneralScrapingOptions`), and the Fastify plugin as
  the default export (plus `summaryCacheControl`, see [Library usage](#library-usage)). summaly's `summaly`, `summalyDefaultOptions`, `SummalyResult`, `SummalyOptions` and
  `SummalyPlugin` are exported too, as aliases of these.
- `SummarizeOptions` keeps upstream's keys and meanings: `lang`, `followRedirects`, `plugins`, `agent`, `userAgent`,
  `responseTimeout`, `operationTimeout`, `contentLengthLimit`, `contentLengthRequired`.
  `agent` takes `{ http?: http.Agent, https?: https.Agent }` and the given agents are used for the actual requests.
- `SummaryResult` has the same shape as upstream's `SummalyResult`: `title`, `icon`, `description`, `thumbnail`,
  `thumbnailStyle`, `sitename`, `player` (`url`, `width`, `height`, `allow`), `sensitive`, `activityPub`,
  `fediverseCreator`, `url`.
- Custom plugins (`SummaryPlugin`: `test(url)`, `summarize(url, opts)`) work as before. Built-in plugins cover
  Amazon, Bluesky, Wikipedia and branch.io deep links, as upstream (plus NVD and npm; see
  [Differences from upstream](#differences-from-upstream)).
- The package is ESM, so `await import('@misskey-dev/summaly')` keeps working.
- `version` is chiramiss's own version (it does not continue upstream's numbering).
- The published `.d.ts` does not depend on `fastify`, so frontend packages that import only `SummaryResult` (or
  `SummalyResult`) type-check without it.

### Server

- `GET /?url=...&lang=...` returns the summary as JSON; a missing `url` gives 400, a failed summary gives 500, both
  with `{ "error": ... }`, as upstream.
- The settings upstream reads from `SUMMALY_HOST`, `SUMMALY_PORT`, `SUMMALY_LANG`, `SUMMALY_USER_AGENT`,
  `SUMMALY_FOLLOW_REDIRECTS`, `SUMMALY_RESPONSE_TIMEOUT`, `SUMMALY_OPERATION_TIMEOUT`, `SUMMALY_CONTENT_LENGTH_LIMIT`
  and `SUMMALY_CONTENT_LENGTH_REQUIRED` keep their meanings. chiramiss reads them as `CHIRAMISS_*` first and still
  accepts the `SUMMALY_*` names. Invalid values stop the server at startup.

## Names kept for summaly compatibility

chiramiss's own names are the primary ones. summaly's names are still accepted as aliases: the library exports them
as the very same values and types (`summaly === summarize`), and the server and library read the `SUMMALY_*`
environment variables too. They are not deprecated.

| summaly name (alias)                          | chiramiss name                                  |
|:----------------------------------------------|:------------------------------------------------|
| `summaly(url, options)`                       | `summarize(url, options)`                       |
| `createSummaly(base)`                         | `createSummarizer(base)`                        |
| `summalyDefaultOptions`                       | `defaultSummarizeOptions`                       |
| `SummalyResult`                               | `SummaryResult`                                 |
| `SummalyOptions`                              | `SummarizeOptions`                              |
| `SummalyPlugin`                               | `SummaryPlugin`                                 |
| `SUMMALY_*` (every server variable)           | `CHIRAMISS_*` (same suffix, e.g. `SUMMALY_HOST` → `CHIRAMISS_HOST`) |
| `SUMMALY_ALLOW_PRIVATE_IP` (read by the library) | `CHIRAMISS_ALLOW_PRIVATE_IP`                 |

For each environment variable, `CHIRAMISS_<NAME>` is used when it is set; otherwise `SUMMALY_<NAME>` is used. An empty
value counts as unset, so `CHIRAMISS_PORT=` falls back to `SUMMALY_PORT`. When a value is invalid, the error names
the variable that was actually read.

The default export (the Fastify plugin), the server's HTTP API, `version` and the default User-Agent
(`ChiramissBot/...`) are the same whichever names you use.

### Differences from upstream

Behavior that intentionally differs from summaly v5.5.2:

- **Private IP blocking** happens before connecting, for every hop of a redirect and for the oEmbed and favicon
  requests too. Upstream checked the address after receiving the response.
- **`agent` hands the blocking over per scheme, and only for an actual agent.** As upstream, when you pass an agent,
  blocking private addresses becomes that agent's job (Misskey's agents do it). chiramiss applies this per scheme:
  passing only `agent.http` keeps chiramiss's own blocking for `https:` requests. An entry without an agent
  (`{ http: undefined }`) does not turn the blocking off, unlike upstream. To turn it off for tests, set
  `CHIRAMISS_ALLOW_PRIVATE_IP=true` (or `SUMMALY_ALLOW_PRIVATE_IP=true`).
- **`contentLengthLimit`** caps both the bytes received on the wire (compressed) and the decompressed body.
- **The `content-length` check** compares the raw header with `contentLengthLimit` even for compressed responses.
  Upstream (got) effectively skipped it for compressed responses, so a compressed page whose `content-length`
  exceeds the limit is now rejected even if it would decompress to less.
- **A timeout of `0`** (`responseTimeout`, `operationTimeout`) means no timeout, as in Node.js.
- **The page encoding** is decided the way browsers do: BOM, then the `Content-Type` charset, then a
  `<meta charset>` in the first 8 KB, and only then byte-level detection (chardet) on the first 16 KB.
  Upstream ran chardet on the whole body first, which was the most expensive step of a summary.
  A page whose header or meta declares the wrong charset is now decoded as declared.
- **oEmbed and favicon requests** use the same User-Agent, timeouts and size limit as the page request.
- **Connections are reused for a short time.** The requests one summary sends to the same site (the HEAD that
  follows redirects, the page, the favicon, oEmbed) share a keep-alive connection, redirect hops included: a redirect
  response without a body or with a short one (up to 16 KB, arriving within 0.5 seconds) is read to its end so that its
  connection serves the next hop, while a longer body is not read and its connection is closed. A connection that
  finished its response stays open for up to 4 seconds of idle time, so the next summary of that site made by the same summarizer
  with the same `allowedPrivateNetworks` reuses it instead of opening a new one (upstream reuses connections too, through
  Node's global agent). Each summarizer (`createSummarizer`, and the one behind `summarize`) keeps its own connections:
  separate summarizers, and summaries with different `allowedPrivateNetworks`, never share one, and every connection is
  checked against the private IP block of its setting when it opens. At most 4 idle connections are kept per site,
  idle connections never keep the process from exiting, and a request that fails or times out never leaves its
  connection for reuse. This applies to chiramiss's own connections, not to a caller-supplied `agent` or to proxied
  requests (a proxied connection is closed when its summary ends). With the private IP block turned off
  (`CHIRAMISS_ALLOW_PRIVATE_IP=true` or `SUMMALY_ALLOW_PRIVATE_IP=true`), requests go through Node's global agent, as
  upstream does. As with any keep-alive client, a server that wrongly sends a body with a HEAD response can make the
  next request on that connection read those bytes as part of its response, and that request may now belong to a later
  summary. Only responses from the same host and port (in the same summarizer and setting) can be mixed up this way;
  when the bytes break the response, the request is sent again on a new connection.
- **Amazon** pages are fetched with `followRedirects: true` and `contentLengthRequired: false`, like upstream's
  Amazon plugin, whatever the caller set; the other settings (agent, User-Agent, timeouts, size limit) apply.
- **NVD** CVE pages (`https://nvd.nist.gov/vuln/detail/CVE-YYYY-NNNN`) have a built-in provider that upstream lacks.
  The page itself carries no metadata, so the summary comes from the NVD API 2.0 (`services.nvd.nist.gov`): the
  title is the CVE ID with the CVSS severity and score of the newest CVSS version (e.g. `CVE-2026-16478 (HIGH 7.0)`),
  and the description is the English CVE text. The API is used without a key, which NVD limits to 5 requests per 30
  seconds per IP; beyond that the summary fails. Failures are cached for `errorCacheTtl` and results for `cacheTtl`.
  Built-in providers are tried before custom plugins, so a custom plugin for `nvd.nist.gov` no longer gets these URLs.
- **npm** package pages (`https://www.npmjs.com/package/<name>`, `/package/@<scope>/<name>`, either with
  `/v/<version>`; also on `npmjs.com`, `www.npmjs.org` and `npmjs.org`) have a built-in provider that upstream lacks.
  npmjs.com answers bots with a Cloudflare challenge instead of the page, so the summary comes from the public npm
  registry (`registry.npmjs.org`, the `latest` dist-tag or the version in the URL): the title is the package name
  (`<name>@<version>` when the URL names a version) and the description is the package's description. An unknown
  package or version (the registry answers 404) makes the summary fail. Package names are case-sensitive, so the name
  in the URL is used as is. Built-in providers are tried before custom plugins, so a custom plugin for `npmjs.com`
  (or `npmjs.org`) no longer gets these URLs.
- **Custom plugins** receive the options as the caller gave them, like upstream: keys that were not set stay
  `undefined` (defaults are not filled in) and `lang` is passed as given.
- **Results are cached and in-flight requests are shared by default** (see [Caching](#caching-and-request-sharing)).
  Each caller gets its own copy, so modifying a result does not affect others.
- **Favicon checks are cached and shared too**, so pages of one site summarized in a row (or at once) send one HEAD
  for their common favicon instead of one each (see [Caching](#caching-and-request-sharing)).
- **Default User-Agent** is `ChiramissBot/<version> (+https://github.com/tiramiss-community/chiramiss#readme)`.
- **The server** additionally reads the options Misskey sends along with `url` (see [Query parameters](#query-parameters)),
  serves `GET /healthz`, supports outbound proxies, and answers 400 when `url` is not a single string
  (e.g. given twice).
- **`Cache-Control`** is sent by the server and the Fastify plugin (see [Standalone server](#standalone-server)).
  Upstream's Fastify server sent none.

## Using it in Misskey

There are two ways to use the library in a Misskey-family server, plus the standalone server.

**Swap it in with an npm alias (no code changes).** Misskey imports the package as `@misskey-dev/summaly`, so replace
it with an npm alias. Do this in every package that depends on it (`packages/backend`, and `packages/frontend` /
`packages/frontend-embed`, which use its types):

```json
{
  "dependencies": {
    "@misskey-dev/summaly": "npm:@tiramiss-community/chiramiss@^0.1.0"
  }
}
```

Then run `pnpm install`. No code changes are needed: the code keeps calling `summaly` and using `SummalyResult`,
which are aliases of chiramiss's names.

**Import `@tiramiss-community/chiramiss` directly.** Add the package under its own name and use chiramiss's names:

```json
{
  "dependencies": {
    "@tiramiss-community/chiramiss": "^0.1.0"
  }
}
```

```ts
// packages/backend (e.g. UrlPreviewService)
const { summarize } = await import('@tiramiss-community/chiramiss');
const summary = await summarize(url, { lang, agent: { http: httpAgent, https: httpsAgent } });

// packages/frontend, packages/frontend-embed
import type { SummaryResult } from '@tiramiss-community/chiramiss';
```

Alternatively, run the [standalone server](#standalone-server) and set its URL (for example
`http://chiramiss:3000/`) as "Summary proxy URL" (`urlPreviewSummaryProxyUrl`) in the control panel.

## Library usage

```ts
import { summarize } from '@tiramiss-community/chiramiss';

const summary = await summarize('https://example.com/', { lang: 'ja-JP' });
```

As a Fastify plugin (serves `GET /`, like upstream):

```ts
import chiramiss from '@tiramiss-community/chiramiss';

fastify.register(chiramiss, { /* SummarizeOptions */ });
```

The plugin sets `Cache-Control` on its responses so that a reverse proxy or CDN can cache them, by the same rules as
the [standalone server](#standalone-server) (from the plugin's `cacheTtl` / `errorCacheTtl`, or their defaults).
To use another policy, overwrite the header, for example in an `onSend` hook. When you serve summaries from your own
route, `summaryCacheControl(options, 'ok' | 'error')` returns the same value.

### Options

Upstream options:

| Option                    | Type                                              | Default                          | Description |
|:--------------------------|:--------------------------------------------------|:---------------------------------|:------------|
| **lang**                  | `string \| null`                                  | `null`                           | `Accept-Language` for the request |
| **followRedirects**       | `boolean`                                         | `true`                           | Whether to follow redirects (at most 10) |
| **plugins**               | `SummaryPlugin[]`                                 | `[]`                             | Custom plugins, tried after the built-in ones |
| **agent**                 | `{ http?: http.Agent, https?: https.Agent }`      | none                             | Agents for the requests. A scheme with an agent leaves private IP blocking and proxying to it |
| **userAgent**             | `string`                                          | `ChiramissBot/<version> (+...)`  | `User-Agent` for the request |
| **responseTimeout**       | `number` (ms)                                     | `20000`                          | Timeout for connecting and for each wait for data (socket idle). `0` disables it |
| **operationTimeout**      | `number` (ms)                                     | `60000`                          | Timeout for the whole request, redirects included. `0` disables it |
| **contentLengthLimit**    | `number` (bytes)                                  | `10485760`                       | Error if `content-length`, the received bytes or the decompressed bytes exceed it |
| **contentLengthRequired** | `boolean`                                         | `false`                          | Error if the response has no `content-length` |

Options added by chiramiss:

| Option                     | Type                                                  | Default             | Description |
|:---------------------------|:------------------------------------------------------|:--------------------|:------------|
| **allowedPrivateNetworks** | `string[]`                                            | `[]`                | CIDRs exempt from the private IP block, e.g. `['10.0.0.0/8', 'fd00::/8']` |
| **proxy**                  | `{ http?: string, https?: string, noProxy?: string }` | none                | Outbound proxy for `http:` / `https:` targets (see [Proxies](#proxies)) |
| **cache**                  | `SummaryCache \| false`                               | in-memory cache     | Result cache. `false` disables it |
| **cacheTtl**               | `number` (ms)                                         | `300000` (5 min)    | How long successful results (and favicon checks that succeeded) are kept. `0` does not store them |
| **errorCacheTtl**          | `number` (ms)                                         | `30000` (30 s)      | How long failures (and favicon checks that failed) are kept. `0` does not store them |
| **coordinator**            | `InflightCoordinator \| false`                        | in-process sharing  | Shares in-flight requests for the same key. `false` disables it |

`allowedPrivateNetworks` entries must be canonical CIDRs: IPv4 as four plain decimal numbers without leading zeros
(`192.168.10.0/24`, not `192.168.010.0/24`, which some parsers read as octal), and IPv4 networks written in IPv4
form rather than as IPv4-mapped IPv6 (`::ffff:10.0.0.0/104`). Other notations throw a `TypeError`.

### Caching and request sharing

`summarize()` caches results and shares in-flight requests within the process by default. Two calls share a result
when the URL and every option that can change the result are the same: `lang`, `userAgent`, `followRedirects`, the
timeouts, the size options, `allowedPrivateNetworks`, `proxy`, and the identity of the `agent` and `plugins` objects
(a different agent object counts as a different request). `cache`, `coordinator`, `cacheTtl` and `errorCacheTtl` are
not part of the key.

- Every caller gets its own `structuredClone` of the result, always (with or without a cache). A result that cannot
  be cloned (e.g. a plugin returning a function) therefore becomes an error, and that error is what gets cached.
- Failures are cached too and rethrown as a new `Error` (or `StatusError`, carrying `statusCode` and `statusMessage`)
  with the original `name` and `message`; the stack is not kept, and the message is cut to 1024 characters.
- Keys passed to `SummaryCache` and `InflightCoordinator` are SHA-256 hex digests, so proxy credentials never appear
  in them.
- The identity of `agent` and `plugins` objects in a key is per process (it includes a random value chosen when the
  process starts). A cache shared between processes (e.g. Redis) therefore only shares results of calls without
  `agent` or `plugins` across processes; calls with them are shared within one process.
- The favicon check (the HEAD that decides `icon`) is cached and shared the same way, in the same cache and with the
  same TTLs (`cacheTtl` when it succeeds, `errorCacheTtl` when it fails), keyed by the icon URL and the options that
  can change that HEAD; only the resulting `icon` value is stored.
- A call reads its options (copying `allowedPrivateNetworks`, `proxy`, `agent` and `plugins`) and the private IP environment
  variables once, when it starts, and builds its keys and its connections from that reading. Changing them while the
  call runs affects later calls only, so a result obtained with private IPs allowed is never stored under the key of
  a call that does not allow them.
- A `SummaryCache` whose `set` fails does not fail the call: the result is returned (to every caller sharing it)
  without being stored. A failing `get` or coordinator fails the summary; for the favicon check, the HEAD is then
  sent without them (at most once per call), so `icon` does not depend on them.
- When concurrent calls share one in-flight request but were given different `cache`, `cacheTtl` or `errorCacheTtl`,
  the first call's settings are used for storing the result; the later calls just receive it.
- The default `MemorySummaryCache` holds up to 2000 entries and up to 64 MiB (estimated as 2 bytes per character of
  each entry's JSON form), and drops the oldest stored ones first. An entry estimated above 256 KiB is not stored; the
  caller still gets the result. `new MemorySummaryCache({ maxEntries, maxBytes, maxEntryBytes })` changes these.
  Favicon checks count as entries too: a summary of a page usually stores two (its result and its favicon check;
  pages of one site share the latter), so 2000 entries hold at least 1000 summaries. Size `maxEntries` of your own
  cache the same way.

For independent caches (e.g. per configuration), use `createSummarizer`:

```ts
import { createSummarizer, MemorySummaryCache } from '@tiramiss-community/chiramiss';

const summarize = createSummarizer({
  cache: new MemorySummaryCache({ maxEntries: 5000 }),
  cacheTtl: 10 * 60 * 1000,
});
await summarize('https://example.com/', { lang: 'en' }); // per-call options are merged over the base
```

`createSummarizer(base?)` returns a function with the same signature as `summarize`, with its own cache and in-flight
sharing (unless `base` passes other ones). `SummaryCache` (`get(key)` / `set(key, entry, ttlMs)`) and
`InflightCoordinator` (`run(key, task)`) are small interfaces, so a shared cache such as Redis can be plugged in.
`run` is called again from inside a running task: a summary's task runs its favicon check through `run` with another
key and waits for it. An `InflightCoordinator` must therefore only make calls with the same key wait for each other;
one that makes calls with different keys wait (a global lock, a limit of N tasks at once) blocks forever, because the
summary holds its slot while its favicon check waits for one. Limit concurrency around `summarize` instead.
`MemorySummaryCache`, `InProcessCoordinator` and `StatusError` are exported.

### Custom plugins

```ts
import type { SummaryPlugin } from '@tiramiss-community/chiramiss';

const plugin: SummaryPlugin = {
  test: url => url.hostname === 'example.com',
  summarize: async (url, opts) => ({ /* Summary */ }),
};
await summarize(url, { plugins: [plugin] });
```

**Plugins do their own requests.** A plugin gets the URL and the options, as upstream, but not chiramiss's
connection settings: the private IP block, `allowedPrivateNetworks`, `proxy` and `agent` do not apply to requests a
plugin makes. If a plugin fetches anything derived from the URL, it must filter private addresses itself.

### Proxies

`proxy.http` is used for `http:` targets and `proxy.https` for `https:` targets. Proxy URLs must be `http:` or
`https:` URLs with a host (`http://user:pass@proxy.example:3128`); anything else throws a `TypeError`, with any
credentials removed from the message. `noProxy` takes a comma-separated list like `NO_PROXY`: `*`, host names or IPs
(matching the host and its subdomains, with or without a leading dot), and `host:port` (`[v6]:port` for IPv6).

What the proxy sees:

- chiramiss sends **`CONNECT` for every target, including `http://` ones** (the same way Misskey's own proxy agent
  works). The proxy must allow `CONNECT` to non-SSL ports such as 80; Squid's default `deny CONNECT !SSL_ports`
  breaks `http://` targets.
- To keep the private IP block in effect, chiramiss resolves the target itself, checks the addresses, and sends
  `CONNECT` to **a checked IP address** (IPv4 first, then the other checked addresses if the proxy fails), not to the
  host name. The `Host` header, TLS SNI and certificate verification still use the host name. Proxy ACLs and logs
  therefore see IP addresses instead of host names.
- A scheme for which you pass an `agent` does not use `proxy`; the agent handles it.

## Standalone server

```sh
pnpm install
pnpm build
CHIRAMISS_PORT=3000 node packages/server/built/index.js
```

Endpoints:

- `GET /?url=<url>&lang=<lang>&...` returns the summary as JSON (`SummaryResult`). 400 `{ "error": "url is required" }`
  without `url`, 500 `{ "error": ... }` when summarizing fails.
- `GET /healthz` returns `{ "status": "ok" }`.

Responses carry `Cache-Control`, so a reverse proxy or CDN in front of the server can cache them:

- A summary: `public, max-age=<CHIRAMISS_CACHE_TTL in seconds>` (300 by default).
- A failed summary (500): `public, max-age=<CHIRAMISS_ERROR_CACHE_TTL in seconds>` (30 by default), as long as the
  server itself remembers the failure.
- A TTL under one second (including `0`), a missing `url` (400) and `GET /healthz`: `no-store`.

The max-age is counted from the response, not from when the server cached the result, so a result can be up to about
twice its TTL old when it leaves a shared cache. The cache key should be the whole URL including the query, since
`lang`, `userAgent` and the other parameters change the result.

The server logs to standard output (Fastify's JSON logs), keeps state only in memory (so you can run any number of
instances), and on SIGTERM / SIGINT finishes the requests in progress before exiting.

> [!WARNING]
> The server fetches any URL its clients ask for. Do not expose it to the internet; let only your Misskey server
> reach it.

### Environment variables

Unset or empty variables are ignored. An invalid value stops the server at startup with an error.

Every `CHIRAMISS_*` variable below is also accepted under its summaly name, `SUMMALY_*` with the same suffix
(`CHIRAMISS_HOST` → `SUMMALY_HOST`). `CHIRAMISS_<NAME>` wins when both are set; when it is unset or empty,
`SUMMALY_<NAME>` is used (see [Names kept for summaly compatibility](#names-kept-for-summaly-compatibility)).

| Variable                                | Default                                       | Description |
|:----------------------------------------|:----------------------------------------------|:------------|
| **CHIRAMISS_HOST**                      | `localhost` (`0.0.0.0` in the Docker image)   | Listen address |
| **CHIRAMISS_PORT**                      | `3000`                                        | Listen port (0-65535) |
| **CHIRAMISS_LANG**                      | the `lang` query parameter                    | `Accept-Language` for the requests |
| **CHIRAMISS_USER_AGENT**                | the `userAgent` query parameter, else `ChiramissBot/<version> (+...)` | `User-Agent` for the requests |
| **CHIRAMISS_FOLLOW_REDIRECTS**          | the `followRedirects` query parameter, else `false` | Whether to follow redirects (`true` / `false` / `1` / `0`) |
| **CHIRAMISS_RESPONSE_TIMEOUT**          | `20000`                                       | Connect / socket idle timeout in ms (0-2147483647, `0` = none). Upper bound for the query parameter |
| **CHIRAMISS_OPERATION_TIMEOUT**         | `60000`                                       | Whole-request timeout in ms (0-2147483647, `0` = none). Upper bound for the query parameter |
| **CHIRAMISS_CONTENT_LENGTH_LIMIT**      | `10485760`                                    | Maximum response size in bytes. Upper bound for the query parameter |
| **CHIRAMISS_CONTENT_LENGTH_REQUIRED**   | `false`                                       | Reject responses without `content-length` (`true` / `false` / `1` / `0`) |
| **CHIRAMISS_ALLOWED_PRIVATE_NETWORKS**  | none                                          | Comma-separated canonical CIDRs exempt from the private IP block, e.g. `10.0.0.0/8,fd00::/8` |
| **CHIRAMISS_CACHE_TTL**                 | `300000`                                      | How long successful results (and favicon checks that succeeded) are cached, in ms (`0` = not cached). Also sets the `max-age` of summaries |
| **CHIRAMISS_ERROR_CACHE_TTL**           | `30000`                                       | How long failures (and favicon checks that failed) are cached, in ms (`0` = not cached). Also sets the `max-age` of failed summaries |
| **HTTP_PROXY** / `http_proxy`           | none                                          | Proxy for `http:` targets (`http:` or `https:` URL with a host) |
| **HTTPS_PROXY** / `https_proxy`         | none                                          | Proxy for `https:` targets |
| **NO_PROXY** / `no_proxy`               | none                                          | Hosts that bypass the proxy (see [Proxies](#proxies)) |
| **CHIRAMISS_ALLOW_PRIVATE_IP**          | unset                                         | `true` turns the private IP block off. **For tests only**. Read by the library, so it applies wherever the library runs |

The upper-case proxy variables win over the lower-case ones. Proxy URLs and CIDRs are validated at startup with the
same rules as the library options ([Options](#options), [Proxies](#proxies)); error messages never show proxy
credentials.

### Query parameters

Besides `url` and `lang`, Misskey sends `followRedirects`, `userAgent`, `operationTimeout`, `contentLengthLimit` and
`contentLengthRequired` when it uses a summary proxy. Upstream's server ignored all but `lang`; chiramiss uses them,
with the server administrator in control:

- `lang`, `userAgent`, `followRedirects`: used unless the matching environment variable is set (the variable wins).
- `responseTimeout`, `operationTimeout`, `contentLengthLimit`: **can only tighten.** The upper bound is the
  environment variable if set, otherwise the default (`20000` ms, `60000` ms, `10485760` bytes). A query value is used
  only when it is above 0 and not above that bound; otherwise the bound applies. A timeout variable set to `0` (no
  timeout) has no bound, so any timeout above 0 from the query is used. So if Misskey is configured with a
  larger limit than the server allows (for example a 20 MiB `urlPreviewMaximumContentLength`), the server's limit wins;
  raise `CHIRAMISS_CONTENT_LENGTH_LIMIT` / `CHIRAMISS_OPERATION_TIMEOUT` to allow more.
- `contentLengthRequired`: `true` turns the check on; the query cannot turn it off.
- Booleans must be exactly `true` or `false`. Malformed or repeated values are ignored.

## Docker

```sh
docker run --rm -p 127.0.0.1:3000:3000 ghcr.io/tiramiss-community/chiramiss:latest
curl 'http://127.0.0.1:3000/?url=https://example.com/'
```

The image runs as the non-root `node` user, listens on `0.0.0.0:3000`, and has a `HEALTHCHECK` on `/healthz` (on
`CHIRAMISS_PORT`, or `SUMMALY_PORT`, when you change the port).
Configure it with the [environment variables](#environment-variables) above.

Tags: `X.Y.Z`, `X.Y`, `X` (from 1.0.0 on) and `latest`. The image version matches the library version.
Images are built for `linux/amd64` and `linux/arm64`.

### Docker Compose

[`docker-compose.example.yml`](./docker-compose.example.yml) is a self-contained service definition to add to the
compose file of your Misskey server. It publishes no port: put the service on Misskey's network and set
`http://chiramiss:3000/` as the summary proxy URL in Misskey's control panel.

```yaml
services:
  chiramiss:
    image: ghcr.io/tiramiss-community/chiramiss:latest
    restart: unless-stopped
    environment:
      HTTPS_PROXY: "http://proxy.example:3128"
```

For Kubernetes, use `/healthz` for the probes; the container is stateless and shuts down gracefully on SIGTERM
(requests in progress are answered first).

To build the image yourself: `docker build -t chiramiss .`

## Benchmark

Measured with the benchmark in [`packages/bench`](packages/bench), which compares chiramiss (built from this
repository) with the official summaly Docker image under the same limits, against a local fake site, so that no
third-party site is contacted. See [its README](packages/bench/README.md) for what each scenario measures and how
to reproduce the numbers (`pnpm bench`). The report below is pasted as is.

**chiramiss summarizes a typical article page 6.6× faster than summaly** (median, no added network latency — the cost of summarizing itself; includes chiramiss's favicon-check cache: per page, summaly sent 1.0 `HEAD /favicon.ico` and chiramiss 0.0).

With a favicon URL unique to every page, so that chiramiss's favicon-check cache cannot answer: 5.5×.

Across page types: 1.5×–80.5×.

### S1: one request at a time (latency, ms)

| S1 (ms) | summaly p50 | summaly p95 | summaly origin requests / summary | summaly new connections / summary | chiramiss p50 | chiramiss p95 | chiramiss origin requests / summary | chiramiss new connections / summary | ratio (p50) | run-to-run p50 range |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| article, rtt 0ms | 14.1 | 17.2 | 3.0 | 0.0 | 2.1 | 4.0 | 2.0 | 0.0 | 6.6× | summaly 14.1–14.2; chiramiss 1.9–3.2 |
| article, rtt 50ms | 167.3 | 170.9 | 3.0 | 0.0 | 104.8 | 105.7 | 2.0 | 0.0 | 1.6× | summaly 166.9–167.4; chiramiss 104.5–105.0 |
| article, unique favicon URL, rtt 0ms | 14.3 | 17.1 | 3.0 | 0.0 | 2.6 | 3.1 | 3.0 | 0.0 | 5.5× | summaly 14.1–14.4; chiramiss 2.5–2.7 |
| article, unique favicon URL, rtt 50ms | 167.3 | 169.9 | 3.0 | 0.0 | 156.7 | 157.9 | 3.0 | 0.0 | 1.1× | summaly 167.0–167.4; chiramiss 156.6–156.8 |
| large, rtt 0ms | 382.1 | 394.1 | 3.0 | 0.0 | 4.7 | 6.6 | 2.0 | 0.0 | 80.5× | summaly 380.0–384.8; chiramiss 4.7–4.8 |
| large, rtt 50ms | 537.6 | 549.8 | 3.0 | 0.0 | 107.3 | 112.1 | 2.0 | 0.0 | 5.0× | summaly 534.4–541.4; chiramiss 107.1–107.6 |
| sjis, rtt 0ms | 13.5 | 16.1 | 3.0 | 0.0 | 2.1 | 2.8 | 2.0 | 0.0 | 6.3× | summaly 13.4–13.6; chiramiss 2.0–2.3 |
| sjis, rtt 50ms | 166.6 | 170.1 | 3.0 | 0.0 | 104.8 | 105.6 | 2.0 | 0.0 | 1.6× | summaly 166.4–166.6; chiramiss 104.7–104.9 |
| oembed, rtt 0ms | 3.8 | 5.1 | 4.0 | 0.0 | 2.5 | 3.1 | 3.0 | 0.0 | 1.5× | summaly 3.7–3.9; chiramiss 2.5–2.5 |
| oembed, rtt 50ms | 157.7 | 159.9 | 4.0 | 0.0 | 156.5 | 157.7 | 3.0 | 0.0 | 1.0× | summaly 157.6–157.7; chiramiss 156.4–156.6 |
| redirect, rtt 0ms | 14.7 | 18.1 | 4.0 | 0.0 | 2.6 | 3.2 | 3.0 | 0.0 | 5.6× | summaly 14.3–14.8; chiramiss 2.5–2.8 |
| redirect, rtt 50ms | 219.2 | 222.3 | 4.0 | 0.0 | 156.5 | 157.5 | 3.0 | 0.0 | 1.4× | summaly 218.5–219.4; chiramiss 156.4–156.7 |

### S2: concurrent load (rtt 50ms, article)

| S2 | summaly req/s | summaly p50 (ms) | summaly p99 (ms) | summaly errors | chiramiss req/s | chiramiss p50 (ms) | chiramiss p99 (ms) | chiramiss errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| concurrency 10 | 42.9 | 230.5 | 272.5 | 0.0% | 80.8 | 106.6 | 313.8 | 0.0% |
| concurrency 50 | 68.8 | 721.2 | 935.7 | 0.0% | 357.6 | 106.5 | 415.4 | 0.0% |
| concurrency 100 | 74.8 | 1331.1 | 2149.3 | 0.0% | 540.9 | 115.1 | 471.4 | 0.0% |

### S3: same URL requested many times (rtt 50ms, oEmbed page)

| S3 | summaly origin requests | summaly origin KiB | summaly new connections | summaly p50 (ms) | chiramiss origin requests | chiramiss origin KiB | chiramiss new connections | chiramiss p50 (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| S3a (in-flight sharing) | 400 | 461.1 | 74.3 | 571.4 | 3 | 3.5 | 0.0 | 192.0 |
| S3b (in-flight sharing + result cache) | 400 | 369.6 | 4.0 | 159.5 | 3 | 3.5 | 0.0 | 1.0 |

### S4: resource use

CPU time is the container CPU consumed per summary while the measured requests ran (mean over runs; startup and warmup excluded). Peak memory is the highest memory use of the container while the measured requests ran (maximum over runs), from the cgroup's `memory.peak`. `memory.peak` counts from the container's start, so when the measured requests never went above the peak already reached during startup and warmup, only an upper bound is known: those cells read `≤ N`, where N is that earlier peak.

| S4 | summaly CPU ms / summary | summaly peak MiB | chiramiss CPU ms / summary | chiramiss peak MiB |
| --- | ---: | ---: | ---: | ---: |
| S1 | 89.63 | 142.3 | 4.06 | 107.0 |
| S2 | 16.17 | 224.7 | 1.76 | 100.1 |
| S3a | 5.61 | 169.9 | 0.39 | 82.7 |
| S3b | 6.88 | 72.6 | 0.94 | ≤ 71.1 |

### Notes

- Favicon check (S1, article, rtt 0ms): per summary, summaly sent 1.0 `HEAD /favicon.ico` and chiramiss 0.0. chiramiss caches the result of a favicon check per favicon URL for 5 minutes. Every page here links the same `/favicon.ico`, so after the warmup chiramiss answers the check from that cache, while summaly checks again for every page. This is production behaviour for pages of one site, not the cost of an isolated summary. The "article, unique favicon URL" rows give every page its own favicon URL so that the cache cannot answer; the difference from the "article" rows is what the cache saves.
- Connections (S1, article, rtt 0ms): per summary, summaly made 3.0 origin requests over 0.0 new connections, chiramiss 2.0 over 0.0. Fewer than 1.0 new connections per summary would mean connections were reused from one summary to the next. The S1 table lists both numbers for every page.
- Large page (80.5× at rtt 0ms): the page is a short `<head>` followed by about 1.5 MB of body. The origin sent 1.43 MiB per summary to summaly and 1.43 MiB to chiramiss, so both downloaded the whole page. chiramiss tokenizes the HTML only up to `</head>` and stops; summaly parses the whole document. Most of this gap is parsing work that chiramiss skips.
- The origin is a fake server on a private network (`origin.bench`); no third-party site is contacted. `rtt` is a delay added at the origin by a TCP proxy, in milliseconds of round-trip time.
- S1 and S2 use a distinct URL for every request, so neither target can answer from its result cache.

### Environment

- Started: 2026-11-12T08:06:52.347Z
- chiramiss: commit 90e1c627b5c3ab6d322e501e5f5f396a82b4cf29, working tree clean, Node 26.13.1
- summaly: image ghcr.io/misskey-dev/summaly:5.6.0, digest ghcr.io/misskey-dev/summaly@sha256:1d3785156565ce9ba6809879d60c3cdb963f0ec00acaba5d8cb7b88dde3ee3ff, Node 26.13.1
- Limits per target: 2 CPUs, 1g memory
- Host: Intel(R) Core(TM) i7-14700K, 28 logical CPUs, 31.2 GiB RAM, Linux 6.18.40.1-microsoft-standard-WSL2, Docker 29.8.1

## Known limitations

- **Misskey sends its own User-Agent.** Misskey builds the User-Agent itself as
  `SummalyBot/<version> (<server URL>; +https://github.com/misskey-dev/summaly/blob/master/README.md)` and passes it to
  the library (and to the summary proxy as `userAgent`). With chiramiss swapped in, `<version>` is chiramiss's version,
  so the name `SummalyBot` is combined with a chiramiss version number. chiramiss does not rewrite it. Administrators
  can set their own User-Agent with Misskey's `urlPreviewUserAgent` setting (or `CHIRAMISS_USER_AGENT` on the server);
  ideally Misskey would build it from the library it actually uses.
- **Request sharing is per process.** Misskey runs a copy of the library in each process, so in-flight sharing and
  the in-memory cache work per process. The standalone server likewise shares within one instance.
- **Custom plugins are not protected** by the private IP block (see [Custom plugins](#custom-plugins)).

## License and credits

[MIT](./LICENSE).

chiramiss is derived from [misskey-dev/summaly](https://github.com/misskey-dev/summaly)
(Copyright (c) 2016-2024 syuilo, MIT). Files derived from summaly carry a `Derived from misskey-dev/summaly (MIT)`
header, and the [LICENSE](./LICENSE) keeps summaly's copyright notice. Thanks to the summaly authors and contributors.
