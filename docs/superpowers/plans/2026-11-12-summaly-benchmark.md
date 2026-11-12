# summaly 比較ベンチマーク Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm bench` 1 コマンドで、手元ビルドの chiramiss と summaly 公式イメージを、ローカルの偽 HTTPS サーバ相手に同一条件で測り、README に貼れる Markdown と生データ JSON を出す。

**Architecture:** 新しい private ワークスペースパッケージ `packages/bench`。TypeScript をビルドせず Node の型ストリッピングで直接実行する。docker compose 上に origin（偽サーバ＋遅延 TCP プロキシ＋制御 API）、chiramiss / summaly（片方ずつ起動）、loadgen（1 ランごとに `compose run`）を置き、ホスト側の `src/cli.ts` が順番に回して集計する。

**Tech Stack:** Node.js（`node:` 組み込みモジュールのみ、実行時依存なし）、TypeScript 7（型検査のみ）、vitest 5、Docker Compose v2、openssl（証明書の再生成時のみ）。

**Spec:** `docs/superpowers/specs/2026-11-12-summaly-benchmark-design.md`

## Global Constraints

- 第三者のサイトへは一切リクエストしない。要約対象の URL はすべて `https://origin.bench/...`。
- chiramiss の環境変数に `CHIRAMISS_ALLOW_PRIVATE_IP` / `SUMMALY_ALLOW_PRIVATE_IP` を**入れない**。代わりに `CHIRAMISS_ALLOWED_PRIVATE_NETWORKS=<ベンチ用サブネット>`。
- summaly には `SUMMALY_ALLOW_PRIVATE_IP=true`。
- 両者共通の設定（chiramiss も `SUMMALY_*` を読むので同じ名前で渡す）: `SUMMALY_LANG=ja-JP`、`SUMMALY_USER_AGENT=ChiramissBench/1.0`、`SUMMALY_FOLLOW_REDIRECTS=true`、`SUMMALY_RESPONSE_TIMEOUT=20000`、`SUMMALY_OPERATION_TIMEOUT=60000`、`SUMMALY_CONTENT_LENGTH_LIMIT=10485760`、`SUMMALY_CONTENT_LENGTH_REQUIRED=false`、`NODE_EXTRA_CA_CERTS=/certs/ca.pem`。chiramiss のキャッシュ設定は既定のまま（本番の挙動を測る）。
- summaly の既定イメージ: `ghcr.io/misskey-dev/summaly:5.6.0`（`--summaly-image` で差し替え可）。
- chiramiss はリポジトリの `Dockerfile` を `--build-arg NODE_IMAGE=node:<summaly の node -v から v を除いた版>-slim` でビルドする。
- 両ターゲットに同じ `cpus` / `mem_limit`（既定 `2` / `1g`）。両ターゲットを同時に動かさない。各ランの前にターゲットを作り直す（キャッシュ空・メモリピークがラン単位になる）。
- ベンチ用ネットワークのサブネット既定値 `172.30.250.0/24`（`--subnet` で変更可）。origin のネットワークエイリアス `origin.bench`。
- コードは repo の oxlint 規則（タブ、シングルクォート、`curly: all`、宣言の後と return の前の空行）に従う。`pnpm lint` / `pnpm typecheck` / `pnpm test` が通ること。
- 結果ファイル（`packages/bench/results/`）はコミットしない。
- 出力する Markdown（README に貼る物）は英語。README の見出しは「遅延なし・article ページの中央値の比」で "summarizes X× faster" と書き、条件をそのすぐそばに書く。

## Review Focus

1. **速いが壊れた応答**: ターゲットがエラーや中身の違う要約を速く返すと「速い」に見える。loadgen は HTTP 200 かつ `title`（oembed は `player.url` も）が期待値と一致した応答だけを成功とし、失敗は件数とサンプルを結果に残し、レポートで警告する。→ Task 4（loadgen のテスト）、Task 7（レポートのテスト）。
2. **キャッシュが効いた結果の混入**: S1 / S2 では、origin が受けたページ本体のリクエスト数が成功件数以上でなければならない。満たさないランはレポートで警告する。→ Task 7。
3. **ターゲットが起動しない・途中で落ちる・イメージが pull できない**（5.6.0 の公開前は必ず起きる）: 該当ターゲット名とともに、その理由をはっきり示して止める。中途半端な表は出さない。→ Task 6（`pullImage` の失敗メッセージのテスト）。
4. **遅延の変更が既存の keep-alive 接続に効かない**: 遅延値は読み込むチャンクごとに読む。→ Task 2（ランの途中で遅延を変えるテスト）。
5. **Shift_JIS ページが正しい Shift_JIS になっていない**（UTF-8 のまま送ると比較の意味がなくなる）: → Task 1（`TextDecoder('shift_jis')` で復号できることと、UTF-8 として不正であることのテスト）。

