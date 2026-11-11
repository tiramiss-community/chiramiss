---
"@tiramiss-community/chiramiss": patch
"@tiramiss-community/chiramiss-server": patch
---

oEmbed の iframe の `allow` 属性に長い空白の並びがあると、分割に時間がかかってイベントループを長く止めていたのを直す
