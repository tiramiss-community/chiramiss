---
"@tiramiss-community/chiramiss": minor
"@tiramiss-community/chiramiss-server": minor
---

favicon の確認結果も要約と同じキャッシュに短時間保存し、同じサイトへの HEAD を減らす

- favicon の確認結果も `MemorySummaryCache` の件数に数えるため、既定の `maxEntries` を 1000 から 2000 に増やした（要約を保持できる件数は変更前と同じ。`maxBytes` の既定 64 MiB は変えない）
- `InflightCoordinator` の `run` は、要約の task の中から別の key で入れ子に呼ばれる。key をまたいで待たせる実装（全体の直列化、同時実行数の制限など）は止まるので、待たせるのは同じ key どうしだけにする
- `SummaryCache` の `set` が失敗しても要約は失敗せず、結果を保存しないまま返す
