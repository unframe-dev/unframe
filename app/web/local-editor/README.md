# Unframe Local Editor

`app/web/local-editor` / `@unframe-dev/local-editor` はローカル専用の Source Inspector、保存・履歴、Dev／Dist build、Unity Preview、Cue 時間軸の閲覧・確認と CLI を通す公開 UI です。`index.html` を `dist/` に build し、CLI Host が静的 UI と Unity player、token 認証付き HTTP API を配信します。ローカル HTTP 契約は contracts、filesystem は CLI の Adapter が所有します。認証・Dist の持ち込み公開・公開済みプレゼンテーションの確認・ルーム作成は [Console](../console/README.md) が担当します。

ブランド名は同梱の Poppins Light（300）、字間 `0.098em`（Canva の文字間隔 98）、文字色 `#2A2A2A`（暗い背景では `#FFFFFF`）で表示します。アイコンは文字サイズの `0.78em`、文字との間隔は `0.17em` に揃えます。フォントは [SIL Open Font License](public/fonts/poppins/OFL.txt) に基づいて利用・再配布します。

UI フォントは [LINE Seed JP](https://seed.line.me/index_jp.html) の Regular / Bold を同梱しています。[SIL Open Font License](public/fonts/line-seed-jp/OFL.txt) に基づいて利用・再配布します。

## Local Editor の起動

配布 CLI では、編集するプロジェクトで次を実行します。

```bash
unframe author .
```

Editor とローカル API が起動し、ブラウザが開きます。変更時の Preview build も Editor が行うため、開発サーバーや `unframe dev` の別起動は不要です。`Ctrl+C` で終了します。`unframe dev` は Editor を開かず、ビルド監視だけを行うコマンドです。

CLI のディレクトリ引数は、実行時の作業ディレクトリを基準に相対パスでも指定できます（`./slides`、`../slides`、`./dist` など）。

### リポジトリでの開発

対象 host は Linux x86_64 と macOS arm64、配布 CLI の実行には Node.js 24 以降が必要です。native 隔離の保証差と実機検証結果は [ADR-0026](../../../docs/decisions/0026-native-linux-macos-host-adapters.md) を参照してください。利用者は配布された UI と Unity Preview Player を使用できます。配布物を作る場合は [ProjectVersion.txt](../../unity/ProjectSettings/ProjectVersion.txt) と一致する Unity Editor、WebGL module と license が必要です。標準の Unity Hub 配置以外にインストールした場合は、`UNITY_EDITOR` に実行ファイルのパスを設定してください。

リポジトリで開発する場合は、依存関係と固定 Browser を準備し、配布用 UI と Player をビルドします。

```bash
nix run .#setup
nix develop --command scripts/dev/install-presentation-browser.sh
nix develop --command pnpm --config.verify-deps-before-run=false --filter @unframe-dev/local-editor run build:distribution
```

開発時は次の1コマンドで native filesystem helper、解析 Worker、スタイル処理用 compiler と依存スナップショットをビルドしてから、UI 開発サーバーと CLI を起動します。準備に失敗した場合は起動しません。UI と Unity Preview Player は上記の初回ビルドが必要です。API と Player のリクエストは CLI の準備完了まで最大20秒待機し、準備できない場合は503で終了します。

```bash
nix run .#local-editor -- dev ./example
```

UI の準備ができると CLI が Editor をブラウザで開きます。`Ctrl+C` で両方を終了します。port 5174 が使用中の場合は、既存のサーバーを終了してから起動してください。CLI 起動後は表示された Editor URL を直接開いても接続でき、再読み込みや別タブでも認証操作は不要です。接続用 token は起動時に Host から取得し、メモリーだけに保持します。UI は HMR で変更を反映し、API と Player の要求を CLI に proxy します。同じ Host の UI HMR では認証済み Workspace、選択、パネル配置、未保存入力と Unity canvas を保持します。ページ全体の再読み込みでは未保存入力を保持しません。controller や Host の処理を変更した場合は再起動してください。

CLI Host は UI／Player のファイル内容を起動時には読み込みません。要求時に内容を検証して一時ディスクへコピーし、以後は元ファイルの変更を確認して再利用します。静的ファイルは内容の SHA-256 を ETag として再検証し、API と接続 token は `no-store` で返します。一時コピーには少なくとも要求済みファイルと同量の空き容量が必要で、Host 終了時に削除します。

Unity の Preview コードを変更した場合は、次をリポジトリルートで実行して Player を再生成し、CLI の配信先へコピーしてからブラウザを再読み込みしてください。Preview Player はバックグラウンド実行を有効にしてビルドします。ブラウザ自体による非表示タブの処理制限は残ります。

```bash
nix run .#unity-preview
pnpm --filter @unframe-dev/local-editor exec node package-player.ts
```

配布物は `pnpm --config.verify-deps-before-run=false --filter @unframe-dev/local-editor exec pnpm pack` で生成します。pack は現在の Unity Player と UI をビルドし、両方を同梱します。

`unframe preview <dist-directory>` が開く `/dist-preview` は、固定 Dist の閲覧専用です。Dist が symlink の場合は `realpath` で解決したディレクトリを渡してください。Source 編集・Dev build・公開操作を表示せず、通常再生を利用できます。ブラウザが動画の自動再生を拒否した場合は一時停止し、「再生」の操作で再開します。

CLI が開く Editor はログインなしで利用できます。Inspector は対応する React scene の scalar Props を保存し、同一 session の Undo／Redo を扱います。編集 metadata がない Source は外部 editor で保存し、診断と Preview を利用します。旧 demo／localStorage 文書と React 3D canvas は編集経路から撤去しました。

Host は Source・config・lock・アセット・スタイルを Source ロック内で取得し、解放後に取得済み入力から解析します。重い解析・検証は同梱の Worker で行い、スタイル・メディア変換やブラウザの子プロセスは Host が管理します。同じ revision の成功結果と進行中の解析を再利用し、成功した解析の準備済み入力は build でも使用します。再利用時も Source・依存の内容と保存の復旧状態を確認し、後から取得した revision を古い解析の完了で上書きしません。進行パネルは初回の解析結果を待つ間は読み込み中と表示し、取得失敗と定義の検証失敗を区別します。取得エラーの詳細は問題パネルに表示します。ツールチェーンや Host の実装を変更した場合は Host を再起動してください。

Compiler の永続キャッシュは `.unframe/cache/builds-v1/` に保存し、新規保存時に16件・合計512 MiBを上限として古い entry を回収します。容量には metadata とアセットの両方を含めます。読込時は成果物と checksum を検証し、破損した entry は再利用しません。完成済み Dev／Dist generation の保持とは独立しています。

Dev build は、React Surface の描画入力と隔離実行環境が完全一致する場合にキャプチャを Host のメモリーから再利用します。描画に影響しない revision の変更でも再利用でき、描画用ソース・スタイル・素材・Props・状態・解像度・実行環境の変更は再描画します。保存するキャプチャデータは合計64 MiBまでとし、古いものから回収します。Host 終了時に破棄し、Dist build では使用しません。成果物の生成と検証、Unity への反映は引き続き行います。

`UNFRAME_BUILD_PROFILE=1` を Host 起動時に設定すると、build ごとの工程別ミリ秒とキャプチャの再利用・実行回数を `[unframe-build-profile]` で始まる JSON として標準エラーへ出力します。リポジトリでは `UNFRAME_BUILD_PROFILE=1 nix run .#local-editor -- dev ./example` で有効にできます。`compiler:*` は `compile` の内訳です。計測対象は CLI の build 実行部分で、受付待ち・project 取得・Unity への反映は含みません。

ブラウザのコンソールには `[Unity Preview]` の準備段階・要求 ID・経過時間を記録します。UI 開発サーバーでは要求の送信・応答・タイムアウトと、契約に一致しない通知のフィールド名も記録します。タイムアウトのメッセージには要求したコマンドと応答期限が含まれます。

Host のファイル監視による変更通知を受けて project を再取得します。通知は認証付きの変更待機 API を使い、無変更時の1秒ごとの project 取得は行いません。更新中も直前の Preview を残し、小さい状態表示で更新待ち・ビルド中・表示反映中を示します。Dev ビルドの待機中・失敗時は直前の Preview の再生・操作を継続し、ビルド成功後に表示を置き換えます。ソース／ビルドのロック競合だけを1秒間隔で再試行し、新しい編集やキャンセルで古い再試行を止めます。復旧が必要なエラーやソースの不備は自動再試行しません。表示の置き換えに進んだ後の失敗では直前の画面を残しますが、失効した表示記録での再生・公開は止めます。

Preview は選択した全 PNG を事前に GPU へ読み込み、Group の切り替えでは解放しません。Preview のメモリ予算上限チェックは行いません。素材の検証・解像度などの描画制約と、ビルド・公開・本番配信の上限は引き続き適用されます。

Preview は Viewer 向けに投影し、Presenter 専用コンテンツを表示対象から外します。通常視点と俯瞰を切り替えられます。両視点で高さ0に40m四方・1m間隔のグリッド床を表示し、高さと奥行きの目安にします。床の原点 `(0, 0, 0)` には白いリングと、X 軸が赤・Z 軸が青の十字を表示します。「カメラを原点へ」は通常視点に切り替え、カメラを X/Z=0、高さ1.6m、正面向きに戻します。床は Preview 専用で、Source や Dist に含めません。俯瞰では共通原点の AprilTag、Zone の枠、仮想 Presenter の腰位置を表示します。Presenter は俯瞰のクリック・ドラッグ、または XYZ 入力後の Enter・フォーカス移動で移動します。「向き」で水平回転を変更し、Presenter に追従する配置も確認できます。頭・両手の追従先には、腰からの固定オフセットで作る仮想姿勢を使います。再生中に Zone の境界を越えると、現在の Group／Step で条件を満たす進入・退出 Cue が実行されます。一時停止中も位置・向きを変更できますが、Zone の Cue は発火しません。再開時には現在位置を基準に判定を始めます。原点タグは位置確認用のガイドで、実カメラの認識や校正は行いません。位置・視点の操作は Source や Dist に保存しません。

再生前・一時停止中・再生中に「次のイベント」で、現在の Step の実行可能な入力を優先度・候補順・ID 順に1件選んで送信できます。論理入力、Gesture、外部イベント、Surface 操作、Zone 進入・退出が対象です。条件を満たさない Cue と消費済みの Cue は除外し、タイマーと再生完了は通常再生で進めます。Zone 進入・退出は Presenter の移動でも発火させられます。疑似入力で発火させた場合は Presenter の位置を変更しません。現在の Step で実行可能な Gesture や外部イベントを選んで送信し、Surface 上の操作領域をクリックして Cue を実行できます。これらの入力は再生前・一時停止中も使用でき、入力後も一時停止を保ちます。Native UI は本番と共通のレンダラーで表示します。左サイドバーの進行ツリーまたは進行タイムラインで Step を選び、「選択位置から再生」でその Step の初期状態から通常の進行に沿って再生できます。左サイドバー内の再生ボタンも同じ操作です。Cue を選んだ場合は所属 Step の先頭から再生します。未到達の Step も選択可能です。リハーサル開始 Step の一覧にある「ここから再生」も同じ操作です。Cue 確認中は自動的に通常再生へ戻してから開始します。Source と表示中 Preview の revision が異なる間は、Source 側の選択位置からの再生を無効にします。過去の Step での操作結果は引き継がず、Presenter の位置・向きも初期値へ戻します。

左の Group／Step／Cue 一覧から閲覧対象を選び、中央下部で進行・時間軸・問題、右側で Cue／キーの詳細と公開 Props を確認します。下部は最初に進行タイムラインを表示し、開始 Step から遷移をたどる順に Step と Cue を横へ並べます。横軸は秒数ではなく進行順です。現在の再生位置を示し、再生中は現在の Group を表示して Step の遷移に合わせてスクロールします。Step／Cue をクリックすると詳細を選択できます。選択だけでは Cue を実行しません。Cue 詳細はきっかけ・条件・アクション・遷移先をまとめ、優先度と候補順は「実行設定」を開いて確認します。時間軸はズーム・横スクロールに対応し、Timeline と Surface crossfade を表示します。テーマ、左右パネルの開閉、横・縦分割のサイズを調整できます。

通常再生で実際に発火した Cue は、表示 build と Source revision が一致する場合に「この Cue を確認」で確認できます。発火直後を0msとして前後にシークし、確認範囲の終端で停止します。確認中だけキー選択もシークします。「通常再生に戻る」は入る前の位置へ一時停止で復帰します。後続 Cue／Step への進行と Source／Dist の書き換えは行いません。Dist は Source 一致を検証できないため、時間軸は閲覧専用です。詳細は [Cue 時間軸仕様](../../../docs/packages/LOCAL_EDITOR_TIMELINE_SPEC.md) を参照してください。

未保存 Props は外部更新で破棄せず競合として保持します。Instance を切り替える場合は保存・破棄・取消を選べます。保存結果が不明な場合は同じ要求を再送し、競合の場合は自動上書きしません。Unity の部分適用・後続更新の故障中は再生・シーク・公開を止めます。正常 state の再適用に失敗した場合は「Preview を再読込」で新しい request を作成します。

Dev Preview は導入済み `node_modules` の依存・workspace・symlink と現在のソース・素材・PostCSS 設定から build 入力を生成します。依存の導入・更新はプロジェクトのパッケージマネージャーで行ってください。Unframe は install や lock の更新を実行しません。PnP は未対応です。入力変更は revision に反映し、失敗時は前の正常な Preview を保持します。

Dev Preview は保存済み revision を自動 build し、`.unframe/preview/` に生成します。保存・外部変更による連続更新は200msでまとめ、初回表示と手動再読込は即時に要求します。Host は同じ revision・channel の要求をまとめ、準備中・待機中・実行中も処理を共有します。新 revision の Dev 要求だけが旧 Dev build を取り消し、後始末が終わってから最新の処理を開始します。要求ごとの取消や準備中の切断は他の要求を巻き込まず、待っている要求がすべてなくなった場合に処理を止めます。受付待ちの旧要求も結果を回収して取り消し、遅延した結果を表示へ反映しません。同じ入力の成功済み generation は、現在の参照先と成果物・アセットの完全性を確認できる場合に再利用します。

保存内容の検証、入力の生成、描画と成果物の一時書き込みは Source ロック外で進め、保存・成果物の確定時に再取得して revision を検証します。競合した結果は確定せず、保存要求の再送は同じ command ID の receipt と照合します。Host 終了時には待機を中断し、受付済み build は取消でも待機を中断できます。「本番 build」は `dist` を更新し、Dist Preview は現在の固定 generation を再 build せず読み込みます。build／load 失敗時は前の正常 scene を保ち、保存済み Source は巻き戻しません。未保存の Inspector buffer は Preview 入力に含めません。

公開には `UNFRAME_CONTROL_PLANE_URL`、`UNFRAME_WEB_ORIGIN`、`UNFRAME_DEVICE_CLIENT_ID` を Host 起動時にすべて設定します。origin は HTTPS、または loopback HTTP を指定します。承認画面は設定済み Web origin の `/device` で開き、bearer と `device_code` は Host のメモリーだけに保持します。公開は Unity の commit と初期 playback 適用が確認された Dist と現在の `dist` が一致する場合だけ開始し、受付後は upload 元を固定します。

## 品質ゲート

```bash
nix run .#local-editor
```

React 外の controller・変換・adapter を `src/**/tests/**/*.test.ts` の Node テストで検証します。配布 CLI の `test/pack-acceptance.ts` は実 Chromium と同梱 Player の読込・Surface の実画素・再生通知を検証します。実認証・実公開・Quest 実機は別途確認が必要です。Unity 変更時は `nix develop --command bash scripts/unity/test-native-editor.sh playback` を使用します。公開条件は [実装契約](../../../docs/packages/LOCAL_EDITOR_DESIGN.md) に従います。
