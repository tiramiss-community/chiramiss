---
"@tiramiss-community/chiramiss": minor
"@tiramiss-community/chiramiss-server": minor
---

npm のパッケージページ（`https://www.npmjs.com/package/...`）を npm registry から要約する組み込みのプロバイダを追加する

- npmjs.com はボットにページの代わりに Cloudflare のチャレンジを返すため、`registry.npmjs.org` からパッケージの情報を取る
- title はパッケージ名（URL がバージョンを指定していれば `名前@バージョン`）、description はパッケージの説明文
- 組み込みはカスタムプラグインより先に試すので、`npmjs.com`（`npmjs.org`）向けのカスタムプラグインにはこれらの URL が渡らなくなる
