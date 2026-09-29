# Automatic Surface Partition

- Status: Complete（Structured Frame / Text の自動分割）
- Scope: Structured baked-web の Frame / Text
- Contract: [ADR-0011](../decisions/0011-surface-partition-contract.md)

## 目的

Compiler が描画順と合成上の境界から Render Surface を決定し、作者が分割を指定しなくても元の見た目と操作を保つ。既存の単一 partition 出力を、State 間で安定した複数 partition の生成・描画・検証へ接続する。

## 範囲

- canonical child order による paint atom 化、Frame の clip（枠幅・角丸を含む）/ opacity の compositing closure、連続する最大 run の分割。
- 全 State からの固定 bounds、連続 layer、canonical descriptor からの RenderSurfaceId 導出。
- paint を所有する Node と描画文脈だけを提供する ancestor Frame の分離。
- partition ごとの capture / empty binding、texture budget preflight、Hit Region の Surface 単位の独立した解決（[ADR-0019](../decisions/0019-surface-interaction-geometry.md)）。
- portable provenance の `partitionStrategyVersion: 1` と、単体・実 Browser での検証。

作者向け Part isolate / permission、Opaque execution、新 Primitive、Native UI / Video、cache、Delivery は対象外。ADR-0011 の isolate は後続設計として残す。Node 数や画像サイズによる heuristic split は追加しない。

## 実装順と完了条件

1. Contracts / Core: strategy version を検証し、全 State を覆う capture / empty binding を受理する。不明 State、未参照 artifact、layer の欠落・重複を拒否する。
2. Compiler: 描画計画を純粋な処理として分離する。ownership の重複・欠落を防ぎ、renderer 呼び出し前に全 partition の予算を検証する。一つでも失敗した build は成果物を返さない。
3. Renderer: context Frame 自身を再描画せず、ancestor の座標・clip・opacity を保持する。未描画部分を透明にし、暗黙の黒背景を廃止する。Hit Region は Compiler が Surface 全体で解決する。
4. 検証: 通常の一 partition、複数 partition、State の可視性変化、決定的 ID、重なり順、クリック位置、失敗時の原子性を対象テストで確認する。実 Browser で clip / group opacity を含む未分割 capture と分割後の合成結果を比較し、再 build の再現性も確認する。
5. 各 package の Current / Deferred を更新し、独立レビューの指摘を解消する。

作業中は対象 package のテスト・lint・型チェックを実行する。包括的な repository gate は、明示的なコミット依頼時に実行する。

## 検証記録

- Contracts v2 の生成・drift check・構造テスト、Core / Compiler / Renderer API / Renderer Web の対象テスト・型チェック・lint が成功した。
- 実 Chromium の 4 テストで、非ゼロ原点の crop、透明部分、clip / group opacity、未分割 capture と分割合成の比較を確認した。8-bit RGBA の合成丸め差は各 channel 2 以下とする。
- CLI の参照テスト 19 件が成功した。実 Browser を使う参照プレゼンは 3 partition となり、2 回の build が生成する全 9 ファイルの SHA-256 が一致した。
- 独立レビューで指摘された透明 button の操作範囲と角丸 clip の identity を修正し、再レビューで未解消の指摘がないことを確認した。

これは Structured Frame / Text の自動 partition の完了範囲であり、M4 全体の完了ではない。Part isolate、Opaque execution、異なる renderer 間の分割、cache は後続に残る。
