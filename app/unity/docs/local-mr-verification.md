# サーバーなしでのQuest校正検証

`ArucoPresentationTest` はカメラ映像、マーカー検出、原点合わせを確認する診断シーンです。認証・Session・サーバー接続は不要です。旧 Delivery / Snapshot fixture のプレゼン表示・ページ送りは提供しません。公開した資料の表示・操作は[本番プレゼン](production-presentation.md)で確認してください。

## 準備と確認

1. Quest 3 / 3S とコントローラーを用意し、[OpenCVとPassthrough Cameraの設定](../README.md#arucoカメラの実機検証)を行います。
2. ArUco `DICT_4X4_50` の ID 0 マーカーを、黒い正方形の一辺20cmで印刷します。
3. Unity で `Unframe > Diagnostics > ArUco > Open Presentation Test Scene` を開き、`Build Presentation Test APK` または `Build and Run Presentation on Quest` を実行します。生成先は `Builds/PCA/unframe-aruco-presentation.apk` です。
4. 実機でカメラ権限を許可し、マーカーを測定します。校正後の原点表示が、頭を動かしても同じ場所に保たれることを確認します。
5. B/Y で再測定し、追跡喪失・再センタリング・アプリ休止後に再測定が必要になることを確認します。

マーカー検出には OpenCV for Unity と Android の `UNFRAME_OPENCV_FOR_UNITY` が必要です。複数台を比較する場合はマーカーを固定し、各端末で同じ位置から測定します。端末数、位置・向きのずれ、両眼表示、追跡復帰時の挙動を記録してください。診断シーンでの位置合わせは、Session の同期や資料の描画・操作の検証とは別です。
