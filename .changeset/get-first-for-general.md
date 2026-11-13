---
"@tiramiss-community/chiramiss": patch
"@tiramiss-community/chiramiss-server": patch
---

プロバイダに当たらない URL では、最終 URL を求める HEAD を送らず、GET でリダイレクトをたどった応答をそのまま要約する。要約 1 件あたり相手サイトへの要求が 1 回減る。リダイレクト先がプロバイダに当たれば、ページを読むプロバイダ（Amazon、Bluesky）にはその応答を渡し、それ以外のプロバイダには本文を読まずに最終 URL を渡す（応答が 2xx でなくても渡す）。投稿された URL がプロバイダに当たるときは、これまでどおり HEAD で最終 URL を求める
