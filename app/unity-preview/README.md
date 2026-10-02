# Unity preview renderer

`app/unity` の MR アプリとは独立した Unity 6000.3.22f1 プロジェクトです。
Web 側が framework の dist を検証し、既存 `unframe-core` で Cue・Timeline を評価します。
Unity は PNG Surface・座標変換・クロスフェード・カメラを担当します。

ビルドと Web 画面の起動は [scripts/README.md](../../scripts/README.md#unity-web-プレビュー) を参照してください。
EditMode テストは、Unity Hub から `app/unity-preview/` を開き、Editor の Test Runner
で EditMode を選んで実行してください。NixOS でも既存の Unity Hub の FHS 環境を使います。

WebGL は Web host と同じ origin から配信します。host は `PreviewBridge` の
`LoadScene`・`ApplyFrame`・`SetView`・`ClearScene` を呼び出します。
`ready` は Unity の初期化完了、`loaded` は PNG の読み込み完了を表します。
`loaded` / `error` と各フレームの `generation` で、読み込み直し前の通知を除外します。