---

## File Structure

```
packages/bench/
  package.json            private, "@tiramiss-community/chiramiss-bench"
  tsconfig.json
  vitest.config.ts
  compose.yaml            origin / chiramiss / summaly / loadgen
  README.md               English: 前提・実行方法・所要時間・README への反映手順
  .gitignore              results/ と .env.*
  certs/
    generate.sh           openssl で CA と origin.bench のサーバ証明書を作る（有効期間 36500 日）
    ca.pem  origin.pem  origin-key.pem   生成済みをコミット（ベンチ専用である旨を README に書く）
  src/
    types.ts              共有型
    fixtures.ts           ページのバイト列（決定的）
    delay-proxy.ts        遅延 TCP プロキシ
    origin.ts             偽サーバ本体（HTTPS + 遅延プロキシ + 制御 API）
    origin-main.ts        コンテナ用エントリ
    stats.ts              パーセンタイルなど
    loadgen.ts            負荷生成と応答検証
    loadgen-main.ts       コンテナ用エントリ（argv の JSON → stdout の JSON）
    scenarios.ts          ラン計画（純粋関数）
    targets.ts            ターゲットごとの環境変数（純粋関数）
    cgroup.ts             cgroup v2 ファイルのパース
    docker.ts             docker / docker compose の薄いラッパ
    report.ts             結果 → Markdown
    cli.ts                オーケストレータ（ホストで実行）
  test/
    fixtures.test.ts  delay-proxy.test.ts  origin.test.ts  stats.test.ts
    loadgen.test.ts  scenarios.test.ts  targets.test.ts  cgroup.test.ts  report.test.ts  docker.test.ts
```

ルートの変更: `package.json` に `"bench": "pnpm --filter @tiramiss-community/chiramiss-bench bench --"`、`.dockerignore` に `packages/bench`、`.changeset/config.json` の `ignore` に `@tiramiss-community/chiramiss-bench`。

## Shared types (`src/types.ts`)

全タスクがこの名前を使う。Task 1 で作る。

```ts
export type PageKind = 'article' | 'large' | 'sjis' | 'oembed' | 'redirect';
export type TargetName = 'chiramiss' | 'summaly';
export type ScenarioId = 's1' | 's2' | 's3a' | 's3b';

export interface Expectation { title: string; playerUrl?: string }

export interface OriginStats {
	requests: Record<string, number>; // key: `${method} ${pathname}` 例: 'GET /article', 'HEAD /favicon.ico'
	newConnections: number;
	bytesOut: number; // origin → クライアントのワイヤ上のバイト数（TLS 込み）
}

export type Arrival = { kind: 'closed'; concurrency: number } | { kind: 'spread'; durationMs: number };

export interface LoadSpec {
	targetBaseUrl: string;   // 例 'http://chiramiss:3000/'
	originControlUrl: string; // 例 'http://origin.bench:9000/'
	rttMs: number;
	urls: string[];          // 要約させる URL（件数 = リクエスト数）
	arrival: Arrival;
	expected: Expectation;
	requestTimeoutMs: number;
}

export interface LoadResult {
	latenciesMs: number[]; // 成功したリクエストのみ
	ok: number;
	errors: number;
	errorSamples: string[]; // 最大 5 件
	wallMs: number;
	origin: OriginStats;   // ラン開始時にリセットした後の値
}

export interface RunSpec {
	scenario: ScenarioId;
	pageKind: PageKind;
	rttMs: number;
	requests: number;
	arrival: Arrival;
	sameUrl: boolean;
	runIndex: number;
	warmupRequests: number;
}

export interface RunRecord {
	target: TargetName;
	spec: RunSpec;
	load: LoadResult;
	cpuUsageUsec: number;     // 計測区間の差分
	memoryPeakBytes: number;
}

export interface BenchMeta {
	startedAt: string; host: { cpuModel: string; cpuCount: number; totalMemBytes: number; os: string; docker: string };
	limits: { cpus: string; memory: string };
	chiramiss: { commit: string; tag: string | null; dirty: boolean; node: string };
	summaly: { image: string; digest: string | null; node: string };
	quick: boolean;
}

export interface BenchResults { meta: BenchMeta; runs: RunRecord[] }
```

