# PCA 実機映像プレビュー

`Assets/Scenes/ArucoPresentationTest.unity` は MRUK の `PassthroughCameraAccess` から左カメラの GPU テクスチャを取得して、ヘッドセット内のパネルへ表示します。カメラの許可状態、受信フレーム数、実際の解像度、カメラ FPS、撮影時刻を確認できます。OpenCV for Unity による ArUco ID・四隅検出も接続しています。検出テストは [ArUco 実機手順](aruco-marker-detection.md) を参照してください。ID 0・黒い一辺20cmのマーカーから位置・向きを推定し、安定した原点を確定するとPCA取得・検出を停止します。端末間同期は未実装です。

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

1. `Unframe > ArUco > Open Presentation Test Scene` を選ぶ。
2. `Unframe > ArUco > Build and Run Presentation on Quest` を選ぶ。
3. ヘッドセット内でこのアプリのカメラアクセスを許可する。
4. パネルが `LIVE` になり、頭を動かすとカメラ映像も変わり、フレーム数と撮影時刻が増えることを確認する。

`Unframe > ArUco > Build Presentation Test APK` は APK の生成だけを行います。出力は `app/unity/Builds/PCA/unframe-aruco-presentation.apk`、アプリ ID は `dev.unframe.pca.presentation`、アプリ名は `Unframe PCA Preview` です。ビルドにはこのテストシーンだけを渡します。ビルド後に元の application ID とアプリ名を復元します。APK 出力は Git 管理から除外されます。

ローカルの `DevAgentSettings.asset` がある状態で通常の Android Build を実行すると、APK へ Meta DevAgent の接続設定が混入しないようビルドを中断します。専用メニューからのビルドは、設定アセットを一時退避して APK から除外し、ビルド後に復元します。設定アセットがない場合と Android 以外のビルドにはこの制限は適用されません。

シーンの初期設定は左カメラ、1280 × 960、最大30カメラ FPSです。MRUK が別の解像度を選んだ場合、画面には実際の解像度を表示し、映像のアスペクト比を保ちます。

Android Manifest の `horizonos.permission.HEADSET_CAMERA` と Passthrough capability、および OculusProjectConfig の Passthrough/PCA 設定を有効にしています。Camera Rig には Passthrough を設定し、背景を透明にしています。権限の要求はプレビュー側が一箇所で行い、許可されるまで PCA コンポーネントを起動しません。

MRUK の Project Validation には Scene Support を `Required` にする提案が出ます。このシーンは部屋の Scene Model を使用せず、PCA のカメラ権限だけで動作します。専用メニューからの APK ビルドは Scene Support を無効のまま確認しています。

この専用ビルドでは、Meta DevAgent のローカル接続設定を APK へ含めないよう、設定アセットと `.meta` をビルド中だけ `Library/PcaBuildBackup/` へ退避し、終了時に復元します。

## 操作と確認項目

- **A / X**: 未校正時はカメラ権限を再確認・再要求する。校正後はAでローカルeventを進め、Xで先頭へ戻す。拒否後にダイアログが再表示されない場合は、Quest のアプリ設定でカメラアクセスを許可してから使う。
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
adb pull /sdcard/Android/data/dev.unframe.pca.presentation/files/ArucoDiagnostics ./pca-diagnostics
adb logcat -d -s Unity > ./pca-diagnostics/unity-logcat.txt
```

画面が黒い場合は、`LIVE` とフレーム数の増加があるかを先に確認します。`WAITING` / `STALLED` の場合は映像取得、`CAMERA PERMISSION REQUIRED` の場合は権限、`LIVE` で映像だけ黒い場合はレンダリングを調べます。

参考: [Meta PCA 導入ガイド](https://developers.meta.com/horizon/documentation/unity/unity-pca-documentation/)、[Meta の公式サンプル](https://github.com/oculus-samples/Unity-PassthroughCameraApiSamples)。

## 診断ビルドの軽量化

OpenCV for Unity の導入後は、一度 `Unframe > PCA > Prepare Fast Builds (Exclude OpenCV Samples)` を実行し、スクリプトのコンパイルが終わるのを待ちます。Examples のコード・Resources とサンプル StreamingAssets を、`Assets` 外の `LocalOnly/OpenCVForUnitySamples/` へ移します。OpenCV の本体と必要な native plugin は維持します。この保存先も Git 対象外で、有料アセットを配布しません。

元のサンプルを使うときは `Restore OpenCV Samples` で戻せます。元の場所と保存先の両方にファイルがある場合は上書きせず停止します。再インポートしたサンプルと保存済みサンプルを確認してから準備をやり直してください。ローカルMRと通信プレゼンの builder は、サンプルが `Assets` 内に残っている間は案内付きでビルドを拒否します。

CLIではEditorを閉じ、以下を実行してから専用APKをビルドします。

```sh
Unity -batchmode -quit -projectPath app/unity -buildTarget Android \
  -executeMethod OpenCvSampleBuildPreparation.PrepareSamples \
  -logFile /tmp/unframe-fast-build-prepare.log
```

専用ビルド中だけ IL2CPP code generation を `OptimizeSize`（コードサイズとビルド時間を優先）に設定し、終了時はアプリID・製品名・APK/AAB設定とともに復元します。C++ compiler configuration は変更しません。設定を切り替える初回はC++の再生成が必要なので、最初の一回は短縮しない場合があります。このモードではgenericコードの実行性能が変わる可能性があり、製品の最終性能評価には通常設定も使用してください。

Presentation Runtime と生成契約コードは `Unframe.Unity.PresentationRuntime` アセンブリへ分離しています。PCA側の変更で生成契約コードのC#コンパイルまでやり直す範囲を減らします。この分離は、プレゼン機能を専用ビルドから必ず除外するものではありません。

`Library/Bee` は増分ビルドのキャッシュです。毎回削除したり、Clean Buildを繰り返したりせず、同じ設定での2回目以降を比較してください。サンプル除外後の実際の短縮時間はAPKビルドで計測が必要です。
