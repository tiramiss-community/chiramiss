# chiramiss 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** summaly 互換の lib（`@tiramiss-community/chiramiss`）と、スタンドアロンサーバ（Docker イメージ `ghcr.io/tiramiss-community/chiramiss`）を、pnpm monorepo で作る。

**Architecture:** lib は責務ごとに層を分ける。層は「HTTP 取得（`http/`）」「`<head>` 中心のパース（`html/`）」「項目の抽出（`extract/`）」「サイト固有のプロバイダ（`providers/`）」「一本化とキャッシュ（`coalesce/`）」の5つで、入口の `summaly()` はこれらを組み合わせるだけにする。設定はすべて呼び出しごとのコンテキストで運び、モジュールのグローバル状態を持たない。サーバは lib に依存する薄い Fastify アプリで、設定は環境変数で受け取る。

**Tech Stack:** Node.js 26、TypeScript 7、pnpm 12 workspace、tsdown、vitest、oxlint、htmlparser2（`<head>` パースと oEmbed の iframe 検証）、cheerio（全文 DOM が要るプロバイダ専用）、ipaddr.js、chardet、自前の CONNECT トンネル agent（プロキシ。Ruling R25 で hpagent から置き換え）、fastify（サーバとテスト）、changesets、GitHub Actions、Docker buildx

**Spec:** `docs/superpowers/specs/2026-11-11-chiramiss-design.md`。実行者は spec と本計画の両方を読むこと。本家のソースとテストは `~/develop/summaly`（HEAD `25e3636`）を参照する。

## Global Constraints

- lib の npm 名は `@tiramiss-community/chiramiss`。サーバのパッケージ名は `@tiramiss-community/chiramiss-server`（`"private": true`）
- リポジトリ URL は `https://github.com/tiramiss-community/chiramiss`（各 `package.json` の `repository.url` もこれ。Trusted Publishing はこの一致を見る）
- ESM のみ（`"type": "module"`）
- `engines.node` は本体と同じ `^22.22.2 || ^24.17.0 || >=26.4.0`（Ruling R44）。Node 24 以降にしかない API（`RegExp.escape` など）にはフォールバックを用意する。Docker のベースイメージは Node 26 系
- パッケージマネージャは `pnpm@12.6.0`。`pnpm-workspace.yaml` の `saveExact`、`minimumReleaseAge: 10080`、`minimumReleaseAgeStrict: false` は本家の設定を踏襲する
- devDependencies のバージョンは本家 `~/develop/summaly/package.json` に揃える。typescript 7.0.2、tsdown 0.23.0、vitest 5.0.1、oxlint 1.85.0、fastify 5.12.6
- lib の実行時依存に fastify を入れない。公開する `.d.ts` も `fastify` を参照しないこと
- ライセンスは MIT。`LICENSE` には chiramiss の著作権表示と、本家（`Copyright (c) 2016-2024 syuilo and other contributors` など、本家 LICENSE の記載そのまま）の表示を併記する
- 既定 User-Agent は `ChiramissBot/<version> (+https://github.com/tiramiss-community/chiramiss#readme)`
- 既定値: レスポンスタイムアウト 20000ms、オペレーションタイムアウト 60000ms、最大サイズ 10485760 バイト、リダイレクト最大10回（いずれも本家と同じ）
- サーバの環境変数名は `SUMMALY_*`（fork commit `25e3636` の名前を踏襲）。外向きプロキシの指定は `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`（小文字の別名も受け付ける）
- テスト用の環境変数 `SUMMALY_ALLOW_PRIVATE_IP=true` を互換のため残す
- 本家から写したコードやテストデータのファイルには、先頭に `// Derived from misskey-dev/summaly (MIT)` を付ける
- コミットメッセージの末尾には `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` を付ける

## Review Focus

1. **UTF-8 以外のページ**（Shift_JIS、EUC-JP の日本語サイト）では、タイトルが文字化けせず取れること。テストは Task 3 に置く。
2. **gzip / br で圧縮された応答**は展開してからパースすること。本家の got は自動で展開していたが、node:http は展開しない。テストは Task 3 に置く。
3. **`<head>` タグがない HTML、`<body>` の後ろに meta がある HTML、`<head>` 内に巨大な `<script>` がある HTML**でも、title と meta を取りこぼさないこと（全文読みに倒してよい）。テストは Task 4 に置く。
4. **公開ホストからプライベート IP へのリダイレクト**は、リダイレクト先の時点で拒否すること。初回の HEAD（最終 URL の解決）、favicon の HEAD、oEmbed の GET も同じ判定を通ること。テストは Task 2 と Task 6 に置く。
5. **一本化やキャッシュで共有された結果を呼び出し側が書き換えても**（本体は `icon` と `thumbnail` を差し替える）、ほかの呼び出し側に波及しないこと。テストは Task 8 に置く。

---

## ファイル構成

```
package.json                      # private ルート。scripts: build, test, lint, typecheck, release
pnpm-workspace.yaml
tsconfig.base.json
oxlint.config.ts                  # 本家と同じ @misskey-dev/oxlint-fmt-config を使う
.changeset/config.json
.changeset/initial-release.md     # 0.1.0 初回リリース用の changeset
LICENSE
README.md                         # 英語。利用者向け + bot 説明（UA の +URL の先）
docs/publishing.md                # 日本語。人がやる公開準備の手順
Dockerfile
.dockerignore
docker-compose.example.yml
.github/workflows/ci.yml
.github/workflows/release.yml
packages/chiramiss/
  package.json  tsconfig.json  tsdown.config.ts  vitest.config.ts
  src/
    index.ts                      # 公開 export と createSummaly / summaly
    types.ts                      # Summary, SummalyResult, Player, SummalyOptions, SummalyPlugin, GeneralScrapingOptions, ProxyOptions
    version.ts                    # VERSION, DEFAULT_BOT_UA
    options.ts                    # resolveOptions(): ResolvedOptions
    context.ts                    # ScrapeContext 型と createScrapeContext()
    http/
      status-error.ts             # StatusError（本家と同一の形）
      address-guard.ts            # AddressGuard: IP 判定、CIDR 例外、guarded lookup
      proxy/                      # 関心ごとに分ける（Ruling R49）
        index.ts                  # 下の3つの公開部分を re-export する
        no-proxy.ts               # selectProxyUrl()（NO_PROXY の照合）
        proxy-url.ts              # assertProxyOptions()、プロキシ URL の検証と userinfo の伏せ字
        tunnel.ts                 # createProxyAgents()、CONNECT トンネルの agent
      transport.ts                # Transport の生成（agent / guard / proxy の組み合わせ）
      request.ts                  # fetchResponse(): node:http(s) 実装
      decode.ts                   # 展開（gzip/deflate/br）と文字コード判定
    html/
      head.ts                     # parseHead(): HeadInfo
      dom.ts                      # loadDom(): cheerio（プロバイダ専用）
    extract/
      fields.ts                   # title / description / image / siteName / thumbnailStyle / player(meta) / activityPub / fediverseCreator / favicon href
      sensitive.ts
      oembed.ts                   # fetchOEmbedPlayer()
      icon.ts                     # resolveIcon()（HEAD で存在確認）
      text.ts                     # clip(), cleanupTitle()
      general.ts                  # scrapeGeneral(), summarizePage()
    providers/
      provider.ts                 # Provider 型、fromPlugin()
      index.ts                    # builtinProviders
      amazon.ts  bluesky.ts  wikipedia.ts  branchio-deeplinks.ts
    coalesce/
      types.ts                    # SummaryCache, CacheEntry, SerializedError, InflightCoordinator
      memory-cache.ts             # MemorySummaryCache
      in-process-coordinator.ts   # InProcessCoordinator
      key.ts                      # buildRequestKey(), objectId()
      run.ts                      # runCoalesced()
    fastify-plugin.ts             # default export（本家互換の Fastify プラグイン、型は構造的に定義）
  test/
    fixtures/htmls/ fixtures/oembed/   # 本家 test/htmls, test/oembed をコピー
    helpers/test-server.ts             # ローカル HTTP サーバのヘルパ
    *.test.ts
    compat/host-usage.ts               # 本体の使い方を写した型検査用ファイル
packages/server/
  package.json  tsconfig.json  tsdown.config.ts  vitest.config.ts
  src/
    config.ts                     # loadServerConfig()
    query.ts                      # parseQueryOptions()
    app.ts                        # buildApp()
    index.ts                      # main(): 起動と graceful shutdown
  test/
    config.test.ts  app.test.ts
```