---

### Task 1: パッケージの土台とフィクスチャ

**Files:**
- Create: `packages/bench/package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/types.ts`, `src/fixtures.ts`, `test/fixtures.test.ts`
- Modify: `package.json`（ルート）, `.dockerignore`, `.changeset/config.json`

**Interfaces:**
- Produces: `src/types.ts` の全型。`PAGE_KINDS: readonly PageKind[]`（`['article','large','sjis','oembed','redirect']`）。`pagePath(kind: PageKind): string`（`/article` `/large` `/sjis` `/oembed-page` `/redirect`）。`expectationFor(kind: PageKind): Expectation`。`buildFixtures(): Fixtures`。

```ts
export interface FixtureResponse { status: number; headers: Record<string, string>; body: Uint8Array }
export interface Fixtures { respond(method: string, url: URL): FixtureResponse } // 未知のパスは 404
```

- [ ] **Step 1: ブランチを切る** — `git switch -c feat/bench`

- [ ] **Step 2: パッケージの設定を書く**
  - `package.json`: `"private": true`, `"type": "module"`, `"engines"` はルートと同じ。scripts は `"test": "vitest run"`, `"typecheck": "tsc --noEmit -p tsconfig.json"`, `"bench": "node src/cli.ts"`。devDependencies は `@types/node`, `typescript`, `vitest` を他パッケージと同じ版で固定。build スクリプトは置かない。
  - `tsconfig.json`: `tsconfig.base.json` を継承し、`noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax` を true にする。include は `src`, `test`, `vitest.config.ts`。相対 import は `.ts` 拡張子付きで書く。
  - ルートの `.dockerignore` に `packages/bench`、`.changeset/config.json` に `"ignore": ["@tiramiss-community/chiramiss-bench"]`、ルートの scripts に `"bench"` を足す。`pnpm install` でロックファイルを更新する。

- [ ] **Step 3: 失敗するテストを書く**（`test/fixtures.test.ts`）

```ts
test('bytes are deterministic', () => { /* buildFixtures() を 2 回呼び、全 PAGE_KINDS と /oembed.json /favicon.ico の body の sha256 が一致 */ });
test('article is tens of KB with OGP', () => { /* 20_000 <= body.length <= 80_000、og:title と og:image を含む */ });
test('large page is 1-2 MB and its <head> ends within the first 16 KB', () => { /* 1_000_000 <= length <= 2_000_000、indexOf('</head>') < 16_384 */ });
test('sjis page is real Shift_JIS', () => {
	// new TextDecoder('shift_jis').decode(body) が expectationFor('sjis').title を含む
	// new TextDecoder('utf-8', { fatal: true }).decode(body) は throw する
	// content-type ヘッダは charset なしの 'text/html'、本文に <meta charset="Shift_JIS">
});
test('oembed page links oEmbed JSON whose iframe src is the expected player url', () => { /* <link rel="alternate" type="application/json+oembed" href="https://origin.bench/oembed.json"> と、JSON の html の iframe src === expectationFor('oembed').playerUrl */ });
test('redirect answers 302 to /article keeping the query', () => { /* respond('GET', new URL('https://origin.bench/redirect?n=7')) → 302, location '/article?n=7' */ });
test('favicon answers GET and HEAD; HEAD has no body', () => {});
test('query string does not change the bytes', () => { /* /article?n=1 と ?n=2 で同じ body */ });
test('unknown path is 404', () => {});
```

- [ ] **Step 4: 実行して失敗を確認** — `pnpm --filter @tiramiss-community/chiramiss-bench test` → FAIL（モジュールがない）

- [ ] **Step 5: `src/types.ts`（上記の全文）と `src/fixtures.ts` を実装する**
  - 期待タイトル: article `Bench article`、large `Bench large page`、sjis `べんちまあくのぺえじ`、oembed `Bench oEmbed page`、redirect は article と同じ。oembed の `playerUrl` は `https://origin.bench/embed`。
  - 決定的な本文は、固定シードの単純な PRNG（例: mulberry32、シード 1）で語を並べて作る。`Math.random` は使わない。
  - Shift_JIS は外部ライブラリを使わずに作る。ひらがな U+3041〜U+3093 は Shift_JIS の 0x829F〜0x82F1 に連続して対応するので、本文はひらがなと ASCII だけで組み、オフセットで変換する。
  - oEmbed JSON は `{"version":"1.0","type":"rich","html":"<iframe src=\"https://origin.bench/embed\" width=\"480\" height=\"270\"></iframe>","width":480,"height":270}`。
  - 全ページに `<link rel="icon" href="/favicon.ico">`。favicon は数百バイトの固定バイト列（`image/x-icon`）。

