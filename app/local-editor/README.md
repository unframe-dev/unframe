# Unframe Local Editor

`app/local-editor` / `@unframe/local-editor` はローカル専用の Source Inspector、保存・履歴、Dev／Dist build、Unity Preview、Timeline 閲覧と CLI を通す公開 UI です。`index.html` を `dist/` に build し、CLI Host が静的 UI と Unity player、token 認証付き HTTP API を配信します。ローカル HTTP 型と filesystem は CLI が所有します。認証・公開済み Dist の確認・ルーム作成は [Web](../web/README.md) が担当します。

## Local Editor の起動

対象 host は Linux x86_64 と macOS arm64 です。native 隔離の保証差と実機検証結果は [ADR-0026](../../docs/decisions/0026-native-linux-macos-host-adapters.md) を参照してください。project 指定、固定 Browser の provision、利用可能な Unity Editor の WebGL module と license が必要です。`UNITY_EDITOR` は `ProjectVersion.txt` に対応する実行ファイルを指定できます。未指定時は OS ごとの Unity Hub 標準配置を探します。

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
pnpm --filter @unframe/unframe-cli dev -- "$PWD/examples/local-editor-showcase"
```

CLI が認証付きの Editor URL をブラウザで開きます。Local Editor は HMR で画面の変更を反映し、API と Unity player の要求を CLI に proxy します。CLI の `dev` が固定 Browser のパス設定と OS 別の起動準備を行うため、wrapper の手動指定や事前の UI build は不要です。ページ全体を再読み込みした場合は、CLI のターミナルで `r` + Enter を入力して認証付き Editor を開き直します。停止は各ターミナルで `Ctrl+C` です。

Dev Preview の表示、Source 保存後の反映、「本番 build」後の Dist Preview を順に確認します。Preview は一時停止状態で開き、「再生」後に現在の Step の入力ボタンを操作できます。Step／Cue／Timeline と Surface の遷移はローカルで実行し、Unity の描画・再生処理は通常 Runtime と共通です。「一時停止」は再生時刻を保持し、「リセット」は初期状態へ戻します。本番 Realtime 接続は対象外です。

フェードの確認には、ターミナル2の CLI を `Ctrl+C` で停止し、`pnpm --filter @unframe/unframe-cli dev -- "$PWD/examples/presentation"` で起動し直します。表示後に「再生」→「continue」を押すと、Surface が inactive 状態へ切り替わり、host の不透明度が1秒で `1 → 0.5` に変化して Step が `finished` へ進みます。Unity 側のコード変更後は `nix run .#unity-preview` で player を再ビルドしてください。

ビルド済み UI を CLI から配信する場合は、`pnpm --filter @unframe/local-editor build` の後に `presentation author /absolute/path/to/project` を実行します。Opaque capture の環境準備は [scripts README](../../scripts/README.md) を参照してください。

CLI が開く Editor はログインなしで利用できます。Inspector は対応する React scene の scalar Props と host Transform を保存し、同一 session の Undo／Redo を扱います。編集 metadata がない Source は外部 editor で保存し、診断と Preview を利用します。旧 demo／localStorage 文書と React 3D canvas は編集経路から撤去しました。

Timelines パネルは保存済み Source の進行構造を読み取り専用で表示します。Group を選んで Step 遷移図を確認し、Step → Cue の順に選ぶと trigger、guard、actions と遷移先を参照できます。Cue が開始する複数 Timeline は共通の Cue 発火基準で表示し、ズームとキーフレーム選択で値・easing を確認できます。外部保存の更新では同じ ID の選択を維持し、削除された項目は選択を解除します。表示対象の保存 revision と Unity Preview の表示 revision は別です。編集・再生・シークは対象外です。詳細は [読み取り専用 Timeline 仕様](../../docs/packages/LOCAL_EDITOR_TIMELINE_SPEC.md) を参照してください。

Dev Preview は保存済み revision を自動 build し、`.unframe/preview/` に生成します。「本番 build」は `dist` を更新し、Dist Preview は現在の固定 generation を再 build せず読み込みます。build／load 失敗時は前の正常 scene を保ち、保存済み Source は巻き戻しません。未保存の Inspector buffer は Preview 入力に含めません。

公開には `UNFRAME_CONTROL_PLANE_URL`、`UNFRAME_WEB_ORIGIN`、`UNFRAME_DEVICE_CLIENT_ID` を Host 起動時にすべて設定します。origin は HTTPS、または loopback HTTP を指定します。承認画面は設定済み Web origin の `/device` で開き、bearer と `device_code` は Host のメモリーだけに保持します。公開は Unity が commit を完了した Dist と現在の `dist` が一致する場合だけ開始し、受付後は upload 元を固定します。

## 品質ゲート

```bash
nix run .#local-editor
pnpm --filter @unframe/local-editor test:e2e
UNFRAME_REAL_WEBGL=1 pnpm --filter @unframe/local-editor test:e2e
nix run .#local-editor-e2e
```

mock E2E、実 WebGL、実 Control Plane／D1／R2／Realtime・native Unity の E2E は別々の検証です。前提と成果物は [scripts README](../../scripts/README.md#local-editor-と-unity) を参照してください。公開条件は [実装契約](../../docs/packages/LOCAL_EDITOR_DESIGN.md) に従います。
