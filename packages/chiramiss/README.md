# @tiramiss-community/chiramiss

A [summaly](https://github.com/misskey-dev/summaly)-compatible library that summarizes web pages: give it a URL and it
returns the page's title, description, thumbnail, icon, oEmbed player and so on. It is a drop-in replacement for
`@misskey-dev/summaly` v5.5.2 that blocks requests to private IP addresses before connecting (redirects included),
keeps per-call settings per call, shares in-flight requests for the same URL and caches results for a short time.
Requires Node.js 26.4.0 or later. ESM only.

## Install

```sh
npm install @tiramiss-community/chiramiss
```

```ts
import { summaly } from '@tiramiss-community/chiramiss';

const summary = await summaly('https://example.com/', { lang: 'ja-JP' });
```

## Drop-in replacement for `@misskey-dev/summaly`

Misskey imports the package as `@misskey-dev/summaly`, so replace it with an npm alias in every package that depends
on it (`packages/backend`, `packages/frontend`, `packages/frontend-embed`):

```json
{
  "dependencies": {
    "@misskey-dev/summaly": "npm:@tiramiss-community/chiramiss@^0.1.0"
  }
}
```

Then run `pnpm install`. No code changes are needed.

## Documentation

See the [README on GitHub](https://github.com/tiramiss-community/chiramiss#readme) for the options, caching, custom
plugins, proxies, the standalone server (Docker image `ghcr.io/tiramiss-community/chiramiss`), security notes and
differences from upstream.

## License

MIT. Derived from [misskey-dev/summaly](https://github.com/misskey-dev/summaly) (Copyright (c) 2016-2024 syuilo, MIT).