- [ ] **Step 6: 実行して成功を確認** — 同じコマンドで PASS。あわせて `pnpm lint` と `pnpm typecheck` も通す。

- [ ] **Step 7: コミット** — `feat(bench): ベンチ用パッケージとフィクスチャを追加する`

### Task 2: 遅延 TCP プロキシ

**Files:** Create `src/delay-proxy.ts`, `test/delay-proxy.test.ts`

**Interfaces:**
- Produces:

```ts
export interface DelayProxyOptions {
	listenPort: number; listenHost?: string;
	upstream: { host: string; port: number };
	getRttMs: () => number;        // チャンクごとに読む
	onConnection?: () => void;
	onBytesToClient?: (n: number) => void;
}
export function startDelayProxy(opts: DelayProxyOptions): Promise<{ port: number; close(): Promise<void> }>;
```

方式: 両方向とも、各チャンクを `max(now + rtt/2, その方向で前に予定した時刻)` に書き出す（順序を保つ）。TCP の接続確立にかかる 1 往復を再現するため、新しい接続でクライアント→上流方向に流れる最初のチャンクには、さらに `rtt` を足す。`rtt = 0` のときは遅延なしでそのまま流す。

- [ ] **Step 1: 失敗するテストを書く**（上流は `net` のエコーサーバ）

```ts
test('first exchange on a new connection costs about 2 RTT, later ones about 1 RTT', async () => {
	// rtt=100: 1 回目の往復 >= 190ms、同じ接続の 2 回目 >= 95ms かつ < 190ms
});
test('rtt 0 adds no delay', async () => { /* 1 回目の往復 < 50ms */ });
test('rtt change applies to an existing connection', async () => { /* rtt=0 で接続し 1 往復 → rtt を 100 に変える → 次の往復 >= 95ms */ });
test('preserves byte order under many small writes', async () => { /* 1000 個の連番チャンクがエコーで順序どおりに返る */ });
test('counts connections and bytes to client', async () => {});
```

- [ ] **Step 2: 実行して失敗を確認** — `pnpm --filter @tiramiss-community/chiramiss-bench test -- delay-proxy` → FAIL
- [ ] **Step 3: `startDelayProxy` を実装する**。片側が閉じたらもう片側も閉じる。エラーは握りつぶさず両側を destroy する。
- [ ] **Step 4: 実行して成功を確認** — PASS
- [ ] **Step 5: コミット** — `feat(bench): 往復遅延を入れる TCP プロキシを追加する`

### Task 3: 偽サーバ（origin）と証明書

**Files:** Create `certs/generate.sh`, `certs/ca.pem`, `certs/origin.pem`, `certs/origin-key.pem`, `src/origin.ts`, `src/origin-main.ts`, `test/origin.test.ts`

**Interfaces:**
- Consumes: `buildFixtures`（Task 1）、`startDelayProxy`（Task 2）、`OriginStats`
- Produces:

```ts
export interface OriginOptions { httpsPort: number; controlPort: number; host?: string; certDir: string; initialRttMs?: number }
export function startOrigin(opts: OriginOptions): Promise<{ httpsPort: number; controlPort: number; close(): Promise<void> }>;
```

制御 API（平文 HTTP、`controlPort`）は `GET /stats` → `OriginStats` の JSON、`POST /reset` → 204（カウンタを 0 にする）、`PUT /rtt?ms=<n>` → 204。
構成: TLS の HTTP サーバを `127.0.0.1` のエフェメラルポートで待ち受け、`startDelayProxy` が `httpsPort` で受けてそこへ流す。リクエスト数は HTTP サーバ側で `${method} ${pathname}` ごとに数え、`newConnections` と `bytesOut` はプロキシのコールバックで数える。keep-alive は有効（`keepAliveTimeout` 5000ms）。
`origin-main.ts` は環境変数 `ORIGIN_HTTPS_PORT`（既定 443）、`ORIGIN_CONTROL_PORT`（既定 9000）、`ORIGIN_CERT_DIR`（既定 `/certs`）で `startOrigin` を起動し、SIGTERM で閉じる。

- [ ] **Step 1: 証明書を作る** — `certs/generate.sh`（openssl）で CA（CN `chiramiss bench CA`）と、SAN `DNS:origin.bench` のサーバ証明書を作る。有効期間はどちらも 36500 日。3 ファイルを `0644` でコミットする。
- [ ] **Step 2: 失敗するテストを書く**（`https.request` に `ca: ca.pem`, `servername: 'origin.bench'` を付けて `127.0.0.1` の `httpsPort` へ送る）

