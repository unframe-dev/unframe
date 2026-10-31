`UnframeFixtureCJK-Regular.otf` is a 5 KB subset of Noto Sans CJK VF 2.004
(`NotoSansCJK-VF.otf.ttc`, SHA-256
`d3d8256cdec8dbcb3552284bc6b20c734dd60c2ee9df83b5758e34807c4bac32`).
It contains only `日本語 Hello Bold` for the Browser capture tests. The original
font's copyright notice remains in its `name` table. The primary family and
PostScript names were changed to `Unframe Fixture CJK` and
`UnframeFixtureCJK-Regular`, respectively, for the modified font. Its license
is in `UnframeFixtureCJK-OFL.txt`.

To recreate it, use FontTools 4.61.1 to subset font number 0 of the Noto Sans
CJK VF 2.004 TTC with `--text='日本語 Hello Bold'`, then replace name IDs
1/4/16 with `Unframe Fixture CJK`, ID 6 with
`UnframeFixtureCJK-Regular`, and IDs 2/17 with `Regular`. The output SHA-256
is `e3738bfc95cb74b928df0f699f28f2843b17eb6bd431f5a81d5017441994b0a8`.
