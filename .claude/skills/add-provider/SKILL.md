---
name: add-provider
description: chiramiss（packages/chiramiss）に、特定サイト向けの組み込みプロバイダを追加する手順。対象ページの調査、プロバイダの形の選び方、ctx を通したリクエスト、test() の判定、登録、テスト、README・changeset までを扱う。「〇〇のリンクがうまく要約されない」「△△ 用のプロバイダを足したい」「このサイトはプレビューが NVD - Home みたいになる」など、特定のサイトやドメインの要約を直したい・専用に対応したいときは、プロバイダという語が出なくても必ずこの skill を使うこと。
---

# 組み込みプロバイダを追加する

chiramiss は URL を受け取ってページの要約（title / description / thumbnail など）を返す。ほとんどのサイトは汎用の抽出（og / twitter の meta、oEmbed、favicon）で足りる。汎用の抽出ではまともな要約にならないサイトだけ、`packages/chiramiss/src/providers/` に専用のプロバイダを足す。

プロバイダは `Provider` 型（`src/providers/provider.ts`）で、`name`、`test(url)`、`summarize(ctx, url)` の 3 つを持つ。`src/index.ts` の `summarizeUncached` が、リダイレクトを追った後の URL で組み込み → カスタムプラグインの順に `test()` を試し、最初に一致したものの `summarize()` を使う。どれにも一致しなければ汎用の抽出になる。

## 1. 対象ページを調べる

コードを書く前に、実際の応答を見る。ここで分かることで、プロバイダの形が決まる。

- **HTML に何があるか**: `curl -sS -L -A "Mozilla/5.0 (compatible; ChiramissBot)" <URL>` を scratchpad に保存し、`<meta>` と `<title>` を見る。
  og / twitter の meta があるなら、汎用の抽出で足りないのはなぜかを先に確かめる（取得の仕方が違うだけかもしれない）。
- **SPA かどうか**: `<app-root>` や `<div id="root">` しかなく、meta もない場合、HTML からは何も取れない。サイトの公開 API を探す。
- **API の癖**: ID の大文字・小文字の扱い、存在しないときの応答（200 で空なのか 404 なのか）、形式が不正なときの応答、レート制限、キーの要否。
  例として NVD は、`cveId` が小文字だと 404（`message: Invalid cveId parameter.`）、存在しない ID だと 200 で `totalResults: 0` を返し、キーなしでは IP ごとに 30 秒あたり 5 リクエストまでしか受け付けない。
- **リダイレクト**: ページの URL を `curl -I` で叩く。`test()` が受け取るのはリダイレクト後の URL なので、正規の形（大文字・小文字、末尾の `/`、旧形式の URL）を知っておく。
- **favicon**: 固定の URL を返すなら、UA 付きで 200 になるか確かめる（UA なしだと 403 を返すサイトもある）。

## 2. 形を選ぶ

既存のプロバイダは 3 つの形に分かれる。一番近いものを読んでから書く。

| 状況 | 手本 | 使うもの |
|:--|:--|:--|
| 汎用の抽出で足りるが、取り方だけが違う | `bluesky.ts`（HEAD をやめて GET だけ）、`branchio-deeplinks.ts`（URL を書き換える） | `fetchPage` + `summarizePage`、`scrapeGeneral` |
| HTML の特定の要素を読む | `amazon.ts` | `fetchPage` + `loadDom`（cheerio） |
| サイトの API から組み立てる | `wikipedia.ts`、`nvd.ts` | `fetchSubresource` + `clip` |

本家（misskey-dev/summaly）由来のプロバイダには、ファイル先頭に `// Derived from misskey-dev/summaly (MIT)` が付いている。新しく書くものには付けない。

## 3. リクエストは必ず ctx を通す

リクエストには `fetchSubresource` / `fetchWithContext`（`src/context.ts`）か `fetchPage`（`src/extract/general.ts`）だけを使う。
`fetch` や `got` を直接使うと、プライベート IP の遮断（リダイレクト先も含む）、呼び出し側の agent やプロキシ、User-Agent、タイムアウト、サイズ上限がすべて効かなくなる。chiramiss がこれらを保証している前提が崩れるので、迂回しない。

`fetchPage` と `scrapeGeneral` は、呼び出し側の `followRedirects` と `contentLengthRequired` に従う。また `fetchPage` は HTML 以外の応答を拒否するので、JSON の API には使えない。
`fetchSubresource` は常にリダイレクトを追い、content-length を求めない（API や favicon 向け）。
本家の挙動に合わせるために `amazon.ts` はこの 2 つを上書きしている。どちらにするかは意図して選び、上書きするならコメントで理由を書く。

## 4. `test()` を書く

- `test()` に渡るのは、リダイレクトを追った後の URL。ただし `followRedirects: false` のとき（HEAD を送らない）と HEAD が失敗したときは、投稿された元の URL がそのまま渡る。
  正規の形だけでなく、リダイレクト前の形（大文字・小文字の違い、末尾の `/` など）にも一致させる。
- 判定は狭くする。広すぎると、関係ないページまでこのプロバイダに取られる。
  - hostname は完全一致（`url.hostname === 'example.com'`）か `Set` で引く。サブドメインを許すときは `endsWith('.example.com')` のように `.` から含める。`endsWith('example.com')` だと `evilexample.com` も一致してしまう
  - 一部のページだけを扱うなら pathname も見る。`URL` が hostname を小文字にするので、大文字・小文字の区別が要るのはパスだけ