```ts
test('serves fixtures over TLS valid for origin.bench', async () => { /* GET /article?n=1 → 200、body が buildFixtures() のものと一致 */ });
test('stats count requests by method and path, connections and bytes; reset zeroes them', async () => {
	// GET /article?n=1、HEAD /favicon.ico を 1 本の keep-alive 接続で送る
	// → requests['GET /article'] === 1、requests['HEAD /favicon.ico'] === 1、newConnections === 1、bytesOut > 本文の長さ
	// POST /reset の後 → requests は {}、他は 0
});
test('PUT /rtt changes latency', async () => { /* ms=100 にした後の新規接続の GET は >= 190ms */ });
```

- [ ] **Step 3: 実行して失敗を確認** — FAIL
- [ ] **Step 4: `startOrigin` と `origin-main.ts` を実装する**
- [ ] **Step 5: 実行して成功を確認** — PASS
- [ ] **Step 6: コミット** — `feat(bench): 偽の対向サーバとベンチ用証明書を追加する`

### Task 4: 統計と負荷生成

**Files:** Create `src/stats.ts`, `src/loadgen.ts`, `src/loadgen-main.ts`, `test/stats.test.ts`, `test/loadgen.test.ts`

**Interfaces:**
- Produces:

```ts
// stats.ts
export interface LatencySummary { count: number; p50: number; p95: number; p99: number; mean: number; min: number; max: number }
export function percentile(sortedAsc: number[], p: number): number; // 線形補間（numpy 既定と同じ）。空配列は NaN
export function summarize(values: number[]): LatencySummary;
export function median(values: number[]): number;
// loadgen.ts
export function runLoad(spec: LoadSpec): Promise<LoadResult>;
export function warmup(spec: LoadSpec): Promise<void>; // origin の rtt 設定と負荷だけを行い、結果は捨てる
```

`runLoad` の手順: `PUT rtt` → `POST reset` → 負荷 → `GET stats`。要約リクエストは `${targetBaseUrl}?url=<encodeURIComponent(url)>&lang=ja-JP`。HTTP agent は keep-alive を有効にし、`maxSockets` は closed なら `concurrency`、spread なら `urls.length`。`closed` は同時実行数を一定に保つワーカー方式、`spread` は i 件目を `i * durationMs / urls.length` の時刻に送る。
成功の条件: HTTP 200、JSON の `title === expected.title`、`expected.playerUrl` がある場合は `player.url === expected.playerUrl`。それ以外（タイムアウトを含む）は error とし、`errorSamples` に `status + 本文の先頭 200 文字` を最大 5 件残す。
`loadgen-main.ts`: `node src/loadgen-main.ts <run|warmup> '<LoadSpec JSON>'` を受け取り、run なら `LoadResult` の JSON を 1 行で stdout に出す。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// stats.test.ts
test('percentile interpolates linearly', () => { expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5); expect(percentile([10], 0.99)).toBe(10); });
test('summarize', () => { /* [5,1,3] → count 3, p50 3, min 1, max 5, mean 3 */ });
// loadgen.test.ts — 偽のターゲット（http サーバ）と偽の制御 API をテスト内で立てる
test('closed arrival never exceeds concurrency', async () => { /* concurrency 4、50 件、ターゲットは 20ms 待って返す → 同時処理数の最大値 === 4 */ });
test('spread arrival sends at even offsets', async () => { /* 10 件を 500ms に散らす → 各到着時刻の i*50ms からのずれが 30ms 未満 */ });
test('wrong title, missing player, non-200 and timeout count as errors with samples', async () => {});
test('resets origin stats before load and returns stats after', async () => { /* 制御 API への呼び出し順が PUT /rtt, POST /reset, GET /stats */ });
```

- [ ] **Step 2: 実行して失敗を確認** — FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 実行して成功を確認** — PASS
- [ ] **Step 5: コミット** — `feat(bench): 負荷生成と応答検証を追加する`

### Task 5: ラン計画とターゲットの設定

**Files:** Create `src/scenarios.ts`, `src/targets.ts`, `src/cgroup.ts`, `test/scenarios.test.ts`, `test/targets.test.ts`, `test/cgroup.test.ts`

**Interfaces:**
- Produces:

```ts
// scenarios.ts
export interface PlanOptions { runs: number; quick: boolean }
export function buildPlan(opts: PlanOptions): RunSpec[];
export function urlsFor(spec: RunSpec, target: TargetName): string[];        // 計測用
export function warmupUrlsFor(spec: RunSpec, target: TargetName): string[];  // 暖機用（article、計測用と重ならない）
// targets.ts
export const SERVICE: Record<TargetName, string>; // compose のサービス名 'chiramiss' / 'summaly'
export function targetEnv(target: TargetName, subnet: string): Record<string, string>;
// cgroup.ts
export function parseCgroup(cpuStat: string, memoryPeak: string): { cpuUsageUsec: number; memoryPeakBytes: number };
```

計画の値（full / quick）:

| | full | quick |
|---|---|---|
| runs（`--runs` で変更可） | 3 | 1 |
| S1: 全 `PAGE_KINDS` × rtt `[0, 50]`、closed concurrency 1 | 100 件 | 10 件 |
| S2: article、rtt 50、concurrency `[10, 50, 100]`、closed | concurrency×20 件 | concurrency×5 件、concurrency は `[10]` のみ |
| S3a: oembed、rtt 50、同じ URL を N 件、closed concurrency N | N=100 | N=20 |
| S3b: oembed、rtt 50、同じ URL を N 件、spread | N=100、10000ms | N=20、2000ms |
| 暖機 | `min(100, max(30, 2×concurrency))` 件 | 5 件 |

URL は `https://origin.bench${pagePath(kind)}?n=${target}-${scenario}-${rtt}-${concurrency|N}-r${runIndex}-${i}` で、ラン同士・ターゲット同士で重ならない。`sameUrl` のときは i を付けず、全件同じ URL にする。暖機用は `-w${i}` を付けた article。

