---
"@tiramiss-community/chiramiss": patch
"@tiramiss-community/chiramiss-server": patch
---

proxy を通さずホスト名へ直接つなぐ要求では、送る前の名前解決（プライベート IP の事前確認）を省き、接続を開くときの確認に任せる。接続を使い回す要求では DNS への問い合わせがなくなる。IP アドレスを直接書いた宛先と proxy を通す要求は、これまでどおり送る前に確認する
