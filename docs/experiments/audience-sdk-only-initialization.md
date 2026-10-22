# SDK単独の初期化比較

> 履歴（2026-10-22）：現在の実装は[AprilTag採用方式](./audience-apriltag-adopted.md)のみ。以下は当時の方式・スキーマ・実証の記録であり、削除済みの比較モードやコマンドを現行仕様として使用しない。

2026-10-21。schema13実機ログでSDK自身が約22秒間LIMITED/INITIALIZINGを返していたため、検出器の負荷を外し、SDK尺度設定を比較するPoCを追加した。初期化不成立の原因はまだ確定していない。

## 条件

- `/?mode=sdk&scale=absolute`: SDK world tracking有効、メートル尺度。
- `/?mode=sdk&scale=responsive`: SDK world tracking有効、responsive尺度。
- 両方ともタグ検出Workerを生成せず、検出用frameSource/読出しpipelineも生成しない。単に検出結果を無視する実装ではない。
- SDK映像描画・Three.jsカメラ・追跡状態の採取経路は共通。SDKモジュールが行う内部処理は変更しない。アプリの画像読出しを除去しても、SDKが内部で画素を処理しないという意味ではない。
- トラッキング状態の解釈を変えず、位置・回転が数値として出ただけではNORMALにしない。

SDK単独モードはタグを映す必要がない。明るい同じ場所・同じ端末・照明・向きで、模様のある机・床・壁を映す。端末をゆっくり横へ動かし、約30秒観察する。回転だけの試行と混同しない。absoluteで保存後、尺度をresponsiveへ切り替えてページを再読み込みし、同じ動きを繰り返す。可能なら順序を逆にした試行も別ファイルへ保存する。前のページのログは自動保存しない。

## JSON

専用ログはschemaVersion 1 / mode=sdk-only。タグ＋SLAMのschema13とは別形式。

ファイル名は`audience-sdk-only-absolute-log.json` / `audience-sdk-only-responsive-log.json`。「JSONログを保存」で開始前・実行中・停止後に出力できる。

- `experiment`: タグ検出OFF、アプリ画像readback OFF、world tracking ON。
- `scale`: 実行した尺度設定。
- `summary`: 開始要求・カメラonStart・最初にpipelineでNORMALを観測した時刻・最初に通知イベントでNORMALを観測した時刻・停止時刻。カメラ開始からの到達時間も保存する。未到達はnull、イベントがonStartより早ければ相対時間は負値になり得る。
- `measurementSnapshot.experiment`と`sdk.configuration`: 実際にadapterへ渡した条件と、検出用sourceを生成したかの証拠。
- `measurementSnapshot.detection/capture`: SDK単独では投入・取得0のまま。
- `trackingDiagnostics`: 全pipeline更新の生状態型・解釈・イベント数と最後の状態。
- `records`: SDK状態の生値・型・理由・適用状態、変更イベント、最大10Hz姿勢、起動・停止。

カメラonStartは追跡初期化完了と同義ではない。時刻はperformance.nowのcallback時刻で、露光・センサー姿勢時刻は未確認。イベントとpipelineのNORMAL到達を分離する。リング上限の欠落件数も保存する。ページ内で停止・再開した場合、summaryは最後の開始分、adapter集計・recordsはそのページの通算であり、sessionIdで区別する。各比較の前にページを再読み込みすれば単一試行として採取できる。

## 判定

1. SDK単独absoluteがNORMALになる場合、タグ検出を有効にした元条件との差を確認する。ただし処理負荷が原因と即断せず、照明・動かし方・初期画角等の差も確認する。
2. absoluteだけ初期化が終わらずresponsiveでは終わる場合、尺度設定に関係する初期化の差を優先して調べる。responsiveをメートルとして扱ってよいことの証明にはならない。
3. 両方とも初期化しない場合、共通のSDK起動・権限・環境・追跡条件を調べる。
4. どちらも正常なら、検出ON条件を同じ場所で再実行して比較する。

この実装で初期化の成否・精度を実機測定したとは扱わない。

## 軽い検証

ユーザーの軽いデバッグ指定を継続し、回帰テストは追加・実行しない。一時スクリプトで両尺度のSDK設定、world tracking有効、Worker factoryが呼ばれないこと、frameSource pipelineなし、検出投入・画像取得0、生状態ログとJSONの保持を確認した。一時スクリプトは削除した。型検査・lint・本番ビルドを実施する。実機試験は公開版での採取待ち。

型検査・lint・本番ビルドは成功。公開HTTPSのentry JavaScriptとローカル成果物のSHA-256一致を確認した。スマートフォン・GPUラボによる実機確認は未実施で、NORMALへ遷移できるかは次のログ採取待ち。回帰テスト・全体品質ゲートは軽いデバッグの指定に従い未実行。差分とステージ済差分を確認、未コミット。