- [ ] **Step 1: 失敗するテストを書く**

```ts
test('full plan matches the table', () => { /* 件数: S1 は 5*2*3=30 ラン、S2 は 3*3、S3a・S3b は 3 ずつ。各値が表どおり */ });
test('urls are unique within and across runs and targets, except sameUrl runs', () => {});
test('warmup urls never collide with measured urls', () => {});
test('chiramiss env never disables the private IP block', () => {
	const env = targetEnv('chiramiss', '172.30.250.0/24');
	expect(Object.keys(env).filter((k) => k.endsWith('ALLOW_PRIVATE_IP'))).toEqual([]);
	expect(env.CHIRAMISS_ALLOWED_PRIVATE_NETWORKS).toBe('172.30.250.0/24');
});
test('summaly env allows private IP; shared settings are identical', () => { /* Global Constraints の共通設定が両方で同じ値 */ });
test('parseCgroup', () => { expect(parseCgroup('usage_usec 1234\nuser_usec 1000\n', '5678\n')).toEqual({ cpuUsageUsec: 1234, memoryPeakBytes: 5678 }); });
test('parseCgroup throws on missing usage_usec', () => {});
```

- [ ] **Step 2: 実行して失敗を確認** — FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 実行して成功を確認** — PASS
- [ ] **Step 5: コミット** — `feat(bench): ラン計画とターゲットの設定を追加する`

### Task 6: compose とオーケストレータ

**Files:** Create `compose.yaml`, `src/docker.ts`, `src/cli.ts`, `test/docker.test.ts`

**Interfaces:**
- Consumes: Task 4 の `loadgen-main.ts`、Task 5 の `buildPlan` / `urlsFor` / `warmupUrlsFor` / `targetEnv` / `SERVICE` / `parseCgroup`、Task 3 の `origin-main.ts`
- Produces:

```ts
// docker.ts — すべて execFile。失敗時は、コマンドと stderr を含む Error を投げる
export function compose(args: string[], env: Record<string, string>): Promise<string>; // `docker compose -f <bench>/compose.yaml -p chiramiss-bench ...`
export function pullImage(image: string): Promise<void>; // 失敗時: `summaly image ${image} could not be pulled (is it published yet?)` で始まる Error
export function imageDigest(image: string): Promise<string | null>;
export function nodeVersionOfImage(image: string): Promise<string>; // 'v26.13.1' → '26.13.1'
// cli.ts
export function main(argv: string[]): Promise<void>;
```

