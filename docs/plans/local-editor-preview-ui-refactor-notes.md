# Local Editor Preview 再設計の実装記録

2026-10-22。対象は [採用計画](local-editor-preview-ui-refactor.md)。本書は検証結果と保留事項を記録する。実装契約は [Local Editor Design](../packages/LOCAL_EDITOR_DESIGN.md)、操作仕様は [Cue 時間軸仕様](../packages/LOCAL_EDITOR_TIMELINE_SPEC.md) を参照。

## 実装済み

- React 外の workspace／project／preview／playback／publication controller と workspace 単位の Zustand store。Props draft、保存・再試行・Undo／Redo、外部更新、Dev 自動 build、固定 Dist の表示・認証・公開。
- Core の opt-in accepted Cue capture、Host の最新 occurrence、Cue 確認・前後シーク・確認再生・通常位置への一時停止復帰。Group／Step entry、request、確認 ID を照合し、reset／load で失効。
- Unity の入力拒否・部分適用・後続更新故障の区別、故障後の更新停止、完全 state の新 sequence による復元。Host は Unity 成功後に正常表示を確定し、初期適用未確認・復旧中・復元失敗の公開を拒否。
- Base UI／Tailwind 4／Phosphor／分割パネルによる3列 workspace。ライト／ダーク、左右開閉、横・縦サイズ調整と保存、Cue 詳細、時間軸・キー選択・シーク、Props、公開前確認、問題・表示情報。
- entry を `src/app/main.tsx` に変更。旧 `src/features/editor/`、UI／component test、E2E・専用設定・依存・CI／Nix 実行経路を撤去。Node テストを各層 `tests/` に配置。

## 検証

- `nix run .#local-editor`: 型検査、Node ロジックテスト12ファイル・92件、build 成功。
- Local Editor の変更した TypeScript／TSX と Vite／Vitest 設定の `vp check`: format／lint 成功。
- Core の関連5ファイル・46件、CLI の `local-playback`／`local-preview`／`author-http` 3ファイル・45件が成功。Core／CLI の `typecheck` も成功。
- `nix develop --command bash scripts/unity/test-native-editor.sh playback`: EditMode 13件成功。既存10件と追加3件で、故障後の更新停止・新 sequence の完全 state 復元・永続故障・通知 identity を確認。
- `nix run .#unity-preview`: 最新の prepared identity／Restore 通知を含む WebGL player の再生成成功。
- `nix flake check`: 成功。変更差分の `git diff --check` は成功、staged diff はなし。
- Core／CLI・Unity と画面側の独立コードレビュー、および文書レビューを実施。初期適用未確認の公開、再発火中の確認開始、保存後の新入力消失、逆順取得、別 Cue へのキー連動を修正・回帰確認。

リポジトリ全体のテスト・build は依頼範囲に従い実行していない。Local Editor build は成功したが、単一 JS chunk 約1.61 MB（gzip 約272 KB）のサイズ警告が残る。

## 保留・未確認

- Dist envelope は Source revision を持たない。一致を推測せず Dist の Cue 確認を無効化した。Dist の通常再生・固定成果物の公開条件は維持する。
- VODAI の参照ファイルの所在は本リポジトリから確定できないため、実装案に記載された色・寸法を採用した。外部リポジトリのコピーや依存は追加していない。
- 実画面の手動確認用に、showcase のコピーと最新 UI／WebGL を使う一時 Host を起動した。`cua.createBrowserTab` が可視・背景の両方で `Timed out waiting for the Browser webview to attach` となり、画面確認を実施できなかった。Host は終了済み。固定 Browser／CSP、キーボード・パネル操作、実 WebGL の縦断画面確認は未確認のまま保留する。Node／EditMode／player build の成功を画面・実描画の検証結果とは扱わない。
- Quest 実機と WebGL の本番 Realtime 接続は本変更の検証対象外。
- Proto wire は変更していないため、生成・drift check は今回の変更検証では実行しない。
