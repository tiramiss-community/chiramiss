# Library usage

[← README](../README.md)

```sh
npm install @tiramiss-community/chiramiss
```

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
the [standalone server](server.md#standalone-server) (from the plugin's `cacheTtl` / `errorCacheTtl`, or their defaults).
To use another policy, overwrite the header, for example in an `onSend` hook. When you serve summaries from your own
route, `summaryCacheControl(options, 'ok' | 'error')` returns the same value.

## Options

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

## Caching and request sharing

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

## Custom plugins

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

## Proxies

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

See [compatibility](compatibility.md) for the complete export and result-field lists,
upstream aliases, and intentional differences in behavior.