`compose.yaml`:
- ネットワーク `bench`。ipam のサブネットは `${BENCH_SUBNET}`。
- `origin`: `${BENCH_NODE_IMAGE}`。`./src` を `/bench/src`、`./certs` を `/certs` に読み取り専用でマウントし、`node /bench/src/origin-main.ts` を実行する。エイリアスは `origin.bench`。
- `chiramiss`: build は context `../..`、args `NODE_IMAGE: ${BENCH_NODE_IMAGE}`、image 名 `chiramiss-bench:local`。
- `summaly`: `${SUMMALY_IMAGE}`。
- 両ターゲットの共通設定: `cpus: ${BENCH_CPUS}`、`mem_limit: ${BENCH_MEMORY}`。環境変数は `env_file: .env.<target>` で渡す。このファイルは cli が `targetEnv()` から書き出し、gitignore する。certs を `/certs` に読み取り専用でマウントする。healthcheck は `node -e "fetch('http://127.0.0.1:3000/').then(()=>process.exit(0),()=>process.exit(1))"`、`start_period: 60s`、`start_interval: 500ms`、`interval: 1h`（計測中の CPU に混ざらないようにする）。
- `loadgen`: `${BENCH_NODE_IMAGE}`。`./src` をマウントし、`profiles: [tools]` を付ける。

`main` の流れ:
1. 引数を読む: `--quick`、`--runs <n>`、`--summaly-image <ref>`、`--cpus <n>`、`--memory <size>`、`--subnet <cidr>`、`--out <dir>`（既定 `results/<YYYYMMDD-HHmmss>-<short sha>`）。
2. `pullImage(summaly)` を実行し、`nodeVersionOfImage` で Node の版を得る。
3. `compose build chiramiss` を実行し、`origin` を起動する。
4. 各ターゲットについて、各 RunSpec ごとに次を行う。
   1. `up -d --force-recreate --wait <service>` でターゲットを作り直す。
   2. `run --rm loadgen warmup` で暖機する。
   3. `exec -T <service> cat /sys/fs/cgroup/cpu.stat /sys/fs/cgroup/memory.peak` を読む（計測前）。
   4. `run --rm loadgen run` で計測する。
   5. もう一度 cgroup を読む（計測後）。
   6. `stop <service>` でターゲットを止める。
   - 進行状況を stderr に 1 行ずつ出す（例: `[12/96] summaly s1 article rtt=0 run 2/3`）。
5. `results.json`（`BenchResults`）と、Task 7 の `report.md` を書く。
6. 成否にかかわらず `down -v` で後片付けする。

途中で失敗したら、どのターゲットのどのランで失敗したかを表示し、終了コード 1 で止める。そのとき `report.md` は書かない。
`BenchMeta` には `git rev-parse HEAD`、`git describe --tags --exact-match`（なければ null）、`git status --porcelain` が空でないかどうか、両ターゲットの `node -v`、`os.cpus()`、`os.totalmem()`、`os.type() + os.release()`、`docker version --format {{.Server.Version}}` を入れる。

- [ ] **Step 1: 失敗するテストを書く**（`test/docker.test.ts`。実際の docker は呼ばない。`vi.mock('node:child_process')` で `execFile` を差し替える）

```ts
test('pullImage failure names the image and hints that it may be unpublished', async () => {
	// execFile のスタブが 'denied' で失敗する
	await expect(pullImage('ghcr.io/misskey-dev/summaly:5.6.0')).rejects.toThrow(/ghcr\.io\/misskey-dev\/summaly:5\.6\.0 could not be pulled \(is it published yet\?\)/);
});
test('nodeVersionOfImage strips the v', async () => { /* execFile のスタブが 'v26.13.1\n' を返す → '26.13.1' */ });
```

- [ ] **Step 2: 実行して失敗を確認** — FAIL
- [ ] **Step 3: `docker.ts`、`compose.yaml`、`cli.ts` を実装する**
- [ ] **Step 4: 実行して成功を確認** — PASS
- [ ] **Step 5: E2E スモーク（chiramiss 単独）**
  - summaly 5.6.0 はまだ公開されていない。そこで summaly の master を固定コミットで手元ビルドし、仮の比較相手にする。
    1. `git clone https://github.com/misskey-dev/summaly <scratchpad>/summaly`
    2. `docker build -t summaly-bench:dev <scratchpad>/summaly`
  - 実行: `pnpm bench --quick --summaly-image summaly-bench:dev`
  - 期待する結果:
    - 終了コード 0。
    - `results/*/results.json` の全ランで `errors === 0`。
    - S1・S2 の各ランで `origin.requests['GET <pagePath>'] >= ok` が成り立つ。
    - chiramiss コンテナの環境変数（`docker inspect`）に `ALLOW_PRIVATE_IP` が含まれない。
  - いずれかのページで片方が検証に落ちたら、フィクスチャのほうを直す（検証は緩めない）。
  - 所要時間を記録し、README に書く。
