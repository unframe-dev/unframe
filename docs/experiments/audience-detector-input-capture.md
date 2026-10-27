# 検出入力画像を含む診断JSON

> 履歴（2026-10-22）：現在の実装は[AprilTag採用方式](./audience-apriltag-adopted.md)のみ。以下は当時の方式・スキーマ・実証の記録であり、削除済みの比較モードやコマンドを現行仕様として使用しない。

2026-10-21。別環境でAprilTagの検出が0件、ArUcoの向きが揺れた報告を受け、実際に検出器へ渡した画像を同じフレームの結果と保存できるようにした。原因を照明・反射・SDK・姿勢計算のいずれかへ断定していない。

## 操作

anchor/tagいずれもカメラを開始し、問題が出ている間に「検出入力画像付きJSONを保存」を押す。未検出0件でも、Worker結果が配信されていれば有効。停止後にも最後のフレームを保存できる。新たにカメラを開始すると前の画像を破棄する。検出結果が一度も返っていなければボタンは無効で、通常ログを保存して起動状態・取得・Workerエラーを確認する。

保存は単一JSON。PNGと原グレー画素を埋め込むので、iOSで画像とJSONを複数ファイルとしてダウンロードする必要がない。通常ログボタンには画像を含めない。保存する画像には会場や人が映る場合があるため画面にも明記。自動アップロードはしない。

## 内容

anchor schema18 / tag schema10。top-level `detectorInput`へ次を格納する。

- captureVersion 1、frameId、captureSessionId、capturedAtMs、sourceVideoTime、receivedAtMs、ageAtExportMs。
- width/height、intrinsics、sdkFromCamera、captureMetadata。callback時刻と露光時刻の同期は従来通り未確認。
- pixelFormat: gray8-top-left-row-major。`grayPixelsBase64`を復号するとwidth×heightバイトの元の検出画素になる。縮小・JPEG圧縮・描画重畳を行わない。
- `pngDataUrl`: 同じグレー画素をR/G/Bへ複製しAlpha255でPNG化した閲覧用画像。overlaysIncluded:false。通常の比較canvasをスクリーンショット保存したものではない。
- result: 両検出器の結果形式とexecutedフラグ、復号したIDと角、処理時間。anchorの未選択側はexecuted:false。未実行と正常0検出を区別できる。
- localization: 同一フレームの姿勢採否と候補診断。

通常と同じJSON本文に設定・マーカー実寸・選択検出器・engine版・adapter measurementSnapshot・records・リング欠落数を同梱する。ファイル名はaudience-anchor-input-s{session}-f{frame}.jsonまたはaudience-tag-input-s{session}-f{frame}.json。

## 保持と限界

結果が配信された最新の1フレームと結果だけをrefで保持し、PNG/Base64は保存操作時に生成する。通常の各フレームで画素を追加コピーしない。frame-sourceは毎回新しいUint8Arrayを生成する。anchorの転送画素はWorkerから返却され元frame.pixelsへ復元された後に保持するため、検出中にdetachされたバッファを保存しない。

これは最後の配信結果の画像であり、ボタンを押した瞬間のカメラ画像ではない。500ms以上の遅延で棄却された入力・Worker失敗時の入力は含まない。最新画像が古い場合はageAtExportMsで判別する。未実行・エラー・古さ棄却はsnapshotのカウンタとrecordsを確認する。リングから対応frame行が欠落しても、detectorInput自身に元の結果・設定識別情報は残る。

## 軽い確認

ユーザー指定に従い回帰テストは追加・実行しない。既知のグレー値0/64/128/255がBase64から完全一致で復号されること、PNG入力のRGBA値・不透明度、元バッファを変更しないこと、frame/session ID・未検出・未実行フラグを保持すること、無効サイズを拒否することをモックcanvasで確認した。これは実ブラウザPNGエンコーダー・iPhone保存の実機確認ではない。型検査・lint・ビルドを実施し、全体品質ゲートは軽いデバッグ指定に従い未実施。

型検査・lint・本番ビルドは成功。独立レビューで修正必須の問題なし。HTTPS配信のentry JavaScriptと最終ビルドの一致を確認した。実機PNG保存・回帰テスト・全体品質ゲートは未確認／未実施。未コミット。