- パスから ID を取り出すなら、正規表現をモジュール直下に 1 つ置き、`test()` と `summarize()` で共有する。
  `summarize()` 側の `exec()` は型の上では `null` を返しうるので、一致しなければ例外を投げる。

## 5. 失敗をどう返すか

- `summarize()` が `null` を返すと、`summarize` 全体が `'failed summarize'` で失敗する。例外を投げても失敗する。
  原因が分かる例外（`'CVE not found'` など）のほうが調べやすい。
- 失敗は `errorCacheTtl`（既定 30 秒）、成功は `cacheTtl`（既定 5 分）のあいだキャッシュされる。レート制限の厳しい API でも、短い時間に同じ URL を何度も取りには行かない。
- 汎用の抽出へ戻すかどうかは、戻して意味のある要約が取れるかで決める。SPA なら戻しても「NVD - Home」のような役に立たない結果になるので、失敗のままにする。

## 6. 型と lint

`pnpm lint` は `oxlint --deny-warnings` で、型を見る `typescript/no-unnecessary-condition` の警告も失敗になる。`noUncheckedIndexedAccess` は無効なので、`arr[0]` は型の上では必ず存在する扱いになる。

- API レスポンスの型は使う部分だけを定義し、**フィールドはすべて optional** にする（`nvd.ts` の `CveResponse`）。外部の応答は信用しない。
  `wikipedia.ts` は本家由来で内側のフィールドが必須のままなので、この点は真似しない。
- 配列の先頭を取るときは、`arr[0]?.x` と書かずに `arr.length > 0` を確かめてから添字で取る。
- `if` などは 1 行で書かず、必ず `{}` のブロックにする（`curly: all`）。処理の区切りごとに空行を入れる。インデントはタブ。

書いている途中で一度 `pnpm lint` を流すと、後でまとめて直さずに済む。

## 7. 登録する

`src/providers/index.ts` の `builtinProviders` の **末尾** に足す。本家と同じ 4 つ（amazon、bluesky、wikipedia、branchio-deeplinks）の順は変えない。
組み込みはカスタムプラグインより先に試されるので、同じホスト向けのカスタムプラグインを使っている人がいると、その URL はプラグインに渡らなくなる。これは利用者から見える変更なので、README と changeset に書く。

## 8. テストを書く

テスト名は日本語。HTTP は実際のサイトへ出さず、ループバックのテストサーバーで受ける。

`packages/chiramiss/test/providers.test.ts`:
- **`test()` の表**: 一致する URL と一致しない URL を並べる。既存の表は `https://${host}/path` 固定なので、パスも見るプロバイダは URL 全体を渡す `test.each` を別に作る。
  一致しない側には、紛らわしいもの（似たホスト、`www.` 付き、別ホストの後ろに付けたもの、近いパス）を入れる。
- **並び順のテスト**: `builtinProviders` の期待値に新しいプロバイダを足し、テスト名も実態に合わせる。
- **`summarize()`**: ファイル内の `loopback()` と `send()` を使う。`loopback()` はどのホストへのリクエストも 1 台のテストサーバーに送り、受けたリクエストを `received` に記録する。
  - リクエスト: method、host、パスとクエリ、`user-agent` が `ctx.options.userAgent` であることを確かめる
  - 戻り値: Summary 全体を `toEqual` で比べる
  - 分岐: フォールバックの順、値がないとき、文字数の上限で切るとき
  - 失敗: 該当なしで例外になること。API がエラー（403 など）を返したら `StatusError` で失敗すること

`packages/chiramiss/test/summaly.test.ts`: `loopbackAgents` を使い、`summarize()` から通しで 1 件。
リダイレクトを含めて、そのプロバイダが実際に選ばれること（受けたリクエストの並びと、結果の `url`）を確かめる。NVD の例がそのまま手本になる。

## 9. ドキュメントと changeset

- `README.md`（英語）
  - **Differences from upstream** に、そのプロバイダの箇条を足す。書くこと: 対象の URL の形、データの取り方（API ならその名前）、制限や失敗する条件、同じホスト向けのカスタムプラグインに URL が渡らなくなること
  - Compatibility の「Built-in plugins cover …」から、その箇条へ案内する
  - API を使うなら、「About ChiramissBot」のアクセス先の説明と食い違わないか確かめる
- `.changeset/<名前>.md`: `@tiramiss-community/chiramiss` と `@tiramiss-community/chiramiss-server` の両方を `minor` にする。本文は日本語（既存の changeset を見て形を合わせる）
- コミットは日本語の conventional commits（例 `feat: NVD の CVE ページを NVD API から要約するプロバイダを追加`）

## 10. 確認する

1. リポジトリのルートで `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm --filter @tiramiss-community/chiramiss typecheck:compat`（CI と同じ）
2. 実際のサイトで 1 回: ビルドの後、`packages/chiramiss` で
   `node -e "import('@tiramiss-community/chiramiss').then(m => m.summarize('<URL>')).then(r => console.log(JSON.stringify(r, null, 1)))"`
   を実行し、title / description / url が想定どおりかを見る。リダイレクトする形（大文字・小文字の違いなど）の URL でも試す