- [ ] **Step 6: コミット** — `feat(bench): compose 構成とオーケストレータを追加する`

### Task 7: レポート生成と README

**Files:** Create `src/report.ts`, `test/report.test.ts`, `README.md`（packages/bench）; Modify `src/cli.ts`（`renderReport` を呼ぶ）

**Interfaces:**
- Consumes: `BenchResults`、`summarize` / `median`
- Produces: `export function renderReport(results: BenchResults): string;`

レポートの構成（英語）:
1. 見出し: `**chiramiss summarizes a typical article page ${x}× faster than summaly** (median, no added network latency — the cost of summarizing itself).` 続けて `Across page types: ${min}×–${max}×.` を置く。x は S1・article・rtt 0 の `summaly の p50 / chiramiss の p50` で、小数 1 桁にする。p50 は全ランを合わせた値で計算する。min / max は rtt 0 の各 kind の倍率。
2. S1 の表: 行は kind × rtt。列は summaly p50 / p95、chiramiss p50 / p95、倍率、ラン間のばらつき（各ランの p50 の最小〜最大）。
3. S2 の表: 行は concurrency。各ターゲットについて、req/s（`ok / wallMs * 1000` のラン平均）、p50、p99、エラー率を出す。
4. S3 の表: 行は S3a / S3b。各ターゲットについて、origin のリクエスト総数・送信バイト（KiB）・新規接続数（いずれもラン平均）と p50 を出す。行ラベルには何が効いているか（S3a は "in-flight sharing"、S3b は "in-flight sharing + result cache"）を書く。
5. S4 の表: 行はシナリオ。各ターゲットについて、要約 1 件あたりの CPU ms（ラン平均）とメモリピーク MiB（ラン最大）を出す。
6. 注記: 同じホストの別 URL に対して keep-alive 再利用と favicon 確認キャッシュが効いていること、偽サーバと RTT の条件。
7. 環境: `BenchMeta` の全項目（コミット、dirty かどうか、summaly のイメージと digest、両者の Node 版、上限、ホスト）。
8. 警告（あれば表の前に置く）: いずれかのランで `errors > 0` なら `⚠ <target> <scenario> ...: N errors (sample: ...)`。S1・S2 で `origin.requests['GET <pagePath>'] < ok` なら `⚠ cache hit suspected in ...`。`dirty` なら `⚠ working tree was dirty`。`quick` なら `⚠ quick mode — not for publication`。

- [ ] **Step 1: 失敗するテストを書く**（手で作った小さな `BenchResults` を使う）

```ts
test('headline uses s1 article rtt0 pooled medians', () => { /* summaly の p50 300ms、chiramiss の p50 100ms → '3.0× faster' を含む */ });
test('range covers all kinds at rtt 0 only', () => { /* rtt 50 の倍率は範囲に入らない */ });
test('errors produce a warning naming target and scenario', () => {});
test('page fetches fewer than ok in s1/s2 produce cache-hit warning; s3 does not', () => {});
test('dirty tree and quick mode produce warnings', () => {});
test('environment section lists commit, summaly digest and both node versions', () => {});
```

- [ ] **Step 2: 実行して失敗を確認** — FAIL
- [ ] **Step 3: `renderReport` を実装し、`cli.ts` から `report.md` を書き出す**
- [ ] **Step 4: 実行して成功を確認** — PASS
- [ ] **Step 5: `packages/bench/README.md` を書く**（英語）。次の内容を入れる。
  - 何を測るか（S1〜S4）
  - 前提: Linux のネイティブ Docker、cgroup v2、amd64 / arm64。WSL2 上の Docker Engine を含み、Docker Desktop は保証しない。Node と pnpm が必要。
  - 実行コマンドとオプション、Task 6 で測った所要時間
  - 第三者のサイトには一切アクセスしないこと
  - certs はベンチ専用で、`generate.sh` から再生成できること
  - リリース時に README を更新する手順: タグを checkout し、クリーンな作業ツリーで実行し、`report.md` の見出しと表を貼る
- [ ] **Step 6: 全体を確認** — `pnpm lint && pnpm typecheck && pnpm test` がすべて成功すること。続けて `pnpm bench --quick --summaly-image summaly-bench:dev` を実行し、`report.md` に見出しと 4 つの表、環境、quick の警告が出ることを目で確かめる。
- [ ] **Step 7: コミット** — `feat(bench): README に貼るレポートの生成を追加する`
