---
"@tiramiss-community/chiramiss": minor
"@tiramiss-community/chiramiss-server": minor
---

サーバと Fastify プラグインの応答に `Cache-Control` を付け、前段のリバースプロキシや CDN でキャッシュできるようにする（要約は `cacheTtl`、要約の失敗は `errorCacheTtl` を秒にした `max-age`。1 秒未満や `url` 抜けの 400、サーバの `/healthz` は `no-store`）。同じ値を返す `summaryCacheControl` を公開する
