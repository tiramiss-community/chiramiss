# @tiramiss-community/chiramiss

A [summaly](https://github.com/misskey-dev/summaly)-compatible library that summarizes web pages: give it a URL and it
returns the page's title, description, thumbnail, icon, oEmbed player and so on. It is a drop-in replacement for
`@misskey-dev/summaly` v5.5.2 that blocks requests to private IP addresses before connecting (redirects included),
keeps per-call settings per call, shares in-flight requests for the same URL and caches results for a short time.
Requires Node.js `^22.22.2 || ^24.17.0 || >=26.4.0`. ESM only.

## Install

```sh
npm install @tiramiss-community/chiramiss
```

```ts
import { summarize } from '@tiramiss-community/chiramiss';

const summary = await summarize('https://example.com/', { lang: 'ja-JP' });
```

## Names kept for summaly compatibility

chiramiss's own names are the primary ones. summaly's names are exported too, as aliases that are the very same values
and types (`summaly === summarize`). They are not deprecated.

| summaly name (alias)                             | chiramiss name                                  |
|:-------------------------------------------------|:------------------------------------------------|
| `summaly(url, options)`                          | `summarize(url, options)`                       |
| `createSummaly(base)`                            | `createSummarizer(base)`                        |
| `summalyDefaultOptions`                          | `defaultSummarizeOptions`                       |
| `SummalyResult`                                  | `SummaryResult`                                 |
| `SummalyOptions`                                 | `SummarizeOptions`                              |
| `SummalyPlugin`                                  | `SummaryPlugin`                                 |
| `SUMMALY_*` (every variable of the standalone server) | `CHIRAMISS_*` (same suffix, e.g. `SUMMALY_HOST` → `CHIRAMISS_HOST`) |
| `SUMMALY_ALLOW_PRIVATE_IP` (read by the library) | `CHIRAMISS_ALLOW_PRIVATE_IP`                    |

For each environment variable, `CHIRAMISS_<NAME>` is used when it is set; otherwise `SUMMALY_<NAME>` is used. An empty
value counts as unset. The default export (the Fastify plugin), `version` and the default User-Agent
(`ChiramissBot/...`) do not change.

## Using it in Misskey

**Swap it in with an npm alias (no code changes).** Misskey imports the package as `@misskey-dev/summaly`, so replace
it with an npm alias in every package that depends on it (`packages/backend`, `packages/frontend`,
`packages/frontend-embed`):

```json
{
  "dependencies": {
    "@misskey-dev/summaly": "npm:@tiramiss-community/chiramiss@^0.1.0"
  }
}
```

Then run `pnpm install`. No code changes are needed: `summaly` and `SummalyResult` are aliases of chiramiss's names.

**Import `@tiramiss-community/chiramiss` directly.** Depend on `@tiramiss-community/chiramiss` under its own name and
use chiramiss's names:

```ts
// backend
const { summarize } = await import('@tiramiss-community/chiramiss');
const summary = await summarize(url, { lang, agent: { http: httpAgent, https: httpsAgent } });
```

```ts
// frontend
import type { SummaryResult } from '@tiramiss-community/chiramiss';
```

## Documentation

See the [README on GitHub](https://github.com/tiramiss-community/chiramiss#readme) for the options, caching, custom
plugins, proxies, the standalone server (Docker image `ghcr.io/tiramiss-community/chiramiss`), security notes and
differences from upstream.

## License

MIT. Derived from [misskey-dev/summaly](https://github.com/misskey-dev/summaly) (Copyright (c) 2016-2024 syuilo, MIT).
