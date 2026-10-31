# Unframe Local Editor

`app/web/local-editor` / `@unframe/local-editor` はローカル専用の Source Inspector、保存・履歴、Dev／Dist build、Unity Preview、Cue 時間軸の閲覧・確認と CLI を通す公開 UI です。`index.html` を `dist/` に build し、CLI Host が静的 UI と Unity player、token 認証付き HTTP API を配信します。ローカル HTTP 型と filesystem は CLI が所有します。認証・Dist の持ち込み公開・公開済みプレゼンテーションの確認・ルーム作成は [Console](../console/README.md) が担当します。

UI フォントは [LINE Seed JP](https://seed.line.me/index_jp.html) の Regular / Bold を同梱しています。[SIL Open Font License](public/fonts/line-seed-jp/OFL.txt) に基づいて利用・再配布します。

## Local Editor の起動

対象 host は Linux x86_64 と macOS arm64 です。native 隔離の保証差と実機検証結果は [ADR-0026](../../../docs/decisions/0026-native-linux-macos-host-adapters.md) を参照してください。project 指定、固定 Browser の provision、利用可能な Unity Editor の WebGL module と license が必要です。`UNITY_EDITOR` は `ProjectVersion.txt` に対応する実行ファイルを指定できます。未指定時は OS ごとの Unity Hub 標準配置を探します。

初回にリポジトリ root で依存関係、固定 Browser、Unity Preview player を準備します。

```bash
nix run .#setup
nix develop --command scripts/dev/install-presentation-browser.sh
nix run .#unity-preview
```

開発時は2つのターミナルでそれぞれ `nix develop` に入り、リポジトリ root から次を実行します。

```bash
# ターミナル1: Editor UI (http://127.0.0.1:5174/)
pnpm --filter @unframe/local-editor dev
```

```bash
# ターミナル2: ローカル API / Unity player (http://127.0.0.1:5175)
pnpm --filter @unframe/core dev -- "$PWD/examples/local-editor-showcase"
```

CLI が認証付きの Editor URL をブラウザで開きます。Local Editor は HMR で画面の変更を反映し、API と Unity player の要求を CLI に proxy します。CLI の `dev` が固定 Browser のパス設定と OS 別の起動準備を行うため、wrapper の手動指定や事前の UI build は不要です。ページ全体を再読み込みした場合は、CLI のターミナルで `r` + Enter を入力して認証付き Editor を開き直します。停止は各ターミナルで `Ctrl+C` です。

Dev Preview の表示、Source 保存後の反映、「本番 build」後の Dist Preview を順に確認します。Preview は一時停止状態で開き、「再生」後に現在の Step の入力ボタンを操作できます。Step／Cue／Timeline と Surface の遷移はローカルで実行し、Unity の描画・再生処理は通常 Runtime と共通です。「一時停止」は再生時刻を保持し、「リセット」は初期状態へ戻します。本番 Realtime 接続は対象外です。

フェードの確認には、ターミナル2の CLI を `Ctrl+C` で停止し、`pnpm --filter @unframe/core dev -- "$PWD/examples/presentation"` で起動し直します。表示後に「再生」→「continue」を押すと、Surface が inactive 状態へ切り替わり、host の不透明度が1秒で `1 → 0.5` に変化して Step が `finished` へ進みます。Unity 側のコード変更後は `nix run .#unity-preview` で player を再ビルドしてください。

ビルド済み UI を CLI から配信する場合は、`pnpm --filter @unframe/local-editor build` の後に `presentation author /absolute/path/to/project` を実行します。Opaque capture の環境準備は [scripts README](../../../scripts/README.md) を参照してください。

`presentation preview` が開く `/dist-preview` は、固定 Dist の閲覧専用です。Source 編集・Dev build・公開操作を表示せず、通常再生を利用できます。ブラウザが動画の自動再生を拒否した場合は一時停止し、「再生」の操作で再開します。

CLI が開く Editor はログインなしで利用できます。Inspector は対応する React scene の scalar Props を保存し、同一 session の Undo／Redo を扱います。編集 metadata がない Source は外部 editor で保存し、診断と Preview を利用します。旧 demo／localStorage 文書と React 3D canvas は編集経路から撤去しました。

左の Group／Step／Cue 一覧から閲覧対象を選び、中央下部で時間軸・進行図・問題、右側で Cue／キーの詳細と公開 Props を確認します。選択だけでは Cue を実行しません。Cue 詳細はきっかけ・条件・アクション・遷移先をまとめ、優先度と候補順は「実行設定」を開いて確認します。時間軸はズーム・横スクロールに対応し、Timeline と Surface crossfade を表示します。テーマ、左右パネルの開閉、横・縦分割のサイズを調整できます。

通常再生で実際に発火した Cue は、表示 build と Source revision が一致する場合に「この Cue を確認」で確認できます。発火直後を0msとして前後にシークし、確認範囲の終端で停止します。確認中だけキー選択もシークします。「通常再生に戻る」は入る前の位置へ一時停止で復帰します。後続 Cue／Step への進行と Source／Dist の書き換えは行いません。Dist は Source 一致を検証できないため、時間軸は閲覧専用です。詳細は [Cue 時間軸仕様](../../../docs/packages/LOCAL_EDITOR_TIMELINE_SPEC.md) を参照してください。

未保存 Props は外部更新で破棄せず競合として保持します。Instance を切り替える場合は保存・破棄・取消を選べます。保存結果が不明な場合は同じ要求を再送し、競合の場合は自動上書きしません。Unity の部分適用・後続更新の故障中は再生・シーク・公開を止めます。正常 state の再適用に失敗した場合は「Preview を再読込」で新しい request を作成します。

Dev Preview は保存済み revision を自動 build し、`.unframe/preview/` に生成します。「本番 build」は `dist` を更新し、Dist Preview は現在の固定 generation を再 build せず読み込みます。build／load 失敗時は前の正常 scene を保ち、保存済み Source は巻き戻しません。未保存の Inspector buffer は Preview 入力に含めません。

公開には `UNFRAME_CONTROL_PLANE_URL`、`UNFRAME_WEB_ORIGIN`、`UNFRAME_DEVICE_CLIENT_ID` を Host 起動時にすべて設定します。origin は HTTPS、または loopback HTTP を指定します。承認画面は設定済み Web origin の `/device` で開き、bearer と `device_code` は Host のメモリーだけに保持します。公開は Unity の commit と初期 playback 適用が確認された Dist と現在の `dist` が一致する場合だけ開始し、受付後は upload 元を固定します。

## 品質ゲート

```bash
nix run .#local-editor
```

React 外の controller・変換・adapter を `src/**/tests/**/*.test.ts` の Node テストで検証します。UI／component test・E2E は設けていません。画面、固定 Browser／CSP、実 WebGL／Quest の描画は別途手動確認が必要です。Unity 変更時は `nix develop --command bash scripts/unity/test-native-editor.sh playback` を使用します。公開条件は [実装契約](../../../docs/packages/LOCAL_EDITOR_DESIGN.md) に従います。
