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

## Using it in Misskey

Use an npm alias for `@misskey-dev/summaly` or import `@tiramiss-community/chiramiss` directly.
The existing `summaly` and `SummalyResult` exports remain supported aliases and are not deprecated.
See the [Misskey integration guide](https://github.com/tiramiss-community/chiramiss/blob/main/docs/misskey.md)
for setup instructions, including the standalone summary proxy option.

## Documentation

- [Library guide](https://github.com/tiramiss-community/chiramiss/blob/main/docs/library.md): options, caching, custom plugins and proxies.
- [summaly compatibility](https://github.com/tiramiss-community/chiramiss/blob/main/docs/compatibility.md): exports, result fields, aliases, behavior differences and limitations.
- [Standalone server](https://github.com/tiramiss-community/chiramiss/blob/main/docs/server.md): Docker, HTTP API, configuration and deployment.
- [Project overview](https://github.com/tiramiss-community/chiramiss#readme): ChiramissBot information, features and benchmark overview.

## License

MIT. Derived from [misskey-dev/summaly](https://github.com/misskey-dev/summaly) (Copyright (c) 2016-2024 syuilo, MIT).
