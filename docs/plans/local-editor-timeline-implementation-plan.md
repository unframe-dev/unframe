# Local Editor Timeline の実装計画

[読み取り専用 Timeline 仕様](../packages/LOCAL_EDITOR_TIMELINE_SPEC.md) を実装範囲とする。既存の単独 Timeline 一覧を、Group → Step → Cue → 関連 Timeline の閲覧に置き換える。Source 編集、再生、シーク、Runtime 状態の追跡は対象外。

実施状況: 以下の実装と独立レビューを完了。Editor の関連54テスト、showcase 閲覧と既存保存経路のブラウザーテスト2件、Web 型チェック、対象 lint／format、Editor build が成功。

## 境界と実装順

各項目を、対象の公開境界で失敗するテストの確認 → 実装 → 整理の順で進める。

1. **表示モデル**: 検証済み `definition.flow` を純粋に変換する。Cue の候補選択順、Step の到達可能性、stay／終了／Group の初期 Step への遷移、開始する Timeline の参照をテストする。
2. **進行構造の閲覧**: Group 選択、Step 遷移図、Cue 選択と詳細を実装する。timer と完了依存の時間基準、guard、actions の transition／completion を確認し、Step の長さや実行時の条件成立を推測しない。
3. **アニメーションの閲覧**: 選択 Cue の複数 Timeline を、Cue 発火を原点とする共通時間軸へ配置する。ズーム、横スクロール、キーフレームの選択・値・easing、blocking／nonBlocking の意味をテストする。
4. **更新と統合**: 保存 revision を渡し、同じ ID の選択維持、削除時の解除、検証失敗と Diagnostics、正常な空状態を確認する。UI 状態は純粋変換と分離する。
5. **受け入れ検証**: 実際の showcase を既存 Host で検証した定義をブラウザーへ渡す。5 Step の循環、各2 Cue、状態切り替えと focus の区別、opacity 0.72 → 1、0 → 600 ms、cubicOut、キーボード操作を確認する。分岐・Group 遷移・timer・guard・blocking・複数トラックは追加 fixture で確認する。

## 検証範囲

- 純粋モデルとコンポーネントの対象テスト、Web 型チェック、変更ファイルの lint／format、Editor build を実行する。
- ブラウザーテストは HTTP 境界で定義を渡し、閲覧操作による保存・build・Preview 操作の追加がないことを確認する。Unity 実機再生の検証とは区別する。
- ドキュメントと実装を独立レビューし、仕様との不一致を解消する。
- リポジトリ全体の `nix run .#check` は、コミットの指示を受けた時にまとめて実行する。
