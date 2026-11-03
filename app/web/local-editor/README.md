# Unframe Local Editor

`app/web/local-editor` / `@unframe-dev/local-editor` はローカル専用の Source Inspector、保存・履歴、Dev／Dist build、Unity Preview、Cue 時間軸の閲覧・確認と CLI を通す公開 UI です。`index.html` を `dist/` に build し、CLI Host が静的 UI と Unity player、token 認証付き HTTP API を配信します。ローカル HTTP 契約は contracts、filesystem は CLI の Adapter が所有します。認証・Dist の持ち込み公開・公開済みプレゼンテーションの確認・ルーム作成は [Console](../console/README.md) が担当します。

UI フォントは [LINE Seed JP](https://seed.line.me/index_jp.html) の Regular / Bold を同梱しています。[SIL Open Font License](public/fonts/line-seed-jp/OFL.txt) に基づいて利用・再配布します。

## Local Editor の起動

配布 CLI では、編集するプロジェクトで次を実行します。

```bash
unframe author .
```

Editor とローカル API が起動し、ブラウザが開きます。変更時の Preview build も Editor が行うため、開発サーバーや `unframe dev` の別起動は不要です。`Ctrl+C` で終了します。`unframe dev` は Editor を開かず、ビルド監視だけを行うコマンドです。

CLI のディレクトリ引数は、実行時の作業ディレクトリを基準に相対パスでも指定できます（`./slides`、`../slides`、`./dist` など）。

### リポジトリでの開発

対象 host は Linux x86_64 と macOS arm64、配布 CLI の実行には Node.js 24 以降が必要です。native 隔離の保証差と実機検証結果は [ADR-0026](../../../docs/decisions/0026-native-linux-macos-host-adapters.md) を参照してください。利用者は配布された UI と Unity Preview Player を使用できます。配布物を作る場合は Unity Editor 6000.3.22f1 の WebGL module と license が必要です。

リポジトリで開発する場合は、依存関係と固定 Browser を準備し、配布用 UI と Player をビルドします。

```bash
nix run .#setup
nix develop --command scripts/dev/install-presentation-browser.sh
nix develop --command pnpm --config.verify-deps-before-run=false --filter @unframe-dev/local-editor run build:distribution
```

開発時は次の1コマンドで UI 開発サーバーと CLI を起動します。 API と Player のリクエストは CLI の準備完了まで最大20秒待機し、準備できない場合は503で終了します。

```bash
nix run .#local-editor -- dev ./example
```

UI の準備ができると CLI が Editor をブラウザで開きます。`Ctrl+C` で両方を終了します。port 5174 が使用中の場合は、既存のサーバーを終了してから起動してください。CLI 起動後は表示された Editor URL を直接開いても接続でき、再読み込みや別タブでも認証操作は不要です。接続用 token は起動時に Host から取得し、メモリーだけに保持します。UI は HMR で変更を反映し、API と Player の要求を CLI に proxy します。同じ Host の UI HMR では認証済み Workspace、選択、パネル配置、未保存入力と Unity canvas を保持します。ページ全体の再読み込みでは未保存入力を保持しません。controller や Host の処理を変更した場合は再起動してください。

CLI Host は UI／Player のファイル内容を起動時には読み込みません。要求時に内容を検証して一時ディスクへコピーし、以後は元ファイルの変更を確認して再利用します。静的ファイルは内容の SHA-256 を ETag として再検証し、API と接続 token は `no-store` で返します。一時コピーには少なくとも要求済みファイルと同量の空き容量が必要で、Host 終了時に削除します。

配布物は `pnpm --config.verify-deps-before-run=false --filter @unframe-dev/local-editor exec pnpm pack` で生成します。pack は現在の Unity Player と UI をビルドし、両方を同梱します。

`unframe preview <dist-directory>` が開く `/dist-preview` は、固定 Dist の閲覧専用です。Dist が symlink の場合は `realpath` で解決したディレクトリを渡してください。Source 編集・Dev build・公開操作を表示せず、通常再生を利用できます。ブラウザが動画の自動再生を拒否した場合は一時停止し、「再生」の操作で再開します。

CLI が開く Editor はログインなしで利用できます。Inspector は対応する React scene の scalar Props を保存し、同一 session の Undo／Redo を扱います。編集 metadata がない Source は外部 editor で保存し、診断と Preview を利用します。旧 demo／localStorage 文書と React 3D canvas は編集経路から撤去しました。

Host は Source・config・lock・アセット・スタイルを Source ロック内で取得し、解放後に取得済み入力から解析します。重い解析・検証は同梱の Worker で行い、スタイル・メディア変換やブラウザの子プロセスは Host が管理します。同じ revision の成功結果と進行中の解析を再利用し、後から取得した revision を古い解析の完了で上書きしません。ツールチェーンや Host の実装を変更した場合は Host を再起動してください。

Host のファイル監視による変更通知を受けて project を再取得します。通知は認証付きの変更待機 API を使い、無変更時の1秒ごとの project 取得は行いません。更新中も直前の Preview を残し、小さい状態表示で更新待ち・ビルド中・表示反映中を示します。Dev ビルドの待機中・失敗時は直前の Preview の再生・操作を継続し、ビルド成功後に表示を置き換えます。ソース／ビルドのロック競合だけを1秒間隔で再試行し、新しい編集やキャンセルで古い再試行を止めます。復旧が必要なエラーやソースの不備は自動再試行しません。表示の置き換えに進んだ後の失敗では直前の画面を残しますが、失効した表示記録での再生・公開は止めます。

Preview は Viewer 向けに投影し、Presenter 専用コンテンツを表示対象から外します。通常視点と俯瞰を切り替えられます。両視点で高さ0に40m四方・1m間隔のグリッド床を表示し、高さと奥行きの目安にします。床は Preview 専用で、Source や Dist に含めません。俯瞰では共通原点の AprilTag、Zone の枠、仮想 Presenter の腰位置を表示します。Presenter は俯瞰のクリック・ドラッグ、または XYZ 入力後の Enter・フォーカス移動で移動します。「向き」で水平回転を変更し、Presenter に追従する配置も確認できます。頭・両手の追従先には、腰からの固定オフセットで作る仮想姿勢を使います。再生中に Zone の境界を越えると、現在の Group／Step で条件を満たす進入・退出 Cue が実行されます。一時停止中も位置・向きを変更できますが、Zone の Cue は発火しません。再開時には現在位置を基準に判定を始めます。原点タグは位置確認用のガイドで、実カメラの認識や校正は行いません。位置・視点の操作は Source や Dist に保存しません。

再生中は「次のイベント」で、現在の Step の実行可能な入力を優先度・候補順・ID 順に1件選んで送信できます。論理入力、Gesture、外部イベント、Surface 操作が対象です。条件を満たさない Cue と消費済みの Cue は除外し、タイマーと再生完了は通常再生で進めます。Zone 進入・退出は Presenter の移動で発火させます。現在の Step で実行可能な Gesture や外部イベントを選んで送信し、Surface 上の操作領域をクリックして Cue を実行できます。Native UI は本番と共通のレンダラーで表示します。「Step へ移動」は選択した Group／Step の初期状態へ戻して一時停止し、「再生」でそこからリハーサルできます。過去の Step での操作結果は引き継がず、Presenter の位置・向きも初期値へ戻します。

左の Group／Step／Cue 一覧から閲覧対象を選び、中央下部で進行・時間軸・問題、右側で Cue／キーの詳細と公開 Props を確認します。下部は最初に進行タイムラインを表示し、開始 Step から遷移をたどる順に Step と Cue を横へ並べます。横軸は秒数ではなく進行順です。現在の再生位置を示し、Step／Cue をクリックすると詳細を選択できます。選択だけでは Cue を実行しません。Cue 詳細はきっかけ・条件・アクション・遷移先をまとめ、優先度と候補順は「実行設定」を開いて確認します。時間軸はズーム・横スクロールに対応し、Timeline と Surface crossfade を表示します。テーマ、左右パネルの開閉、横・縦分割のサイズを調整できます。

通常再生で実際に発火した Cue は、表示 build と Source revision が一致する場合に「この Cue を確認」で確認できます。発火直後を0msとして前後にシークし、確認範囲の終端で停止します。確認中だけキー選択もシークします。「通常再生に戻る」は入る前の位置へ一時停止で復帰します。後続 Cue／Step への進行と Source／Dist の書き換えは行いません。Dist は Source 一致を検証できないため、時間軸は閲覧専用です。詳細は [Cue 時間軸仕様](../../../docs/packages/LOCAL_EDITOR_TIMELINE_SPEC.md) を参照してください。

未保存 Props は外部更新で破棄せず競合として保持します。Instance を切り替える場合は保存・破棄・取消を選べます。保存結果が不明な場合は同じ要求を再送し、競合の場合は自動上書きしません。Unity の部分適用・後続更新の故障中は再生・シーク・公開を止めます。正常 state の再適用に失敗した場合は「Preview を再読込」で新しい request を作成します。

Dev Preview は build 前に依存設定と `pnpm-lock.yaml` を確認し、必要な場合だけ frozen install と `unframe.lock` の更新を行います。PostCSS 設定の追加も自動で反映します。pnpm workspace 内では、対象 importer を含む親の lock を使い、依存する workspace パッケージのソース・manifest の変更も監視して snapshot を更新します。package script・pnpmfile は実行せず、依存 version の再解決や `pnpm-lock.yaml` の書き換えは行いません。manifest と pnpm lock が不一致の場合は、作者が `pnpm install` で解決を確定してから再試行してください。同期に失敗した場合は既存の `unframe.lock` と Preview を保持します。

Dev Preview は保存済み revision を自動 build し、`.unframe/preview/` に生成します。保存・外部変更による連続更新は200msでまとめ、初回表示と手動再読込は即時に要求します。Host は現在の Source revision を確認してから旧 Dev build を取り消し、後始末が終わってから最新の処理を開始します。受付待ちの旧要求も結果を回収して取り消し、遅延した結果を表示へ反映しません。同じ入力の成功済み generation は、現在の参照先と成果物・アセットの完全性を確認できる場合に再利用します。

保存内容の検証、Dev lock の再計算、描画と成果物の一時書き込みは Source ロック外で進め、保存・lock 更新・成果物の確定時に再取得して revision を検証します。競合した結果は確定せず、保存要求の再送は同じ command ID の receipt と照合します。Host 終了時には待機を中断し、受付済み build は取消でも待機を中断できます。「本番 build」は `dist` を更新し、Dist Preview は現在の固定 generation を再 build せず読み込みます。build／load 失敗時は前の正常 scene を保ち、保存済み Source は巻き戻しません。未保存の Inspector buffer は Preview 入力に含めません。

公開には `UNFRAME_CONTROL_PLANE_URL`、`UNFRAME_WEB_ORIGIN`、`UNFRAME_DEVICE_CLIENT_ID` を Host 起動時にすべて設定します。origin は HTTPS、または loopback HTTP を指定します。承認画面は設定済み Web origin の `/device` で開き、bearer と `device_code` は Host のメモリーだけに保持します。公開は Unity の commit と初期 playback 適用が確認された Dist と現在の `dist` が一致する場合だけ開始し、受付後は upload 元を固定します。

## 品質ゲート

```bash
nix run .#local-editor
```

React 外の controller・変換・adapter を `src/**/tests/**/*.test.ts` の Node テストで検証します。配布 CLI の `test/pack-acceptance.ts` は実 Chromium と同梱 Player の読込・Surface の実画素・再生通知を検証します。実認証・実公開・Quest 実機は別途確認が必要です。Unity 変更時は `nix develop --command bash scripts/unity/test-native-editor.sh playback` を使用します。公開条件は [実装契約](../../../docs/packages/LOCAL_EDITOR_DESIGN.md) に従います。
