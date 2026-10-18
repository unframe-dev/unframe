# ArUco Quest 実機テスト準備

## 現在の範囲

この手順は、カメラ・検出・位置推定の不具合を診断ログで切り分けるためのものです。[PCA 映像表示テスト](pca-device-preview.md)にカメラ取得と ArUco ID・四隅検出を接続しています。印刷マーカーによる確認は [ArUco 検出手順](aruco-marker-detection.md) を参照してください。ID 0・黒い一辺20cmのマーカーの位置姿勢推定と原点確定を実装しています。端末間同期は未実装です。

Unity プロジェクトは Unity 6000.3.22f1 です。`Packages/manifest.json` では Meta XR Core SDK / MRUK を 207.0.0 に固定しています。OpenCV for Unity は有料アセットとして各開発環境で導入し、配布物と同梱サンプルは Git 管理から除外します。PCA 映像表示シーンは MRUK を使い、`horizonos.permission.HEADSET_CAMERA` を宣言・要求します。Scene API の `USE_SCENE` 権限は、この映像表示テストには不要です。

## 診断ログ

`ArucoTrackingDiagnosticSession` を ArUco テストシーンのルートに追加すると、起動時に `ArucoTrackingDiagnostics.CreateForCurrentDevice()` を呼び、`Application.persistentDataPath/ArucoDiagnostics/` にセッションごとの UTF-8 JSON Lines (`.jsonl`) ファイルを作ります。アプリの pause / resume とシーン終了も記録します。検出器は同じコンポーネントの `Diagnostics` プロパティからイベントを記録します。Unity Console にファイルパスも出します。各行にはスキーマ版、セッション ID、連番、UTC 時刻、単調経過時間、Unity / アプリ版、プラットフォーム、端末モデル、OS を記録します。端末固有 ID は記録しません。

カメラ連携側から `Record` に以下のイベントを渡します。

- `permission_result`、`camera_state`、`camera_frame_summary`
- `marker_detection`、`marker_detection_error`
- `pose_estimated`、`alignment_confirmed`、`alignment_reset`
- マーカー ID、辞書名、画像解像度、読み戻し要求時点の撮影時刻、四隅の画像座標、検出処理時間、GPU 読み戻し時間

`pose_estimated` はカメラ相対姿勢、撮影時のカメラworld姿勢、マーカーworld姿勢、再投影誤差、追跡可否を記録します。`alignment_confirmed` は安定した原点の確定、`alignment_reset` は再測定への切り替えを記録します。プレゼンテーション相対 Quest 姿勢のフィールドは未接続です。

`camera_frame_summary` は 1 Hz、検出結果は ID の変化時および同じ ID が続く間の 1 Hz に間引きます。状態遷移とエラーは都度記録します。画像そのものは保存しません。診断ログはイベントごとにフラッシュするため、アプリが中断しても直前の記録が残ります。セッション終了時は `Dispose` を呼んで `session_end` を記録します。

## 実機が使える段階での確認順

参考: [Meta Passthrough Camera API](https://developers.meta.com/horizon/documentation/unity/unity-pca-documentation/) / [OpenCV ArUco 姿勢推定](https://docs.opencv.org/4.11.0/d5/dae/tutorial_aruco_detection.html)

1. Meta XR Core SDK / MRUK のバージョンを固定し、Unity Editor でパッケージの解決と Android ビルドを確認する。
2. `horizonos.permission.HEADSET_CAMERA` の manifest 宣言と実行時許可要求を追加し、拒否・再許可・設定からの再許可をそれぞれログに残す。Scene API の部屋モデル用権限で代用しない。
3. Quest 3 / 3S 実機で Passthrough Camera API の画像、解像度、内部パラメーター、撮影時刻、カメラ姿勢を記録する。XR Simulator は実カメラの検証に使わない。
4. 実測した一辺の長さを設定した印刷マーカーを用意し、検出 ID、角、推定姿勢、再投影誤差をログに記録する。生画像を保存する必要がある場合は、別途、明示的な診断オプションを設ける。
5. 原点確定後にマーカーを隠し、頭を動かして立方体の固定を確認する。B/Y・再センタリング・トラッキング復帰で再測定できることを確認する。

## Quest からログを回収

Unity Console の `[ArucoTracking] Diagnostic log:` 行で、ビルドが使用する実際の保存先を確認します。Quest を USB 接続して `adb devices` で認識された後、表示された `ArucoDiagnostics` ディレクトリを `adb pull` します。Android のアプリ ID と保存先はビルド設定や Unity のバージョンで変わるため、固定パスを仮定せず、端末上の `Application.persistentDataPath` を使ってください。

```sh
adb pull <Application.persistentDataPath>/ArucoDiagnostics ./aruco-diagnostics
adb logcat -d -s Unity > ./aruco-diagnostics/unity-logcat.txt
```

ログを共有する前に、端末モデル・OS・時刻などの診断情報を含むことを確認してください。生画像は含みません。
