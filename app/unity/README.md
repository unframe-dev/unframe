# Unity presentation preview

`Assets/Scenes/SampleScene.unity` は `LocalPresentationFixtureRunner` だけを表示経路として使用します。Play 開始時に `Resources/PresentationFixtures/LocalDelivery.json` と `LocalSnapshot.json` を読み込み、最初の Reliable Event を適用します。Editor では Space または Enter で後続イベントを進められます。

現在の fixture はリポジトリに置いた protobuf JSON です。Web の編集データから Delivery を生成する処理、サーバーからの Delivery 取得、実機入力との接続はまだありません。表示も `LocalPresentationPlaceholderRenderer` による仮表示です。

ローカル受信処理は Delivery の参照関係、Snapshot の投影情報と sequence、Reliable Event の連番を検証します。`LocalDelivery.json` の hash は動作確認用の値で、Asset URL も含まれていません。公開成果物の内容検証や Asset ダウンロードは行いません。現在の描画経路が受け付ける Delivery renderer は Native UI の仮表示です。

`Assets/Scripts/PresentationImport/` と `Resources/PresentationSamples/` は旧 JSON schema 用の移行中の実装とサンプルとして残っていますが、SampleScene からは起動しません。

Quest のカメラ映像表示は、専用の `Assets/Scenes/PassthroughCameraDeviceTest.unity` で検証します。Unity の `Unframe > PCA > Open Device Test Scene` で開き、`Build and Run on Quest` で Android 実機へ起動できます。接続条件、カメラ権限、操作、ログ回収は [PCA 実機プレビュー手順](docs/pca-device-preview.md) を参照してください。

同じシーンで OpenCV for Unity の ArUco 検出・姿勢推定を実行します。`DICT_4X4_50` の ID 0、黒い正方形の一辺20cmを使用します。安定した原点を確定すると立方体と XYZ 軸を表示し、PCA 取得・検出を停止します。B/Y で再測定できます。[印刷マーカーと原点合わせの実機手順](docs/aruco-marker-detection.md) を参照してください。
