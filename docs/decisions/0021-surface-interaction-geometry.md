# ADR-0021: Hit Region を描画 partition から独立させる

- **Status**: Accepted
- **Date**: 2026-09-29
- **Related**: [ADR-0009](./0009-semantic-tree-hit-region-contract.md)、[ADR-0010](./0010-spatial-surface-coordinate-contract.md)、[ADR-0011](./0011-surface-partition-contract.md)

## Context

透明な Frame も button の意味と矩形の操作範囲を持てる。paint atom のない Frame を画像の所有集合から除外したり、画像を描画内容の bounds へ crop したりすると、partition-local な Hit Region では従来の操作範囲を保持できない。

また、Renderer が内容とは別に敷いていた黒背景は Compiler の paint / bounds 計画に含まれず、分割後の合成結果を変えてしまう。

## Decision

Structured baked-web の absolute Frame / Text では、Compiler が各 State の layout から Hit Region を Surface 単位で一度だけ解決する。画像の partition 数、paint ownership、texture bounds は操作範囲に影響させない。

- 明示的な `semanticNodeId` と完成 Semantic Tree の enabled button を対応させる。背景・枠線・文字を描かない Frame も対象とする。
- effective placement、Node と ancestor の visibility / opacity、ancestor の矩形 clip、`surfaceVisibleWindow` を用いて矩形を求める。幅または高さが 0 になった region は出力しない。
- Surface 全体の logical size で正規化する。pixel rounding、partition 境界での分割、texture bounds での再 clip を行わない。
- `hitPriority`、重複拒否、canonical order、enabled Interaction の completeness は ADR-0009 を維持する。Core は出力を補正せず検証する。
- Renderer API は partition の描画・capture・provenance を扱い、Hit Region を返さない。画像だけが不要な Surface は Render Surface を 0 件とし、意味情報と操作領域は保持できる。
- 背景色は Authoring の Frame を正本とする。Renderer の `documentBackground` 設定を廃止し、未描画部分は透明とする。

この決定は ADR-0009〜0011 の partition-local Hit Region 生成・集約の境界を置き換える。paint atom の分割、derived ID、layer、texture budget の規則は維持する。Opaque / Native UI / Video の geometry 解決を実装済みとはしない。これらは導入時に Surface 単位の geometry 契約へ接続する。

## Consequences

- 画像が小さく分割されても透明ボタンの操作範囲を保てる。描画不要の操作領域に透明 texture を生成する必要がなくなる。
- Compiler の layout と Renderer の CSS の一致を検証する必要がある。新しい layout / clip の導入時は双方の契約と fixture を更新する。
- 未指定背景を黒色にする旧設定は受理しない。黒背景が必要な表示面は Frame に指定する。
- 透明 Frame を paint atom に数える案は描画と操作の所有を混同するため採用しない。各 partition で context Frame の region を返す案も、重複と切り取りによる操作範囲の変化を避けられないため採用しない。

## Adoption and Exceptions

Compiler / Renderer API / Renderer / CLI と関連ドキュメントを同じ変更系列で更新し、旧 private region の互換経路を追加しない。透明 Frame の子 Text 有無、狭い描画と広い操作領域、複数 partition、State の可視性、opacity、clip を対象テストで検証する。実 Browser では分割前後の合成結果を比較する。

この境界を変える例外は別の ADR で採用し、対象 consumer の conformance fixture を追加する。操作主体の権限や Runtime の入力受理規則は変更しない。
