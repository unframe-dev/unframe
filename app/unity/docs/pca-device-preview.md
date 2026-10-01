# PCA 実機映像プレビュー

`Assets/Scenes/PassthroughCameraDeviceTest.unity` は MRUK の `PassthroughCameraAccess` から左カメラの GPU テクスチャを取得して、ヘッドセット内のパネルへ表示します。カメラの許可状態、受信フレーム数、実際の解像度、カメラ FPS、撮影時刻を確認できます。OpenCV for Unity による ArUco ID・四隅検出も接続しています。検出テストは [ArUco 実機手順](aruco-marker-detection.md) を参照してください。ID 0・黒い一辺20cmのマーカーから位置・向きを推定し、安定した原点を確定するとPCA取得・検出を停止します。端末間同期は未実装です。

## 環境と接続

- Unity 6000.3.22f1、Meta XR Core SDK / MRUK 207.0.0。
- OpenCV for Unity を各開発環境の `Assets/OpenCVForUnity` に導入する。有料配布物と同梱サンプルは Git 管理から除外されており、このテストシーンをビルドする際にもローカル導入が必要。
- Unity Hub で Android Build Support、Android SDK & NDK Tools、OpenJDK を導入する。
- Quest 3 / 3S、Horizon OS 74 以降。Android の Standalone APK でテストする。Mac の Editor では映像取得を開始せず、実機ビルドの案内を表示する。
- Quest の開発者モードを有効にし、USB で接続してヘッドセット内の USB デバッグ許可を承認する。
- Unity の Build Profiles で Android を Active にし、Run Device に接続した Quest を選ぶ。

Unity に同梱された ADB は、macOS の標準インストールでは次の場所にあります。ターミナルから確認する場合は PATH を設定します。

```sh
export PATH="/Applications/Unity/Hub/Editor/6000.3.22f1/PlaybackEngines/AndroidPlayer/SDK/platform-tools:$PATH"
adb devices -l
```

端末の状態が `device` になることを確認します。`unauthorized` の場合はヘッドセット内の USB デバッグ許可を確認し、一覧に出ない場合は USB ケーブルと開発者モードを確認します。

## ビルドと起動

1. `Unframe > PCA > Open Device Test Scene` を選ぶ。
2. `Unframe > PCA > Build and Run on Quest` を選ぶ。
3. ヘッドセット内でこのアプリのカメラアクセスを許可する。
4. パネルが `LIVE` になり、頭を動かすとカメラ映像も変わり、フレーム数と撮影時刻が増えることを確認する。

`Unframe > PCA > Build Device Test APK` は APK の生成だけを行います。出力は `app/unity/Builds/PCA/unframe-pca-preview.apk`、アプリ ID は `dev.unframe.pca.preview`、アプリ名は `Unframe PCA Preview` です。ビルドにはこのテストシーンだけを渡します。ビルド後に元の application ID とアプリ名を復元します。APK 出力は Git 管理から除外されます。

シーンの初期設定は左カメラ、1280 × 960、最大30カメラ FPSです。MRUK が別の解像度を選んだ場合、画面には実際の解像度を表示し、映像のアスペクト比を保ちます。

Android Manifest の `horizonos.permission.HEADSET_CAMERA` と Passthrough capability、および OculusProjectConfig の Passthrough/PCA 設定を有効にしています。Camera Rig には Passthrough を設定し、背景を透明にしています。権限の要求はプレビュー側が一箇所で行い、許可されるまで PCA コンポーネントを起動しません。

MRUK の Project Validation には Scene Support を `Required` にする提案が出ます。このシーンは部屋の Scene Model を使用せず、PCA のカメラ権限だけで動作します。専用メニューからの APK ビルドは Scene Support を無効のまま確認しています。

この専用ビルドでは、Meta DevAgent のローカル接続設定を APK へ含めないよう、設定アセットと `.meta` をビルド中だけ `Library/PcaBuildBackup/` へ退避し、終了時に復元します。

## 操作と確認項目

- **A / X**: カメラ権限を再確認・再要求する。拒否後にダイアログが再表示されない場合は、Quest のアプリ設定でカメラアクセスを許可してから使う。
- **B / Y**: 許可されたカメラを再起動する。
- **WAITING**: 許可済みで最初のフレームを待っている。
- **LIVE**: 新しい撮影時刻のフレームを受信している。
- **STALLED**: 起動後10秒間フレームが届かない、または受信後2秒間更新が止まった。古い映像は表示しない。Console / Logcat の SDK エラーを確認し、B / Y で再起動する。
- **UNSUPPORTED**: PCA が使えない端末または OS。

カメラアクセスを拒否した場合、許可後の再試行、ホーム画面へ移動した後の復帰、ヘッドセットを外した後の復帰も確認します。PCA の pause/resume は MRUK に任せ、プレビューは復帰時に古いフレームの正常判定を破棄します。

## 診断ログ

起動・権限・状態遷移と、1秒ごとの解像度/FPS/撮影時刻/内部パラメーターを `Application.persistentDataPath/ArucoDiagnostics/` の JSON Lines に記録します。画像の保存や送信は行いません。ファイル名はヘッドセット内のパネル、完全なパスは `[ArucoTracking] Diagnostic log:` の Console / Logcat 行で確認できます。

通常の Quest 保存先から回収する例です。実際のログ行のパスが異なる場合は、そちらを使用します。

```sh
mkdir -p ./pca-diagnostics
adb pull /sdcard/Android/data/dev.unframe.pca.preview/files/ArucoDiagnostics ./pca-diagnostics
adb logcat -d -s Unity > ./pca-diagnostics/unity-logcat.txt
```

画面が黒い場合は、`LIVE` とフレーム数の増加があるかを先に確認します。`WAITING` / `STALLED` の場合は映像取得、`CAMERA PERMISSION REQUIRED` の場合は権限、`LIVE` で映像だけ黒い場合はレンダリングを調べます。

参考: [Meta PCA 導入ガイド](https://developers.meta.com/horizon/documentation/unity/unity-pca-documentation/)、[Meta の公式サンプル](https://github.com/oculus-samples/Unity-PassthroughCameraApiSamples)。