lib の出力先は `packages/chiramiss/built/`（本家と同じ）、サーバは `packages/server/built/`。

---

### Task 1: monorepo の土台と lib の型、バージョン

**Files:**
- Create: ルートの `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`oxlint.config.ts`、`.gitignore`、`LICENSE`、`.changeset/config.json`
- Create: `packages/chiramiss/{package.json,tsconfig.json,tsdown.config.ts,vitest.config.ts}`
- Create: `packages/chiramiss/src/{types.ts,version.ts,index.ts}`
- Test: `packages/chiramiss/test/version.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `Summary`、`SummalyResult = Summary & { url: string }`、`Player`（本家 `src/summary.ts` と同じフィールドと JSDoc）、`GeneralScrapingOptions`（本家 `general.ts` と同じ）、`SummalyPlugin { test(url: URL): boolean; summarize(url: URL, opts?: GeneralScrapingOptions): Promise<Summary | null> }`、`ProxyOptions { http?: string; https?: string; noProxy?: string }`
  - `SummalyOptions` は本家のキーをそのまま持ち（`agent` の型は `{ http?: http.Agent; https?: https.Agent }`）、次のキーを追加する: `allowedPrivateNetworks?: string[]`、`proxy?: ProxyOptions`、`cache?: SummaryCache | false`、`cacheTtl?: number`、`errorCacheTtl?: number`、`coordinator?: InflightCoordinator | false`
  - `coalesce/types.ts`: `SerializedError`、`CacheEntry`、`SummaryCache`、`InflightCoordinator` の型（定義は Task 8 の Interfaces に書いたとおり。型だけなので、ここで確定させる）
  - `version.ts`: `export const VERSION: string`（ビルド時の `_VERSION_` 定数）、`export const DEFAULT_BOT_UA: string`

- [ ] **Step 1: ルートと lib パッケージを作る**

`.changeset/config.json` の内容:

```json
{
  "$schema": "https://unpkg.com/@changesets/config/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [["@tiramiss-community/chiramiss", "@tiramiss-community/chiramiss-server"]],
  "access": "public",
  "baseBranch": "main",
  "privatePackages": { "version": true, "tag": true }
}
```

- lib の `package.json` は `"version": "0.0.0"`、`main: ./built/index.js`、`types: ./built/index.d.ts`、`exports: { ".": { "types": "./built/index.d.ts", "import": "./built/index.js", "default": "./built/index.js" }, "./package.json": "./package.json" }`（`default` と `./package.json` は Ruling R50）、`files: ["built", "LICENSE"]`、`publishConfig: { "access": "public", "provenance": true }` とする
- `tsdown.config.ts` と `vitest.config.ts` は、本家と同じく `_VERSION_` を `package.json` の version から define する。`@/` エイリアスも本家と同じ
- ルートの scripts: `build`（`pnpm -r build`）、`test`（`pnpm -r test`）、`lint`（`oxlint`）、`typecheck`（`pnpm -r typecheck`）、`release`（`pnpm build && changeset publish`）

- [ ] **Step 2: 失敗するテストを書く** — `test/version.test.ts`

