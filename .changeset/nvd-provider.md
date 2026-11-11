---
"@tiramiss-community/chiramiss": minor
"@tiramiss-community/chiramiss-server": minor
---

NVD の CVE ページ（`https://nvd.nist.gov/vuln/detail/CVE-...`）を NVD API 2.0 から要約する組み込みのプロバイダを追加する

- title は CVE ID と CVSS の深刻度・スコア（例 `CVE-2026-16478 (HIGH 7.0)`）、description は CVE の英語の説明文
- 組み込みはカスタムプラグインより先に試すので、`nvd.nist.gov` 向けのカスタムプラグインにはこれらの URL が渡らなくなる
