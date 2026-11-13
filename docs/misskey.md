# Using it in Misskey

[← README](../README.md)

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

Alternatively, run the [standalone server](server.md#standalone-server) and set its URL (for example
`http://chiramiss:3000/`) as "Summary proxy URL" (`urlPreviewSummaryProxyUrl`) in the control panel.

See [compatibility and differences from summaly](compatibility.md) before migrating, and
[server configuration](server.md) when using a summary proxy.
