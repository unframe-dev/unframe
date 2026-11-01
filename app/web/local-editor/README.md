# Unframe Local Editor

`app/web/local-editor` / `@unframe/local-editor` はローカル専用の Source Inspector、保存・履歴、Dev／Dist build、Unity Preview、Cue 時間軸の閲覧・確認と CLI を通す公開 UI です。`index.html` を `dist/` に build し、CLI Host が静的 UI と Unity player、token 認証付き HTTP API を配信します。ローカル HTTP 契約は contracts、filesystem は CLI の Adapter が所有します。認証・Dist の持ち込み公開・公開済みプレゼンテーションの確認・ルーム作成は [Console](../console/README.md) が担当します。

UI フォントは [LINE Seed JP](https://seed.line.me/index_jp.html) の Regular / Bold を同梱しています。[SIL Open Font License](public/fonts/line-seed-jp/OFL.txt) に基づいて利用・再配布します。

## Local Editor の起動

対象 host は Linux x86_64 と macOS arm64、配布 CLI の実行には Node.js 24 以降が必要です。native 隔離の保証差と実機検証結果は [ADR-0026](../../../docs/decisions/0026-native-linux-macos-host-adapters.md) を参照してください。利用者は配布された UI と Unity Preview Player を使用できます。配布物を作る場合は Unity Editor 6000.3.22f1 の WebGL module と license が必要です。

リポジトリで開発する場合は、依存関係と固定 Browser を準備し、配布用 UI と Player をビルドします。

```bash
nix run .#setup
nix develop --command scripts/dev/install-presentation-browser.sh
nix develop --command pnpm --config.verify-deps-before-run=false --filter @unframe/local-editor run build:distribution
```

2つのターミナルでそれぞれ `nix develop` に入り、次を実行します。

```bash
pnpm --config.verify-deps-before-run=false --filter @unframe/local-editor dev
pnpm --config.verify-deps-before-run=false --filter @unframe/cli dev -- /absolute/path/to/project
```

CLI が認証付きの Editor URL をブラウザで開きます。UI は HMR で変更を反映し、API と Player の要求を CLI に proxy します。再読み込み後は CLI のターミナルで `r` と Enter を入力して認証付き URL を開き直します。

配布物は `pnpm --config.verify-deps-before-run=false --filter @unframe/local-editor exec pnpm pack` で生成します。pack は現在の Unity Player と UI をビルドし、両方を同梱します。配布 CLI は `unframe author /absolute/path/to/project` で起動します。

`unframe preview <absolute-dist-directory>` が開く `/dist-preview` は、固定 Dist の閲覧専用です。Dist が symlink の場合は `realpath` で解決したディレクトリを渡してください。Source 編集・Dev build・公開操作を表示せず、通常再生を利用できます。ブラウザが動画の自動再生を拒否した場合は一時停止し、「再生」の操作で再開します。

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

React 外の controller・変換・adapter を `src/**/tests/**/*.test.ts` の Node テストで検証します。配布 CLI の `test/pack-acceptance.mjs` は実 Chromium と同梱 Player の読込・Surface の実画素・再生通知を検証します。実認証・実公開・Quest 実機は別途確認が必要です。Unity 変更時は `nix develop --command bash scripts/unity/test-native-editor.sh playback` を使用します。公開条件は [実装契約](../../../docs/packages/LOCAL_EDITOR_DESIGN.md) に従います。
