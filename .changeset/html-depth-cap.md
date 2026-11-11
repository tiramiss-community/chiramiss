---
"@tiramiss-community/chiramiss": patch
"@tiramiss-community/chiramiss-server": patch
---

入れ子の深い HTML の解析に入力の長さの 2 乗の時間がかかり、イベントループを長く止めていたのを直す

- ページの head を読むとき、入れ子が 128 段を超えた時点で読むのをやめ、それまでに読めた title・meta・link を返す
- oEmbed の html は、入れ子が 2 段を超えたら残りを読まずに不採用にする（iframe の後ろに 3 段以上入れ子になったマークアップが付いたものは、これまで採用されていた）
