# chiramiss 設計書

- 日付: 2026-11-11
- リポジトリ: `tiramiss-community/chiramiss`
- 元にするもの: [misskey-dev/summaly](https://github.com/misskey-dev/summaly) v5.5.2。手元の作業 fork は `~/develop/summaly` にある

## 1. 何を作るか、なぜ作るか

chiramiss は summaly の互換実装。Web ページの URL を受け取り、タイトル、説明、サムネイル、oEmbed プレイヤーなどの要約を返す。Misskey 系の本体（tiramiss / endolphin）は、この要約を URL プレビュー機能に使っている。

作る理由は次のとおり。

1. **summaly の実装がメンテしにくい。** 処理がベタ書きで、責務やスコープが分かれていない。一例として、呼び出し側から渡された HTTP agent をモジュールのグローバル変数に上書きで保存している（`src/utils/got.ts` の `setAgent`）。このため、同じプロセスで設定の違う呼び出しが混ざると干渉する。
2. **対向サイトに負荷をかけたくない。** タイムラインに流れた URL のプレビューは、閲覧中のユーザから一斉に要求される。本体の `MemoryKVCache.fetchMaybe`（tiramiss `packages/backend/src/misc/cache.ts`）は取得中のリクエストを一本化しない。そのため、最初の結果が返るまでに来た要求はすべて対向サイトへ届く。失敗した結果もキャッシュしないので、落ちかけのサイトほど繰り返し叩かれる。CDN キャッシュのない小さなサイトでは、これが負荷になる。

### 速度について（調査済み）

「Node の I/O は遅い」という懸念があったので、実測した。条件は、ローカル HTTP サーバから約 350KB の HTML を取得してパースする処理を同時 20 本走らせ、1 リクエストあたりの時間を測ったもの。

| 処理 | Node 24 | Bun 1.3 |
|---|---|---|
| HTTP 取得のみ（fetch） | 0.58 ms | 0.16 ms |
| HTTP 取得のみ（got） | 1.27 ms | — |
| cheerio でページ全体をパースのみ | 18.7 ms | 20.5 ms |

ボトルネックは HTTP ではなく、ページ全体を DOM にするパースだった。実際の外部サイトの応答時間は 100ms から数秒あるので、ランタイムの HTTP 性能の差は埋もれる。**ランタイムは Node のまま**とし、速度改善はパースの範囲を絞る方向で行う。

## 2. ゴール

- **差し替えがきく互換 lib。** 本体の `package.json` で依存先を `@misskey-dev/summaly` から `@tiramiss-community/chiramiss` に変えれば、本体のコードを変えずに動くこと。本体のコードは `@misskey-dev/summaly` という名前で import しているので、差し替えは npm エイリアス（`"@misskey-dev/summaly": "npm:@tiramiss-community/chiramiss@..."`）で行う想定。backend だけでなく `packages/frontend` と `packages/frontend-embed` も `SummalyResult` 型のためにこのパッケージに依存しているので、型定義（`.d.ts`）はフロントエンドのビルドでも型検査が通ること。
- **互換スタンドアロンサーバ。** 本体の「URL プレビューの要約プロキシ URL」設定（`urlPreviewSummaryProxyUrl`）にこのサーバを指定すれば、そのまま動くこと。
- **読みやすく保守しやすいコード。** 関数で意味とスコープを分け、ファイルも分ける。サイト固有の特殊処理は「プロバイダ」として閉じ込め、汎用処理には混ぜない。
- **対向サイトへの負荷を抑える。** 同じ要求が同時に来たら一本化し、結果を短時間キャッシュする。
- **Docker イメージの公開。** Dockerfile を用意し、GitHub Actions で ghcr.io に公開する。同じマシンでの単体起動から k8s まで、どちらでも動かせる構成にする。

## 3. ゴールではないもの、避けたいもの

### ゴールではないもの

- **本家と結果を一字一句そろえること。** パース方式を変えた結果、タイトルやサムネイルの拾い方が本家と少しずれても構わない。互換性の対象は「外から見える口」（API、型、オプション、HTTP インターフェース）であって、出力の中身の完全一致ではない。
- **台をまたいで共有するキャッシュ（Redis など）を今回作ること。** ただし後から追加できる作りにはしておく（5.4 を参照）。
- **Node 以外のランタイム（Bun、Deno）への対応。**

### 避けたいもの（動いていても失敗とみなす）

- **結局また読みにくくなること。** 互換性のための特別扱いはプロバイダか専用の関数に閉じ込め、汎用の流れにベタ書きで混ぜない。そうして閉じ込められている限り、特別扱いがあること自体は許容する。

## 4. 制約

### 4.1 外部互換（lib）

本家 v5.5.2 の公開 API を保つ。**足すのは自由、削る・意味を変えるのは慎重に**（本当に必要な場合は理由を残す）。

- export: `summaly(url, options?)`、`version`、`summalyDefaultOptions`、`SummalyResult`、`SummalyOptions`、`SummalyPlugin`、default export の Fastify プラグイン
- `SummalyOptions` のキーと意味: `lang`、`followRedirects`、`plugins`、`agent`、`userAgent`、`responseTimeout`、`operationTimeout`、`contentLengthLimit`、`contentLengthRequired`
  - `agent` の型は本家と同じく `{ http?: http.Agent, https?: https.Agent }` を受け付ける。本体は自前の `HttpRequestService.httpAgent` / `httpsAgent` をここに渡しており、プロキシやプライベート IP の遮断がこの agent を通して効いている。**渡された agent は実際のリクエストで必ず使うこと。** そのため、agent を受け付けない Node 組み込みの `fetch` は、そのままでは使えない。
  - agent を指定した呼び出しの間で、設定が干渉しないこと。本家のグローバル変数方式はやめる。
- `SummalyResult` の形: `title`、`icon`、`description`、`thumbnail`、`thumbnailStyle`、`sitename`、`player`（`url`、`width`、`height`、`allow`）、`sensitive`、`activityPub`、`fediverseCreator`、`url`
- `SummalyPlugin` インターフェース（`test(url)`、`summarize(url, opts)`）。利用者が渡したカスタムプラグインもこれまでどおり動くこと。
- 組み込みプラグインのカバー範囲: Amazon、Bluesky、Wikipedia、branch.io deeplinks
- ESM パッケージであること（本体は `await import('@misskey-dev/summaly')` で読み込んでいる）
- 本体のビルド（`rolldown.config.ts`）は `import { version } from '@misskey-dev/summaly'` を参照している。`version` は chiramiss 自身のバージョンを返す（4.5 を参照）。

### 4.2 外部互換（スタンドアロンサーバ）

- `GET /?url=...&lang=...` が要約の JSON を返す。`url` がなければ 400、要約に失敗したら 500 で `{ error: ... }` を返す。この形は本家と同じにする。
- 本体はプロキシ経由で呼ぶときに `followRedirects`、`userAgent`、`operationTimeout`、`contentLengthLimit`、`contentLengthRequired` もクエリに付けて送ってくる。本家のサーバはこれらを無視している（`url` と `lang` しか読まない）。chiramiss のサーバはこれらのクエリも受け付けて反映する（機能の追加にあたる。設計者の判断）。ただし同じ項目の環境変数が設定されていれば、環境変数を優先する。サーバ管理者が上限を固定できるようにするため。
- 設定は環境変数で渡す。作業 fork の commit `25e3636`（`src/server/config.ts`）の変数名と仕様を引き継ぐ。変数は `SUMMALY_HOST`、`SUMMALY_PORT`、`SUMMALY_LANG`、`SUMMALY_USER_AGENT`、`SUMMALY_FOLLOW_REDIRECTS`、`SUMMALY_RESPONSE_TIMEOUT`、`SUMMALY_OPERATION_TIMEOUT`、`SUMMALY_CONTENT_LENGTH_LIMIT`、`SUMMALY_CONTENT_LENGTH_REQUIRED`。不正な値なら起動時にエラーで終了する。

### 4.3 環境

- Node.js のみ。サポートする最低バージョンは本体に合わせる（tiramiss の `.node-version` は 26.4.0）。
- パッケージマネージャは pnpm（本体と同じ）。monorepo には pnpm workspace を使う。
- TypeScript。
- ライセンスは MIT。本家由来のコードやテストデータには、本家の著作権表示を残す。

### 4.4 公開

- lib: npm 公開レジストリに `@tiramiss-community/chiramiss` として公開する。GitHub Packages は利用者に認証設定を求めるので使わない。
- サーバ: Docker イメージ `ghcr.io/tiramiss-community/chiramiss` として公開する。amd64 と arm64 の両方を作る。npm には出さない。
- バージョン管理とリリースには changesets を使う。
  - 変更を入れる PR に changeset ファイルを添える。
  - `changesets/action` が「Version Packages」PR を自動で作る。それをマージすると、npm への公開と git タグの作成まで行う。
  - lib とサーバは changesets の `fixed` グループで同じバージョンに揃える（設計者の判断）。Docker イメージのタグが lib のバージョンと一致し、利用者が対応関係を追いやすくなるため。サーバは private パッケージだが、`privatePackages` の設定でバージョンとタグは付ける。
  - サーバのタグが作られたら、それを契機に Docker イメージをビルドして ghcr へ公開する。
  - Trusted Publishing と changesets の公開コマンド（内部では pnpm / npm の publish）の組み合わせが動くかどうかは、使う pnpm / npm のバージョンに依存する。計画の初期に確認すること。動かない場合は、公開の手順だけ `npm publish` を直接呼ぶ形に切り替える。
- npm への公開は Trusted Publishing（OIDC、provenance 付き）で行う。トークンは使わない。
- npm の `@tiramiss-community` スコープ（organization）と ghcr の名前空間は、まだ用意されていない。次の手作業を計画に「人がやる手順」として含める。
  1. npm organization を作る
  2. 初回を手動で公開する
  3. Trusted Publisher を登録する
  4. ghcr のパッケージの公開範囲とリポジトリとの紐付けを設定する

### 4.5 バージョンと User-Agent

- バージョン番号は chiramiss 独自に振る。本家の番号は引き継がない。開発中は 0.x とし、本家互換が揃った時点で 1.0.0 にする（0.x / 1.0.0 の線引きは設計者の判断）。
- lib 単体で使ったときの既定 User-Agent は chiramiss 名義にする。形式は `ChiramissBot/<version> (+https://github.com/tiramiss-community/chiramiss#readme)`。
  - `ChiramissBot` という名前にするのは、`bot` を含めるため。User-Agent に `bot` を含むアクセスにだけ OGP 入りの静的 HTML を返すサイトがあるため。
  - `+URL` の先には README を置き、次の内容を書く。何をする bot か、いつアクセスするか（ユーザが投稿した URL のプレビュー時）、どう識別するか、問い合わせ先。
- 本体は User-Agent を自前で組み立てている（`SummalyBot/${version} (${config.url}; +本家 README)`）。差し替えだけだと、`SummalyBot` という名前と chiramiss のバージョン番号が混ざった User-Agent が送られる。これは本体側の課題として README に明記し、chiramiss 側では手当てしない。管理者は本体の `urlPreviewUserAgent` 設定で上書きできる。将来、本体側で User-Agent の組み立てを直すのが望ましい。

## 5. 決まっている設計

### 5.1 リポジトリ構成

pnpm workspace の monorepo に、少なくとも次の 2 パッケージを置く。

- `packages/chiramiss`: lib 本体。npm 名は `@tiramiss-community/chiramiss`
- `packages/server`: スタンドアロンサーバ。名前は例えば `@tiramiss-community/chiramiss-server`。private で、lib に依存する薄い層

lib の実行時依存に fastify を入れない。default export の Fastify プラグインは、fastify を型としてだけ参照する形で残す。

### 5.2 lib の内部構造

責務ごとに分ける。以下は層の分け方の指針で、ファイル名や関数名は任せる。

- **HTTP 取得**: タイムアウト、サイズ上限、content-type の確認、文字コード判定、agent の適用。呼び出しごとの設定はすべて引数で渡し、グローバル状態を持たない。
- **パース**: HTML から必要な情報を抜き出す。汎用経路は `<head>` 内の meta、title、link を中心に、必要な範囲だけ読む。ページ全体の DOM は作らない。本文を読む必要があるプロバイダ（例: Amazon の `#title`、`#landingImage`）は、ページ全体の DOM を要求できるようにする。
- **抽出**: パース結果から `SummalyResult` の各項目を決める（OGP、twitter card、oEmbed、favicon、sensitive 判定、ActivityPub、fediverse:creator）。項目ごとに関数を分ける。
- **プロバイダ（プラグイン）**: サイト固有の処理。`SummalyPlugin` インターフェースを満たす。
- **一本化とキャッシュ**: 5.4 を参照。
- **入口**: `summaly()` は上の層を組み合わせるだけにする。

### 5.3 SSRF 対策

- agent が渡された場合は、本家と同じく遮断を呼び出し側に任せる。
- agent が渡されない場合（スタンドアロンサーバなど）は、lib 自身がプライベート IP 宛てのリクエストを拒否する。これを既定で有効にする。本家は応答を受け取った後で IP を確認しているが、chiramis では**接続前に**拒否する。リダイレクト先も対象にする。
- 本家のテスト用環境変数 `SUMMALY_ALLOW_PRIVATE_IP=true` は互換のため残す。
- 本体の `allowedPrivateNetworks` 設定に相当するものとして、遮断の例外にするネットワークを CIDR のリストで指定できるようにする。サーバでは環境変数（例: `SUMMALY_ALLOWED_PRIVATE_NETWORKS`）で渡す（設計者の判断）。

### 5.4 同時リクエストの一本化と結果キャッシュ

- **一本化**: 同じ要求が取得中なら、新たに取りに行かず、その結果を共有する。「同じ」かどうかの判定キーには、URL と、結果を変えうるオプション（`lang`、`userAgent`、`followRedirects`、各種タイムアウト、サイズ上限、プラグインの構成など）を含める。
- **短時間キャッシュ**: 成功した結果を短時間（目安として数十秒から数分）保持する。失敗した結果も、さらに短く保持して連打を防ぐ。保持時間は設定できるようにする。
- **差し込み口**: キャッシュは小さなインターフェース（有効期限付きの get / set）越しに使う。既定実装はプロセス内メモリ版で、上限件数を持つ。将来 Redis 版を別パッケージとして差し込めるようにしておく。台をまたいだ一本化には「取得中」を示すロックが要るので、その差し込み口も設計段階で用意しておく（実装は既定のプロセス内版だけでよい）。
- **既定値**: 一本化と短時間キャッシュは、lib に組み込んだ場合も既定で有効にする。返す結果の形は変わらないので、外部互換は崩れない。呼び出し側がオプションで無効化や差し替えをできるようにする。
- 判定キーには、渡された agent の同一性も含める（設計者の判断）。agent が違えば、プロキシや遮断の設定も違いうるため。
- キャッシュから返す結果はコピーにする（設計者の判断）。本体は受け取った結果を書き換える（`icon` や `thumbnail` の差し替えなど）ため。
- 本体はプロセスごとに lib を持つ。そのため、本体に組み込んだ場合の一本化はプロセス単位になる。これは許容する。

### 5.5 スタンドアロンサーバ

- 本家互換の `GET /` に加えて、死活確認用のエンドポイント（例: `/healthz`）を別パスで用意する。
- 状態はプロセス内キャッシュだけ。何台並べても動く。
- SIGTERM / SIGINT を受けたら、処理中のリクエストを終えてから停止する。
- ログは標準出力に出す。
- 将来 Redis 版キャッシュを使えるように、環境変数（例: `REDIS_URL`）でキャッシュ実装を切り替えられる構造にしておく。今回は Redis 実装を作らない。
- **外向きプロキシに対応する。** 本体に組み込んだ場合は本体の agent 経由でプロキシが効くが、スタンドアロンでは効かないため。設定は慣例の `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` 環境変数で受け付ける（変数名は設計者の判断）。
  - プロキシを経由する場合も、SSRF 対策（5.3）を効かせること。プロキシ経由では接続先ソケットの相手がプロキシになるので、自分で名前解決して宛先 IP を確認してから、プロキシに要求を送る。
  - lib に agent を渡すと SSRF 対策が呼び出し側任せになる（5.3）。そのため、サーバが自前でプロキシ用の agent を作って lib に渡すと、遮断が効かなくなる。プロキシを使う場合も遮断が効き続ける組み合わせ方にすること。具体的な方式は任せる。

### 5.6 Docker と CI

- マルチステージビルドで、実行イメージには本番依存だけを入れる。
- 非 root ユーザで動かす。
- 待ち受けアドレスは、コンテナでは `0.0.0.0` を既定にする。単体起動時の既定は本家どおり `localhost`。
- amd64 と arm64 の両方をビルドし、ghcr.io に公開する。
- PR ごとに lint、型検査、テスト、Docker イメージのビルド確認を走らせる。
- 配布物として `docker-compose.yml` の例を1つ同梱する。Misskey 側の compose に書き足して使えるよう、サービス定義単体で完結させる。k8s のマニフェストや Helm chart は作らない。k8s 対応は、イメージ側の作り（死活確認、停止時の後始末、状態を持たない、非 root）で担保する。

### 5.7 テスト

- 本家の `test/index.test.ts`、`test/server.test.ts` と、テスト用 HTML（`test/htmls`、`test/oembed`）を互換性チェックの土台として流用する。ただし 3 章のとおり、出力の細部がずれるのは許容する。ずれたテストは「互換の対象外」と明記したうえで直す。
- 一本化、キャッシュ、agent の分離（設定の違う同時呼び出しが干渉しないこと）、接続前の SSRF 遮断には、それぞれ専用のテストを書く。

## 6. 実装者に任せること

- HTTP クライアントの選定。node:http / https を直接使う、undici の Dispatcher を使う、など。条件は 4.1 の agent 互換を満たすこと。
- `<head>` 中心のパースに使うライブラリ（htmlparser2 のストリーミング、など）と、ページ全体の DOM を作る場合の実装（cheerio を残す、など）。
- キャッシュとロックのインターフェースの具体的な形、既定の保持時間、上限件数。
- ファイル構成と命名。
- lint とフォーマッタの選定（本家は oxlint）、ビルドツールの選定（本家は tsdown）。
- リリースのバージョン付けの方式。
