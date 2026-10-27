# NORMAL後のタグ検出切替試験

> 履歴（2026-10-22）：現在の実装は[AprilTag採用方式](./audience-apriltag-adopted.md)のみ。以下は当時の方式・スキーマ・実証の記録であり、削除済みの比較モードやコマンドを現行仕様として使用しない。

2026-10-21。SDK単独absoluteの実機ログ2本ではカメラ開始から約6.40秒・4.53秒でNORMALへ到達した。後者は約0.91秒後にINITIALIZINGへ戻り、約2.56秒後にNORMALへ復帰した。タグ有効時の約22秒間INITIALIZINGとの違いは負荷を原因候補にするが、環境・動かし方の差があるため原因確定ではない。両ログはabsoluteで、responsiveとの比較ではない。

## 起動と操作

`/?mode=sdk&experiment=staged&scale=absolute`。responsiveへ変更する場合は尺度を適用してページを再読み込みする。

1. 同じ端末・照明・場所で、明るく模様のある机・床・壁を映してカメラを開始する。
2. NORMALになってからさらに約5秒待つ。初期設定は2Hz。検出開始ボタンは現在のSDK状態がNORMALの場合に有効になる。
3. 「タグ検出を開始」。タグを映し、ゆっくり横へ動く同じ動作を約15秒続ける。
4. 「タグ検出を停止」。同じ動作をさらに約15秒続けてJSONを保存する。
5. 必要ならOFF中に1Hz・5Hzへ変更して再試行する。別の初期化試行はJSON保存後にページを再読み込みする。

この画面は負荷とSDK状態の試験であり、タグの位置推定・3D重ね合わせを行わない。タグサイズはこの試験の計算に使用しない。

## 実装条件

- world tracking有効。SDK単独モードと同じSDK設定・描画・状態採取を使用する。
- 初期状態ではWorkerを生成せず、frameSourceのonUpdateも呼ばない。画像readbackはゼロ。SDK単独モードとの違いとして、切替用frameSourceは起動時から登録し、onStartとサイズ通知だけを受ける。GL読出し用rendererは最初の取得まで生成しない。
- 最初のON要求でWorker/WASMを準備する。準備後もNORMALの場合だけ画像取得を開始する。準備中にLIMITEDになった場合はエラーを表示し、復帰後に再度ONする。
- ON後はLIMITEDでも画像取得・検出を継続する。SDK品質の低下により負荷が自動消失する条件を避ける。
- SDK報告のvideoサイズを維持し、画像縮小はしない。内部行列の取得経路も既存と同じ。センサーのネイティブ解像度や露光同期を保証するものではない。
- AprilTag・ArUcoを同じ画素で両方実行する。1・2・5Hzは投入間隔の上限であり、Worker実行中は追加投入しない。実効頻度は処理時間に依存する。
- OFFで新規読出し・投入を止め、保留結果を無効化する。既に実行中のWorker処理は終了まで負荷が残る。Workerは次のONのため保持し、カメラ停止時に破棄する。初回ONと再ONでは初期化負荷が異なる。
- 停止後にWorker準備が完了しても、世代管理で破棄し、検出を再開しない。

## JSON

schemaVersion 2、mode `sdk-staged-detection`、ファイル名 `audience-sdk-staged-detection-absolute-log.json`（尺度に応じてresponsive）。従来のSDK単独schema1は維持する。

- `experiment`: 初期OFF条件、両検出器、縮小なし方針、選択Hz・画面状態。
- `measurementSnapshot.experiment`: adapterの実際の検出有効状態、手動開始設定、要求Hz。
- `experiment.detector-preparing` / `experiment.detector-ready`: Worker準備開始／完了。
- `experiment.detection-enabled` / `experiment.detection-disabled`: ON/OFF時点のSDK状態・取得／検出カウンタのスナップショット。
- `experiment.worker-completed`: 500msの古さ判定より前に完了時刻、画像取得・グレースケール準備時刻、両検出器の処理時間、画像サイズ、取消済みかを記録。OFF後に終わった処理も区別できる。
- `fiducial.frame`: 配信できた結果、角座標、画像metadata、処理時間。遅すぎる結果は従来通り配信せず、完了記録とframe.droppedが残る。
- SDK生状態・姿勢・イベント、リング欠落件数は従来通り。summaryは最後のカメラ開始分、recordsとadapter集計はページ内通算。sessionIdで区別する。

ON直後のLIMITEDにはWorker初期化・readback・両検出処理などの複合要因がある。時刻を比較して候補を絞るが、単一試行で因果を断定しない。OFF後の回復や低頻度での再現性も確認する。このログで空間位置の精度・長期保持性能は判定できない。

## 軽い検証

ユーザー指定に従い回帰テストは追加・実行しない。一時スクリプトでモックSDK/GLを使用し、初期Worker生成・readbackゼロ、NORMAL後の遅延生成、SDK報告768×1024の維持、LIMITED中の取得、頻度gate、OFF後の結果破棄と完了記録、Worker準備中停止後の再有効化防止を確認した。スクリプトは実行後に削除する。これは実カメラ・GPUによる確認ではない。型検査・lint・本番ビルドを行い、全体品質ゲートは軽いデバッグ指定に従い実行しない。

型検査・lint・本番ビルドは成功。独立レビューで重大な問題なし。実機による切替時の品質確認は次のログ採取待ち。未コミット。
