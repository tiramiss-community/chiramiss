# Compatibility with summaly

[← README](../README.md)

chiramiss keeps the public interface of summaly v5.5.2. Results can differ from upstream in details (how a title or
thumbnail is picked); the compatibility target is the interface, not byte-identical output.

chiramiss has its own names (`summarize`, `SummaryResult`, `CHIRAMISS_*`, ...). summaly's names are kept as aliases of
them, so code and configuration written for summaly keep working (see
[Names kept for summaly compatibility](#names-kept-for-summaly-compatibility)).

## Library (`@tiramiss-community/chiramiss`)

- Exports: `summarize(url, options?)`, `version`, `defaultSummarizeOptions`, the types `SummaryResult`,
  `SummarizeOptions`, `SummaryPlugin` (and `Summary`, `Player`, `GeneralScrapingOptions`), and the Fastify plugin as
  the default export (plus `summaryCacheControl`, see [Library usage](library.md#library-usage)). summaly's `summaly`, `summalyDefaultOptions`, `SummalyResult`, `SummalyOptions` and
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

## Server

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

## Differences from upstream

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
- **The page is fetched once.** Upstream sends a HEAD that follows the redirects to find the final URL, then GETs that
  URL. chiramiss GETs the posted URL, follows its redirects and summarizes that response, unless a provider (built in
  or a plugin) takes the posted URL itself, in which case it sends the HEAD first as upstream does. When the redirects
  of the GET end on a URL a provider takes:
  - a provider that reads the page (Amazon, Bluesky) summarizes that response, so the page is not fetched again;
  - any other provider gets that URL whatever the response's status, and the page is not read (a short body is read
    to its end so that its connection is reused, a longer one is cut), without the type and size checks of the page.

  Because of this, a failed page GET fails the summary at once (upstream falls back to the posted URL and GETs it
  again), and the result's `url` and the base for relative links are where the GET ended, also for a site that
  answers a HEAD with an error (upstream then uses the posted URL) or redirects a HEAD elsewhere than a GET.
- **Connections are reused for a short time.** The requests one summary sends to the same site (the page and its
  redirects, the favicon, oEmbed) share a keep-alive connection, redirect hops included: a redirect
  response without a body or with a short one (up to 16 KB, arriving within 0.5 seconds) is read to its end so that its
  connection serves the next hop, while a longer body is not read and its connection is closed. A connection that
  finished its response stays open for up to 4 seconds of idle time, so the next summary of that site made by the same summarizer
  with the same `allowedPrivateNetworks` reuses it instead of opening a new one (upstream reuses connections too, through
  Node's global agent). Each summarizer (`createSummarizer`, and the one behind `summarize`) keeps its own connections:
  separate summarizers, and summaries with different `allowedPrivateNetworks`, never share one, and every connection is
  checked against the private IP block of its setting when it opens. A request that reuses a connection goes to the
  address checked when the connection opened, without resolving the site's name again. At most 4 idle connections are kept per site,
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
- **Results are cached and in-flight requests are shared by default** (see [Caching](library.md#caching-and-request-sharing)).
  Each caller gets its own copy, so modifying a result does not affect others.
- **Favicon checks are cached and shared too**, so pages of one site summarized in a row (or at once) send one HEAD
  for their common favicon instead of one each (see [Caching](library.md#caching-and-request-sharing)).
- **Default User-Agent** is `ChiramissBot/<version> (+https://github.com/tiramiss-community/chiramiss#readme)`.
- **The server** additionally reads the options Misskey sends along with `url` (see [Query parameters](server.md#query-parameters)),
  serves `GET /healthz`, supports outbound proxies, and answers 400 when `url` is not a single string
  (e.g. given twice).
- **`Cache-Control`** is sent by the server and the Fastify plugin (see [Standalone server](server.md#standalone-server)).
  Upstream's Fastify server sent none.

## Known limitations

- **Misskey sends its own User-Agent.** Misskey builds the User-Agent itself as
  `SummalyBot/<version> (<server URL>; +https://github.com/misskey-dev/summaly/blob/master/README.md)` and passes it to
  the library (and to the summary proxy as `userAgent`). With chiramiss swapped in, `<version>` is chiramiss's version,
  so the name `SummalyBot` is combined with a chiramiss version number. chiramiss does not rewrite it. Administrators
  can set their own User-Agent with Misskey's `urlPreviewUserAgent` setting (or `CHIRAMISS_USER_AGENT` on the server);
  ideally Misskey would build it from the library it actually uses.
- **Request sharing is per process.** Misskey runs a copy of the library in each process, so in-flight sharing and
  the in-memory cache work per process. The standalone server likewise shares within one instance.
- **Custom plugins are not protected** by the private IP block (see [Custom plugins](library.md#custom-plugins)).