```ts
test('VERSION は package.json の version と一致する', () => {
  expect(VERSION).toBe(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version);
});
test('既定 UA は ChiramissBot 名義', () => {
  expect(DEFAULT_BOT_UA).toBe(`ChiramissBot/${VERSION} (+https://github.com/tiramiss-community/chiramiss#readme)`);
});
test('index から version が export されている', async () => {
  expect((await import('@/index.js')).version).toBe(VERSION);
});
```

- [ ] **Step 3: `pnpm --filter @tiramiss-community/chiramiss test` を実行し、失敗を確認する**
- [ ] **Step 4: `types.ts`、`version.ts`、`index.ts`（`version` と型の re-export のみ）を実装する**
- [ ] **Step 5: test、`pnpm typecheck`、`pnpm lint`、`pnpm build` がすべて通ることを確認する**
- [ ] **Step 6: Commit** — `chore: monorepo の土台と lib の型定義を追加`

---

### Task 2: プライベート IP の遮断（AddressGuard）

**Files:**
- Create: `packages/chiramiss/src/http/status-error.ts`、`packages/chiramiss/src/http/address-guard.ts`
- Test: `packages/chiramiss/test/address-guard.test.ts`

**Interfaces:**
- Produces:
  - `class StatusError extends Error { statusCode: number; statusMessage?: string; isPermanentError: boolean }`（本家 `src/utils/status-error.ts` と同じ形。各フィールドは own enumerable プロパティにすること。サーバの 500 応答で JSON に出るため）
  - `type AddressGuard = { allowedNetworks: [ipaddr.IPv4 | ipaddr.IPv6, number][] }`
  - `createAddressGuard(allowedNetworks?: string[]): AddressGuard`（不正な CIDR は `TypeError`）
  - `isAddressAllowed(guard: AddressGuard, ip: string): boolean`（IPv4-mapped IPv6 は IPv4 に直してから判定する。`range() === 'unicast'` か、例外ネットワークに含まれれば true）
  - `assertHostAllowed(guard: AddressGuard, hostname: string): Promise<void>`（IP リテラルはそのまま判定する。ホスト名なら `dns.lookup(..., { all: true })` で全アドレスを判定する。1つでも不可なら `new StatusError(\`Private IP rejected ${ip}\`, 400, 'Private IP Rejected')`）
  - `createGuardedLookup(guard: AddressGuard): net.LookupFunction`（ソケット接続時の名前解決にも同じ判定をかける。DNS rebinding 対策）
  - `privateIpAllowedByEnv(env = process.env): boolean`（本家互換: `env.SUMMALY_ALLOW_PRIVATE_IP === 'true'` のときだけ true。環境変数だけを見る（Ruling R48。旧名 `isGuardDisabled(agent, env)`）。呼び出し側の agent による遮断の引き渡しは scheme ごとに `createTransport` が決める（Ruling R9 / R12））

- [ ] **Step 1: 失敗するテストを書く**

```ts
test.each(['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fc00::1', '::ffff:127.0.0.1', '0.0.0.0'])
  ('%s は拒否される', ip => expect(isAddressAllowed(createAddressGuard(), ip)).toBe(false));
test('公開 IP は許可される', () => expect(isAddressAllowed(createAddressGuard(), '93.184.216.34')).toBe(true));
test('CIDR 例外に入るプライベート IP は許可される', () => {
  expect(isAddressAllowed(createAddressGuard(['10.0.0.0/8']), '10.1.2.3')).toBe(true);
  expect(isAddressAllowed(createAddressGuard(['10.0.0.0/8']), '192.168.0.1')).toBe(false);
});
test('不正な CIDR は TypeError', () => expect(() => createAddressGuard(['nope'])).toThrow(TypeError));
test('assertHostAllowed は localhost を StatusError(400) で拒否する', async () => {
  const e = await assertHostAllowed(createAddressGuard(), 'localhost').catch(e => e);
  expect(e).toBeInstanceOf(StatusError); expect(e.statusCode).toBe(400); expect(e.message).toContain('Private IP rejected');
});
test('privateIpAllowedByEnv: SUMMALY_ALLOW_PRIVATE_IP が true のときだけ true', () => {
  expect(privateIpAllowedByEnv({ SUMMALY_ALLOW_PRIVATE_IP: 'true' })).toBe(true);
  expect(privateIpAllowedByEnv({})).toBe(false);
  expect(privateIpAllowedByEnv({ SUMMALY_ALLOW_PRIVATE_IP: 'false' })).toBe(false);
});
```

- [ ] **Step 2: 実行して失敗を確認する**
- [ ] **Step 3: 実装する**（依存に `ipaddr.js` を追加する）
- [ ] **Step 4: 実行して成功を確認する**
- [ ] **Step 5: Commit** — `feat: プライベート IP の遮断を接続前に行う AddressGuard を追加`

---

### Task 3: HTTP 取得（fetchResponse）

**Files:**
- Create: `packages/chiramiss/src/http/{transport.ts,request.ts,decode.ts}`、`packages/chiramiss/test/helpers/test-server.ts`
- Test: `packages/chiramiss/test/request.test.ts`、`packages/chiramiss/test/fixtures/sjis.html`（Shift_JIS で保存し、`<meta charset="Shift_JIS">` と日本語タイトルを入れる）

**Interfaces:**
- Consumes: Task 2 の `AddressGuard`、`assertHostAllowed`、`createGuardedLookup`、`StatusError`
- Produces:
  - `type Transport = { agents: { http?: http.Agent; https?: https.Agent }; guard: AddressGuard | null; proxy: ProxyOptions | null }`
  - `createTransport(opts: { agent?: SummalyOptions['agent']; allowedPrivateNetworks?: string[]; proxy?: ProxyOptions }, env = process.env): Transport`（guard の有無は `privateIpAllowedByEnv(env)` と、呼び出し側が両方の scheme の agent を渡したかで決める（Ruling R9 / R12 / R48）。agent が渡されたら proxy は無視する。proxy の agent 生成は Task 7 で足す。この時点の `proxy` は保持するだけ）
  - `type FetchRequest = { url: string; method: 'GET' | 'HEAD'; headers: Record<string, string | undefined>; typeFilter?: RegExp; followRedirects: boolean; responseTimeout: number; operationTimeout: number; contentLengthLimit: number; contentLengthRequired: boolean }`
  - `type FetchResult = { url: string /* 最終 URL */; statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer /* 展開済み */ }`
  - `fetchResponse(transport: Transport, req: FetchRequest): Promise<FetchResult>`
  - `decodeHtml(body: Buffer, contentType?: string): string`（判定順は本家 `src/utils/encoding.ts` と同じ: chardet → meta charset → utf-8。content-type の charset は chardet より優先する（追加した挙動））

`fetchResponse` の振る舞い（本家 `src/utils/got.ts` と同じ判定順にする）:
1. guard があれば、各ホップの前に `assertHostAllowed` を呼ぶ。直接接続のときは `lookup: createGuardedLookup(guard)` もソケットに渡す
2. 接続先が http か https かに応じて `transport.agents.http` / `.https` を使う（未指定なら Node の既定 agent）
3. `Accept-Encoding: gzip, deflate, br` を送り、`content-encoding` に応じて展開する
4. `followRedirects` が true なら、3xx の `location` を最大10回たどる。false なら 3xx をそのまま返す（本家 got の `followRedirect: false` と同じ）
5. 4xx / 5xx は `StatusError(\`${code} ${message}\`, code, message)` を投げる
6. `typeFilter` があって content-type が合わなければ `Error(\`Rejected by type filter ${contentType}\`)`
7. `content-length` が上限を超えたら `Error(\`maxSize exceeded (${size} > ${max}) on response\`)`。ヘッダがなく `contentLengthRequired` なら `Error('content-length required')`
8. 受信中も展開後のバイト数を数え、上限を超えたら中断して同じ `maxSize exceeded` エラーにする
9. タイムアウトは `responseTimeout`（接続とソケットのアイドル）と `operationTimeout`（全体）

- [ ] **Step 1: テストサーバのヘルパを書く** — `startTestServer(handler: (req, res) => void): Promise<{ url: string; close(): Promise<void> }>`。node:http を使い、port 0 で待ち受ける
- [ ] **Step 2: 失敗するテストを書く**（すべて `SUMMALY_ALLOW_PRIVATE_IP` を使わず、`createTransport({ allowedPrivateNetworks: ['127.0.0.0/8', '::1/128'] })` でローカルを許可する）

```ts
test('200 の本文を返す'); // body の一致と、最終 url の一致
test('gzip / br の応答を展開する'); // zlib で圧縮した HTML を返し、body.toString() が元の HTML と一致すること
test('Shift_JIS の HTML を decodeHtml で正しく読める'); // fixtures/sjis.html のタイトル文字列を含むこと
test('followRedirects=true でリダイレクトをたどり、最終 URL を返す');
test('followRedirects=false では 3xx をそのまま返す');
test('11 回目のリダイレクトでエラーになる');
test('リダイレクト先がプライベート IP なら StatusError(400) で拒否する');
  // allowedPrivateNetworks: ['127.0.0.2/32'] とし、127.0.0.2 で待ち受けるサーバが
  // http://127.0.0.1:<port>/ へ 302 を返す。127.0.0.1 側のサーバの受信回数は 0 であること
test('404 は statusCode 404 の StatusError');
test('typeFilter に合わない content-type はエラー');
test('content-length が上限超過ならエラー、上限以内なら成功');
test('content-length なしのストリームが受信中に上限を超えたらエラー');
test('contentLengthRequired=true で content-length がなければエラー');
test('operationTimeout を超えたらエラーになる'); // 応答を返さないサーバで operationTimeout: 200
test('渡した agent が実際に使われる'); // createConnection をフックした http.Agent の呼び出し回数 > 0
```

- [ ] **Step 3: 実行して失敗を確認する**
- [ ] **Step 4: 実装する**（依存に `chardet` を追加する）
- [ ] **Step 5: 実行して成功を確認する**
- [ ] **Step 6: Commit** — `feat: node:http ベースの HTTP 取得層を追加`

---

### Task 4: `<head>` パーサ

**Files:**
- Create: `packages/chiramiss/src/html/head.ts`、`packages/chiramiss/src/html/dom.ts`
- Test: `packages/chiramiss/test/head.test.ts`

**Interfaces:**
- Produces:
  - `type LinkTag = { rel: string | null; type: string | null; href: string }`（rel なしの link も保持する。本家は `link[type="application/json+oembed"]` を rel 不問で選ぶため。Ruling R17）
  - `type HeadInfo = { title: string | null; meta(key: \`name:${string}\` | \`property:${string}\`): string | undefined; links: LinkTag[] }`。`meta()` は同じキーの最初の出現を返す（cheerio の `$('meta[...]').attr('content')` と同じ）。属性名は小文字で照合し、値は大文字小文字を区別する
  - `parseHead(html: string): HeadInfo` は htmlparser2 の `Parser` でストリーム処理する。`</head>` の閉じタグか `<body>` の開始タグに達した時点で止める。`<title>` が `<head>` の外にしかない場合に備え、停止後は title だけ探して読み進める
  - `loadDom(html: string): cheerio.CheerioAPI`（Amazon プロバイダ専用）

- [ ] **Step 1: 失敗するテストを書く**

```ts
test('og:title / name=description / link rel=icon を読む');
test('同じ meta が複数あれば最初のもの');
test('</head> 以降の meta は読まない'); // body 内の og:title は無視される
test('<head> タグのない HTML でも title と meta を読む');
test('<title> が body 側にしかなくても読む');
test('<head> 内の巨大な <script>（1MB）を挟んでも後続の meta を読む');
test('エンティティはデコードしない（抽出層で decode する）'); // 本家は html-entities で後段デコードするため、生の値を返す
```

- [ ] **Step 2: 実行して失敗を確認する**
- [ ] **Step 3: 実装する**（依存に `htmlparser2` と `cheerio` を追加する）
- [ ] **Step 4: 実行して成功を確認する**。あわせて、spec 1章の条件（350KB の HTML）で `parseHead` と `cheerio.load` の時間を比べ、`parseHead` のほうが速いことを確認する。数字は commit メッセージ本文に記す。ベンチのコードはコミットしない
- [ ] **Step 5: Commit** — `feat: <head> 中心の軽量パーサを追加`

---

### Task 5: 抽出層と汎用スクレイパ（general）

**Files:**
- Create: `packages/chiramiss/src/extract/{text.ts,fields.ts,sensitive.ts,oembed.ts,icon.ts,general.ts}`、`packages/chiramiss/src/context.ts`、`packages/chiramiss/src/options.ts`
- Copy: `~/develop/summaly/test/htmls/*` → `packages/chiramiss/test/fixtures/htmls/`、`~/develop/summaly/test/oembed/**` → `packages/chiramiss/test/fixtures/oembed/`
- Test: `packages/chiramiss/test/general.test.ts`、`packages/chiramiss/test/text.test.ts`

**Interfaces:**
- Consumes: Task 3 の `Transport`、`fetchResponse`、`decodeHtml`。Task 4 の `parseHead`、`HeadInfo`
- Produces:
  - `type ResolvedOptions = { lang: string | null; userAgent: string; followRedirects: boolean; responseTimeout: number; operationTimeout: number; contentLengthLimit: number; contentLengthRequired: boolean }`
  - `resolveOptions(opts: SummalyOptions): ResolvedOptions`（既定値は Global Constraints のとおり。`lang` が `/^[\w-]+(\s*,\s*[\w-]+)*$/` に合わなければ null。これは本家 `general()` と同じ）
  - `type ScrapeContext = { options: ResolvedOptions; transport: Transport }`
  - `createScrapeContext(opts: SummalyOptions): ScrapeContext`
  - `fetchPage(ctx: ScrapeContext, url: URL): Promise<{ url: URL; html: string; headers: http.IncomingHttpHeaders }>`（`accept: text/html,application/xhtml+xml`、UA、`accept-language` を付ける。typeFilter は `/^(text\/html|application\/xhtml\+xml)/`）
  - `summarizePage(ctx: ScrapeContext, url: URL, page: { html: string; headers: http.IncomingHttpHeaders }): Promise<Summary | null>`（本家 `parseGeneral` に相当）
  - `scrapeGeneral(ctx: ScrapeContext, url: URL): Promise<Summary | null>`（`fetchPage` の後に `summarizePage`）
  - `fields.ts` は項目ごとに1関数にする。`pickTitle(head)`、`pickDescription(head)`、`pickImage(head, base)`、`pickThumbnailStyle(head)`、`pickMetaPlayer(head)`、`pickSiteName(head, url)`、`pickFaviconHref(head)`、`pickActivityPub(head)`、`pickFediverseCreator(head)`。各フォールバック順は本家 `src/general.ts` の `parseGeneral` と同じにする
  - `isSensitive(head, headers): boolean`、`fetchOEmbedPlayer(ctx, head, pageUrl): Promise<Player | null>`（iframe の検証は htmlparser2 の `parseDocument` で行う。safeList、ignoredList、高さ上限 1024 などの規則は本家 `getOEmbedPlayer` と同じ）、`resolveIcon(ctx, href, pageUrl): Promise<string | null>`
  - `text.ts`: `clip(s, max)`、`cleanupTitle(title, siteName)`（本家と同じ。`escape-regexp` 依存は `RegExp.escape` か自前の1行関数に置き換える）
  - oEmbed の GET と favicon の HEAD は、`ctx` の transport（agent、guard、proxy）、UA、タイムアウトを使うこと。本家はこれらを渡していなかった

- [ ] **Step 1: 本家テストを移植する**。`~/develop/summaly/test/index.test.ts` の `describe('local tests')` 配下から、次の describe / test をすべて `general.test.ts` に写す。期待値は本家のまま。対象は 'basic'、favicon の2件、'titleがcleanupされる'、'OGP'、'TwitterCard'、'oEmbed'（`Invalidity test` のループを含む）、'ActivityPub'、'Fediverse Creator'、'sensitive'。呼び出しは `summaly(host)` の代わりに `scrapeGeneral(createScrapeContext({ allowedPrivateNetworks: ['127.0.0.0/8', '::1/128'] }), new URL(host))` を使う。結果に `url` は含まれないので、期待値からも `url` を外す
- [ ] **Step 2: Review Focus 3 のテストを足す** — `<head>` がない、`<head>` に巨大 script がある fixture で title と og:image が取れること
- [ ] **Step 3: oEmbed の取得に agent が使われることのテストを足す** — Task 3 と同じく `createConnection` をフックした agent を `createScrapeContext({ agent })` に渡し、oEmbed エンドポイントへの接続もフックを通ること
- [ ] **Step 4: 実行して失敗を確認する**
- [ ] **Step 5: 実装する**（依存に `html-entities` を追加する）
- [ ] **Step 6: 実行して成功を確認する**。本家と挙動が変わってテストを直した箇所があれば、そのテストに `// 互換対象外: <理由>` のコメントを付ける
- [ ] **Step 7: Commit** — `feat: 項目ごとの抽出関数と汎用スクレイパを追加`

---

### Task 6: プロバイダと `summaly()` 入口

**Files:**
- Create: `packages/chiramiss/src/providers/{provider.ts,index.ts,amazon.ts,bluesky.ts,wikipedia.ts,branchio-deeplinks.ts}`
- Modify: `packages/chiramiss/src/index.ts`
- Test: `packages/chiramiss/test/summaly.test.ts`、`packages/chiramiss/test/providers.test.ts`

**Interfaces:**
- Consumes: Task 5 の `ScrapeContext`、`createScrapeContext`、`fetchPage`、`summarizePage`、`scrapeGeneral`。Task 4 の `loadDom`
- Produces:
  - `type Provider = { name: string; test(url: URL): boolean; summarize(ctx: ScrapeContext, url: URL): Promise<Summary | null> }`
  - `fromPlugin(plugin: SummalyPlugin): Provider`（カスタムプラグインには、本家と同じ `GeneralScrapingOptions` を組み立てて渡す）
  - `builtinProviders: Provider[]`（並び順は本家 `plugins/index.ts` と同じ: amazon、bluesky、wikipedia、branchio）
  - 各プロバイダの判定と抽出は本家 `src/plugins/*.ts` と同じにする。Amazon だけ `loadDom` を使う。Wikipedia API の取得も `ctx` の transport を使う
  - `index.ts`（この Task 時点。Task 8 で一本化とキャッシュを挟む）: `export const summaly: (url: string, options?: SummalyOptions) => Promise<SummalyResult>` と `export const summalyDefaultOptions = { lang: null, followRedirects: true, plugins: [] }`
    1. オプションは `{ ...summalyDefaultOptions, ...options }` で合成する。呼び出し間で状態を残さない
    2. `followRedirects` なら HEAD で最終 URL を求める。失敗したら元の URL を使う（本家と同じ）
    3. 組み込みプロバイダ、カスタムプラグインの順で最初に一致したものを使う。なければ `scrapeGeneral`
    4. null なら `Error('failed summarize')`。結果に `url: 最終 URL` を付けて返す

- [ ] **Step 1: 本家テストを移植する** — `test/index.test.ts` の 'Should block localhost by default'、'Private IP blocking' の3件、'UserAgent'、'options'（指定したオプションが以降に引き継がれない）、'content-length limit' の3件、'content-length required' の4件を `summaly.test.ts` に写す。期待値は本家のまま。'UA設定が反映されていること' 以外で UA を検査しているものがあれば、`SummalyBot` を `ChiramissBot` に直す
- [ ] **Step 2: 追加テストを書く**

```ts
test('設定の違う agent を並行に渡しても互いに干渉しない');
  // agentA, agentB をそれぞれフックし、Promise.all で同時に summaly を2本走らせ、各 agent が自分の呼び出しにだけ使われたこと
test('最終 URL 解決の HEAD もリダイレクト先がプライベート IP なら拒否される'); // Review Focus 4
test('既定 UA は DEFAULT_BOT_UA'); // テストサーバで受けた user-agent ヘッダ
test('カスタムプラグインは組み込みより後に評価され、GeneralScrapingOptions を受け取る');
```

`providers.test.ts`: 各プロバイダの `test()` 判定を表形式で書く（本家の hostname 条件をそのまま列挙）。branchio は `$web_only=true` が付くこと。Amazon は fixture HTML（`#title`、`#landingImage`、`#productDescription` を含むものを新たに作る）から title、thumbnail、description が取れること。

- [ ] **Step 3: 実行して失敗を確認する**
- [ ] **Step 4: 実装する**
- [ ] **Step 5: 実行して成功を確認する**。ネットワークを使う本家の 'Stage Bye Stage' テストは移植しない（実サイトの変化で壊れるため）
- [ ] **Step 6: Commit** — `feat: プロバイダと summaly() 入口を追加`

---

### Task 7: 外向きプロキシ

**Files:**
- Create: `packages/chiramiss/src/http/proxy.ts`（後に Ruling R49 で `packages/chiramiss/src/http/proxy/` の `no-proxy.ts`・`proxy-url.ts`・`tunnel.ts`・`index.ts` に分けた）
- Modify: `packages/chiramiss/src/http/transport.ts`
- Test: `packages/chiramiss/test/proxy.test.ts`

**Interfaces:**
- Consumes: Task 2 の `assertHostAllowed`。Task 3 の `Transport`
- Produces:
  - `selectProxyUrl(target: URL, proxy: ProxyOptions): string | null`。`noProxy` はカンマ区切りで、`*`、ホスト名の完全一致、先頭 `.` 付きまたは無しのドメイン接尾辞一致、`host:port` に対応する
  - `createProxyAgents(proxy: ProxyOptions): { http?: http.Agent; https?: https.Agent }`（自前の CONNECT トンネル agent。CONNECT 先はローカルで検証した IP（IPv4 優先、失敗時は次の候補）で、Host と TLS SNI は元のホスト名。Ruling R25 / R28。当初は hpagent の予定だったが、プロキシ側の再解決を防げないため置き換えた）
  - `createTransport` を拡張する。agent が未指定で proxy があればプロキシ用 agent を作り、guard は残す。`fetchResponse` は `selectProxyUrl` が null のホストには直接接続する
  - プロキシ経由のときも、各ホップの前に `assertHostAllowed` で宛先を検証してからプロキシへ要求を送る。プロキシ経由では `createGuardedLookup` はプロキシ自身の名前解決にしか効かないので、宛先の検証は `assertHostAllowed` が担う

- [ ] **Step 1: 失敗するテストを書く**

```ts
test.each([
  ['https://a.example.com/', { https: 'http://p:8080' }, 'http://p:8080'],
  ['http://a.example.com/', { https: 'http://p:8080' }, null],
  ['https://a.example.com/', { https: 'http://p:8080', noProxy: '.example.com' }, null],
  ['https://example.com/', { https: 'http://p:8080', noProxy: 'example.com' }, null],
  ['https://a.example.org/', { https: 'http://p:8080', noProxy: 'example.com' }, 'http://p:8080'],
  ['https://a.example.com/', { https: 'http://p:8080', noProxy: '*' }, null],
])('selectProxyUrl(%s)', (u, p, expected) => expect(selectProxyUrl(new URL(u), p)).toBe(expected));
test('http プロキシ経由で取得できる');
  // テスト用の簡易フォワードプロキシ（node:http で absolute-form の GET を中継する）を立て、
  // allowedPrivateNetworks でローカルを許可したうえで、プロキシの受信回数 > 0 かつ本文一致
test('プロキシ経由でも宛先がプライベート IP なら、プロキシに要求を送る前に拒否する');
  // 例外なしの guard で http://127.0.0.1/ を要求し、StatusError(400) かつプロキシの受信回数 0
test('agent を渡した場合はプロキシ設定を無視する');
```

- [ ] **Step 2: 実行して失敗を確認する**
- [ ] **Step 3: 実装する**（hpagent は使わない。Ruling R25）
- [ ] **Step 4: 実行して成功を確認する**
- [ ] **Step 5: Commit** — `feat: 外向きプロキシに対応（宛先の遮断は維持）`

---

### Task 8: 同時リクエストの一本化と結果キャッシュ

**Files:**
- Create: `packages/chiramiss/src/coalesce/{types.ts,memory-cache.ts,in-process-coordinator.ts,key.ts,run.ts}`
- Modify: `packages/chiramiss/src/index.ts`
- Test: `packages/chiramiss/test/coalesce.test.ts`

**Interfaces:**
- Consumes: Task 6 の `summaly` の本体処理。これを `summarizeUncached(url, opts)` という内部関数に名前を変える。型は Task 1 の `coalesce/types.ts` にあるもの（以下に再掲する）
- Produces:
  - `type SerializedError = { name: string; message: string; statusCode?: number; statusMessage?: string }`
  - `type CacheEntry = { kind: 'ok'; value: SummalyResult } | { kind: 'error'; error: SerializedError }`（JSON にできる形に限る。将来 Redis に入れるため）
  - `interface SummaryCache { get(key: string): Promise<CacheEntry | undefined>; set(key: string, entry: CacheEntry, ttlMs: number): Promise<void> }`
  - `class MemorySummaryCache implements SummaryCache { constructor(opts?: { maxEntries?: number /* 既定 1000 */; maxBytes?: number /* 既定 64 MiB */; maxEntryBytes?: number /* 既定 256 KiB。超える結果は保存しない */ }) }`（Ruling R46）（期限切れは get のときに捨てる。上限を超えたら古いものから捨てる）
  - `interface InflightCoordinator { run<T>(key: string, task: () => Promise<T>): Promise<T> }`。同じ key で実行中なら、新しく task を走らせずにその結果を共有する。将来の Redis 版は、ロックを取れたら task を実行し、取れなければキャッシュに結果が入るのを待つ実装になる
  - `class InProcessCoordinator implements InflightCoordinator`（`Map<string, Promise>`、完了時に削除）
  - `objectId(obj: object): number`（WeakMap で採番する）と `buildRequestKey(url: string, opts: SummalyOptions): string`。key の構成要素は、url、`lang`、`userAgent`、`followRedirects`、`responseTimeout`、`operationTimeout`、`contentLengthLimit`、`contentLengthRequired`、`allowedPrivateNetworks`、`proxy`、`agent.http` / `agent.https` の objectId、`plugins` の各 objectId（objectId にはプロセスごとに1回だけ作る乱数を添える。別プロセスと外部キャッシュを共有しても同一性が重ならないように。Ruling R47）、`process.env.SUMMALY_ALLOW_PRIVATE_IP`
  - `runCoalesced(deps: { cache: SummaryCache | null; coordinator: InflightCoordinator | null; cacheTtl: number; errorCacheTtl: number }, key: string, task: () => Promise<SummalyResult>): Promise<SummalyResult>`。処理順は次のとおり。キャッシュを見る（ok ならコピーを返し、error なら復元して投げる）→ coordinator 越しに task を実行する → 結果を cache に set する → 呼び出し側ごとに `structuredClone` したコピーを返す。エラーの復元は、`statusCode` があれば `StatusError` に、なければ `name` を持つ `Error` にする
  - `index.ts`: `export function createSummaly(base?: SummalyOptions): (url: string, options?: SummalyOptions) => Promise<SummalyResult>`。各インスタンスは自分専用の `MemorySummaryCache` と `InProcessCoordinator` を持つ。`base` と呼び出しのオプションで `cache` / `coordinator` に `false` が来たら、それぞれ無効にする。`export const summaly = createSummaly()`。既定の `cacheTtl` は 300000、`errorCacheTtl` は 30000
  - `MemorySummaryCache`、`InProcessCoordinator`、`StatusError`、`createSummaly` と、上記の型を index から export する
- 移植済みの Task 5 / 6 のテストは、同じ URL に違う中身を返すので、`createSummaly({ cache: false })` を使うように直す

- [ ] **Step 1: 失敗するテストを書く**

```ts
test('同時に来た同じ要求は1回だけ取得する');
  // 応答を 100ms 遅らせるテストサーバで Promise.all(10 本) → サーバの GET 受信回数 1、結果はすべて等しい
test('lang が違えば別々に取得する'); // lang=ja-JP と en-US の同時2本 → GET 受信回数 2
test('agent が違えば別々に取得する');
test('cacheTtl 内の再要求は取得しない、期限後は取得する'); // vi.useFakeTimers は使わず cacheTtl: 50 と待機で検証
test('失敗も errorCacheTtl の間はキャッシュされ、同じ statusCode の StatusError が投げられる'); // 404 を返すサーバ、2回目は受信回数が増えない
test('返された結果を書き換えても、同時の呼び出し側と次のキャッシュヒットに影響しない'); // Review Focus 5
test('cache: false と coordinator: false で毎回取得する');
test('MemorySummaryCache は maxEntries を超えると古いものから捨てる');
test('CacheEntry は JSON.stringify → JSON.parse で往復しても同じ結果を返す'); // Redis 差し替えの前提
```

- [ ] **Step 2: 実行して失敗を確認する**
- [ ] **Step 3: 実装する**
- [ ] **Step 4: lib の全テストを実行し、成功を確認する**
- [ ] **Step 5: Commit** — `feat: 同時リクエストの一本化と結果キャッシュを追加`

---

### Task 9: 本家互換の Fastify プラグインと、本体からの使い方の型検査

**Files:**
- Create: `packages/chiramiss/src/fastify-plugin.ts`、`packages/chiramiss/test/compat/host-usage.ts`
- Modify: `packages/chiramiss/src/index.ts`（default export）、`packages/chiramiss/package.json`（scripts に `typecheck:compat`）
- Test: `packages/chiramiss/test/fastify-plugin.test.ts`

**Interfaces:**
- Consumes: Task 8 の `summaly`
- Produces:
  - default export `function (fastify: FastifyLike, options: SummalyOptions, done: (err?: Error) => void): void`。`FastifyLike` は、この関数が使う `get` だけを持つ構造的な型として自前で定義する（`fastify` を import しない）。中身は本家 `src/index.ts` の default export と同じ: `url` がなければ 400 で `{ error: 'url is required' }`、成功時は要約、失敗時は 500 で `{ error: e }`。オプションは `{ lang: req.query.lang, followRedirects: false, ...options }`
  - `test/compat/host-usage.ts` は、tiramiss `packages/backend/src/server/web/UrlPreviewService.ts` の `fetchSummary` の呼び出しを、型ごとそのまま写す。agent には `http.Agent` / `https.Agent` を渡し、`version` を import する。フロントエンド側の使い方として `import type { SummalyResult }` も入れる。`typecheck:compat` は、このファイルを `built/index.d.ts` に対して `tsc --noEmit` で検査する（`skipLibCheck: false`、`types: []`、fastify 未導入の条件で検査すること）

- [ ] **Step 1: 失敗するテストを書く** — `fastify-plugin.test.ts`。fastify（devDependency）にプラグインを register し、`inject` で次を確認する: url なしで 400 と `{ error: 'url is required' }`、取得失敗で 500 と `error.statusCode`、正常時に `title` が入ること
- [ ] **Step 2: 実行して失敗を確認する**
- [ ] **Step 3: 実装する**
- [ ] **Step 4: test と `pnpm --filter @tiramiss-community/chiramiss build && pnpm --filter @tiramiss-community/chiramiss typecheck:compat` が通ることを確認する**
- [ ] **Step 5: Commit** — `feat: 本家互換の Fastify プラグインと互換型検査を追加`

---

### Task 10: スタンドアロンサーバ

**Files:**
- Create: `packages/server/{package.json,tsconfig.json,tsdown.config.ts,vitest.config.ts}`、`packages/server/src/{config.ts,query.ts,app.ts,index.ts}`
- Test: `packages/server/test/config.test.ts`、`packages/server/test/app.test.ts`

**Interfaces:**
- Consumes: lib の `createSummaly`、`SummalyOptions`、`StatusError`（`"@tiramiss-community/chiramiss": "workspace:*"`。vitest では lib の `src/index.ts` へのエイリアスにし、テストのために lib をビルドしなくて済むようにする）
- Produces:
  - `loadServerConfig(env: NodeJS.ProcessEnv): ServerConfig`。`ServerConfig = { host: string; port: number; summalyOptions: SummalyOptions }`。fork `25e3636` の `src/server/config.ts` を移植し、次の変数を足す。
    - `SUMMALY_ALLOWED_PRIVATE_NETWORKS`: カンマ区切りの CIDR → `allowedPrivateNetworks`（不正なら `ServerConfigError`）
    - `HTTP_PROXY` / `http_proxy`、`HTTPS_PROXY` / `https_proxy`、`NO_PROXY` / `no_proxy` → `proxy`（大文字を優先する。どれもなければ `proxy` キー自体を入れない）
    - `SUMMALY_CACHE_TTL` → `cacheTtl`、`SUMMALY_ERROR_CACHE_TTL` → `errorCacheTtl`（非負整数）
  - `parseQueryOptions(query: Record<string, unknown>): Partial<SummalyOptions>`。`lang`、`followRedirects`（`'true'` / `'false'`）、`userAgent`、`responseTimeout`、`operationTimeout`、`contentLengthLimit`、`contentLengthRequired` を読む。不正な値や配列は「未指定」として捨てる（本家はこれらのクエリをすべて無視していたので、捨てても互換を崩さない）
  - `buildApp(config: ServerConfig, deps?: { cache?: SummaryCache; coordinator?: InflightCoordinator }): FastifyInstance`。`deps` は、将来 `REDIS_URL` から Redis 版を作って差し込むための口。今回は `index.ts` から何も渡さない
    - `GET /`: オプションの優先順は `config.summalyOptions`（環境変数）→ クエリ → `{ followRedirects: false }`（本家プラグインと同じ既定値）。上限系（`contentLengthLimit`、`responseTimeout`、`operationTimeout`、`contentLengthRequired`）のクエリは厳しくする方向にしか効かない（Ruling R35。spec 4.2 を参照）。応答の形は Task 9 と同じ（400 / 500 / 要約）
    - `GET /healthz`: 200 と `{ status: 'ok' }`
    - アプリごとに `createSummaly({ ...config.summalyOptions, ...deps })` を1つ作り、一本化とキャッシュを効かせる
  - `index.ts`: fork の `src/server/index.ts` と同じ起動処理と graceful shutdown（SIGINT / SIGTERM で `fastify.close()` してから exit）

- [ ] **Step 1: fork のテストを移植する** — `~/develop/summaly/test/server.test.ts` の `describe('loadServerConfig')` を丸ごと `config.test.ts` に写す。`describe('環境変数で設定したサーバーの動作')` は `buildApp` を使う形に直して `app.test.ts` に写す
- [ ] **Step 2: 追加テストを書く**

```ts
// config.test.ts
test('SUMMALY_ALLOWED_PRIVATE_NETWORKS をカンマ区切りで読む、不正な CIDR はエラー');
test('HTTPS_PROXY / NO_PROXY を proxy に入れる、大文字が小文字より優先');
test('SUMMALY_CACHE_TTL / SUMMALY_ERROR_CACHE_TTL を読む');
// app.test.ts
test('GET /healthz は 200 {status:"ok"}');
test('クエリの contentLengthLimit が反映される'); // 上限より大きい HTML で 500
test('上限系のクエリは厳しくする方向にしか効かない'); // Ruling R35
test('不正なクエリ値は無視される'); // contentLengthLimit=abc でも 200
test('followRedirects はクエリで true を指定したときだけリダイレクトを追う');
test('本体の fetchSummaryFromProxy と同じクエリ形式で呼んで成功する');
  // tiramiss UrlPreviewService.fetchSummaryFromProxy のキー（url, lang, followRedirects, userAgent, operationTimeout, contentLengthLimit, contentLengthRequired）をそのまま組み立てる
```

- [ ] **Step 3: 実行して失敗を確認する**
- [ ] **Step 4: 実装する**
- [ ] **Step 5: 実行して成功を確認する**。続けて `pnpm build` の後に `SUMMALY_PORT=3999 node packages/server/built/index.js` で起動し、`curl -s localhost:3999/healthz` が `{"status":"ok"}` を返すこと、Ctrl-C で正常終了することを確かめる
- [ ] **Step 6: Commit** — `feat: スタンドアロンサーバを追加`

---

### Task 11: Docker イメージと compose の例

**Files:**
- Create: `Dockerfile`、`.dockerignore`、`docker-compose.example.yml`

**Interfaces:**
- Consumes: Task 10 の `packages/server/built/index.js` と `/healthz`

内容:
- `Dockerfile` はマルチステージにする。build ステージで `corepack enable`（corepack は版を固定して入れる）、`pnpm install --frozen-lockfile`（層のキャッシュが効くよう、manifest と lockfile だけを先にコピーして実行する）、`pnpm build`、`pnpm --filter @tiramiss-community/chiramiss-server deploy --prod /out` を行う（pnpm 12 の `deploy` が workspace 依存を解決するのに必要な設定があれば、ここで入れる）。runtime ステージは Node 26 の slim イメージにし、`/out` だけをコピーする
- runtime の設定: `ENV NODE_ENV=production SUMMALY_HOST=0.0.0.0 SUMMALY_PORT=3000`、`EXPOSE 3000`、`USER node`、`HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:'+(process.env.SUMMALY_PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"`（`SUMMALY_PORT` に追従する。Ruling R51）、`CMD ["node", "built/index.js"]`
- OCI ラベル `org.opencontainers.image.source=https://github.com/tiramiss-community/chiramiss`（ghcr とリポジトリの紐付けに使われる）
- `docker-compose.example.yml` は `services.chiramiss` だけを定義する。`image: ghcr.io/tiramiss-community/chiramiss:latest`、`restart: unless-stopped`、主な環境変数はコメントで例示する。ports は公開せず、Misskey と同じネットワークから `http://chiramiss:3000/` で呼ぶ想定をコメントで説明する

- [ ] **Step 1: `docker build -t chiramiss:dev .` が成功することを確認する**
- [ ] **Step 2: `docker run --rm -d -p 3999:3000 --name chiramiss-dev chiramiss:dev` で起動し、`curl -s localhost:3999/healthz` が `{"status":"ok"}` を返すこと、`docker inspect --format '{{.Config.User}}' chiramiss:dev` が `node` であることを確認する**
- [ ] **Step 3: `docker stop chiramiss-dev` が 10 秒の猶予内に終わり、ログに shutdown の行が出ることを確認する**
- [ ] **Step 4: `docker compose -f docker-compose.example.yml config` が通ることを確認する**
- [ ] **Step 5: Commit** — `feat: Dockerfile と compose の例を追加`

---

### Task 12: CI、リリース、ドキュメント

**Files:**
- Create: `.github/workflows/ci.yml`、`.github/workflows/release.yml`、`.changeset/initial-release.md`、`README.md`、`docs/publishing.md`

内容:
- `ci.yml`: `pull_request` と `push`（main）で実行する。pnpm と Node（22・24・26 の matrix。Ruling R44）を用意して、`pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm --filter @tiramiss-community/chiramiss typecheck:compat` を走らせる。別ジョブで `docker/build-push-action` を `push: false`、`platforms: linux/amd64,linux/arm64` で走らせる
- `release.yml`: `push`（main）で実行する。権限は `contents: write`、`pull-requests: write`、`id-token: write`、`packages: write`
  - job `release`: `changesets/action` で、`publish: pnpm release` を指定する。npm トークンは渡さない（Trusted Publishing）。出力 `published` を job output にする
  - job `docker`: `needs: release`、`if: needs.release.outputs.published == 'true'`。`packages/server/package.json` の version を読み、`docker/metadata-action` でタグ `X.Y.Z`、`X.Y`、`X`、`latest` を作る（0.x の間は `X` タグを付けない）。ghcr にログインし、amd64 / arm64 でビルドして push する
  - changesets が tag を push しても、GITHUB_TOKEN 由来なので別 workflow は起動しない。そのため docker は同じ workflow の後続 job にする
- `.changeset/initial-release.md`: 2 パッケージとも `minor`（0.0.0 → 0.1.0）。本文は「summaly 互換の初回リリース」
- `README.md`（英語）に書くこと:
  1. 概要と summaly との互換範囲（spec 4.1 と 4.2）
  2. 本体への差し替え方法（npm エイリアスの例 `"@misskey-dev/summaly": "npm:@tiramiss-community/chiramiss@^0.1.0"`）
  3. 追加オプション（`allowedPrivateNetworks`、`proxy`、`cache`、`cacheTtl`、`errorCacheTtl`、`coordinator`、`createSummaly`）
  4. サーバの環境変数の一覧表（Task 10 の全変数と既定値）
  5. Docker と compose の使い方
  6. **About ChiramissBot** 節。UA の `+URL` の先になる。何をする bot か（ユーザが投稿した URL のプレビューを作るため、投稿されたときにページを1回取得する）、どう識別するか（UA）、問い合わせ先（GitHub Issues）
  7. 既知の制約: 本体の User-Agent は本体側で `SummalyBot/<chiramiss のバージョン>` と組み立てられること、`urlPreviewUserAgent` 設定で上書きできること（spec 4.5）
  8. ライセンスと本家へのクレジット
- `docs/publishing.md`（日本語）に書く、人がやる手順:
  1. npm で organization `tiramiss-community` を作る
  2. Trusted Publisher を登録するにはパッケージが存在している必要がある。そこでローカルで `pnpm --filter @tiramiss-community/chiramiss build` を実行し、`0.0.0` を `npm publish --access public --tag placeholder` で手動公開する。本番の 0.1.0 は、CI から Trusted Publishing で出す。これが OIDC 経路の動作確認も兼ねる。changesets は公開済みのバージョンを飛ばすので、0.0.0 とは衝突しない
  3. npm のパッケージ設定で Trusted Publisher を登録する（リポジトリ `tiramiss-community/chiramiss`、workflow `release.yml`）
  4. 最初の ghcr push の後、パッケージの公開範囲を Public にし、リポジトリとの紐付けを確認する
  5. changesets と Trusted Publishing の組み合わせが動くか確認する（spec 4.4）。`changeset publish` は内部で pnpm / npm の publish を呼ぶので、OIDC が使われない場合は、`release` スクリプトを `pnpm build && pnpm -r --filter ./packages/chiramiss exec npm publish --provenance --access public && changeset tag` に切り替える

- [ ] **Step 1: workflow を書く**。`actionlint` があれば `.github/workflows/*.yml` を検査して、エラーがないことを確認する（なければ `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest` を使う）
- [ ] **Step 2: `pnpm changeset status` で、2 パッケージが 0.1.0 になる予定と表示されることを確認する**
- [ ] **Step 3: README と publishing.md を書く**
- [ ] **Step 4: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` がすべて通ることを確認する**
- [ ] **Step 5: Commit** — `ci: CI とリリース workflow、ドキュメントを追加`

---

### Task 13: 本体への差し替え確認（コミットなし）

**Files:** なし（tiramiss の一時 worktree で確認するだけ）

- [ ] **Step 1: `pnpm --filter @tiramiss-community/chiramiss pack --pack-destination <scratchpad>` で tarball を作る**
- [ ] **Step 2: `git -C ~/develop/tiramiss worktree add <scratchpad>/tiramiss-check` で一時 worktree を作る**。`packages/backend`、`packages/frontend`、`packages/frontend-embed` の `@misskey-dev/summaly` を、`"file:<tarball の絶対パス>"` に置き換えて `pnpm install` する。依存キーは `@misskey-dev/summaly` のままなので、本体のコードからは同じ名前で解決される。公開後の npm エイリアスで差し替えたときと同じ状態になる。`ls node_modules/@misskey-dev/summaly/package.json` の name が `@tiramiss-community/chiramiss` であることを確かめる
- [ ] **Step 3: backend のビルドと型検査（tiramiss の既存 script）が通ること、frontend の型検査が通ることを確認する**
- [ ] **Step 4: 結果（通った / 通らなかったコマンドとエラー）を報告する**。最後に worktree を `git worktree remove` で片付ける。tiramiss 側には何もコミットしない
