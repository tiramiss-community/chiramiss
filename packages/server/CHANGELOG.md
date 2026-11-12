# @tiramiss-community/chiramiss-server

## 0.2.0

### Minor Changes

- 4052dd8: サーバと Fastify プラグインの応答に `Cache-Control` を付け、前段のリバースプロキシや CDN でキャッシュできるようにする（要約は `cacheTtl`、要約の失敗は `errorCacheTtl` を秒にした `max-age`。1 秒未満や `url` 抜けの 400、サーバの `/healthz` は `no-store`）。同じ値を返す `summaryCacheControl` を公開する

### Patch Changes

- Updated dependencies [4052dd8]
  - @tiramiss-community/chiramiss@0.2.0

## 0.1.1

### Patch Changes

- 50458c5: リダイレクトを追うとき、応答の接続を捨てずに次の要求で使い回す（本文がないか短い場合）
- Updated dependencies [50458c5]
  - @tiramiss-community/chiramiss@0.1.1

## 0.1.0

### Minor Changes

- adefb53: chiramiss 独自の名前を正式名にし、summaly の名前は互換用の別名として残す
- 6fcd677: favicon の確認結果も要約と同じキャッシュに短時間保存し、同じサイトへの HEAD を減らす
  
  - favicon の確認結果も `MemorySummaryCache` の件数に数えるため、既定の `maxEntries` を 1000 から 2000 に増やした（要約を保持できる件数は変更前と同じ。`maxBytes` の既定 64 MiB は変えない）
  - `InflightCoordinator` の `run` は、要約の task の中から別の key で入れ子に呼ばれる。key をまたいで待たせる実装（全体の直列化、同時実行数の制限など）は止まるので、待たせるのは同じ key どうしだけにする
  - `SummaryCache` の `set` が失敗しても要約は失敗せず、結果を保存しないまま返す
- c280660: summaly 互換の初回リリース
- 7de4b0b: npm のパッケージページ（`https://www.npmjs.com/package/...`）を npm registry から要約する組み込みのプロバイダを追加する
  
  - npmjs.com はボットにページの代わりに Cloudflare のチャレンジを返すため、`registry.npmjs.org` からパッケージの情報を取る
  - title はパッケージ名（URL がバージョンを指定していれば `名前@バージョン`）、description はパッケージの説明文
  - 組み込みはカスタムプラグインより先に試すので、`npmjs.com`（`npmjs.org`）向けのカスタムプラグインにはこれらの URL が渡らなくなる
- 3fd5c99: NVD の CVE ページ（`https://nvd.nist.gov/vuln/detail/CVE-...`）を NVD API 2.0 から要約する組み込みのプロバイダを追加する
  
  - title は CVE ID と CVSS の深刻度・スコア（例 `CVE-2026-16478 (HIGH 7.0)`）、description は CVE の英語の説明文
  - 組み込みはカスタムプラグインより先に試すので、`nvd.nist.gov` 向けのカスタムプラグインにはこれらの URL が渡らなくなる

### Patch Changes

- e75a5b8: 同じ summarizer の同じ設定の要約同士で、サイトへの接続を短時間使い回す
- bf54262: 入れ子の深い HTML の解析に入力の長さの 2 乗の時間がかかり、イベントループを長く止めていたのを直す
  
  - ページの head を読むとき、入れ子が 128 段を超えた時点で読むのをやめ、それまでに読めた title・meta・link を返す
  - oEmbed の html は、入れ子が 2 段を超えたら残りを読まずに不採用にする（iframe の後ろに 3 段以上入れ子になったマークアップが付いたものは、これまで採用されていた）
- 9bb8557: 1回の要約内で同じサイトへの接続を再利用し、HTML 解析と本文読み取りの無駄を減らして高速化
- effc470: oEmbed の iframe の `allow` 属性に長い空白の並びがあると、分割に時間がかかってイベントループを長く止めていたのを直す
- Updated dependencies [adefb53]
- Updated dependencies [e75a5b8]
- Updated dependencies [bf54262]
- Updated dependencies [6fcd677]
- Updated dependencies [c280660]
- Updated dependencies [9bb8557]
- Updated dependencies [7de4b0b]
- Updated dependencies [3fd5c99]
- Updated dependencies [effc470]
  - @tiramiss-community/chiramiss@0.1.0
