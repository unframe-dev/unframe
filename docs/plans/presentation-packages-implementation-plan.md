# Milestone 6: 未完了事項

M6 は未完了。残る実装・検証事項を以下に限定して記録する。

## Quest 実機での受け入れ検証

端末用 Scene と Pose / 入力 adapter は実装済みだが、Quest 実機での接続と計測は未検証である。Unity Editor での検証結果は実機検証を代替しない。

- Delivery と Asset 取得を確認する。
- 入力と texture residency を確認する。
- GPU / CPU 使用量と upload peak を計測する。

実機・実行環境・対象成果物・検証結果を記録し、残る不具合や未検証事項を明示する。

## pauseTimeout の仕様と実装

期間と自動終了 policy が未定義のため、`pauseTimeout` は未実装である。仕様を確定してから実装し、定めた期限と終了動作をテストで検証する。
