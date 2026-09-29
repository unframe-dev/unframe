# Unity presentation preview

`Assets/Scenes/SampleScene.unity` は `LocalPresentationFixtureRunner` だけを表示経路として使用します。Play 開始時に `Resources/PresentationFixtures/LocalDelivery.json` と `LocalSnapshot.json` を読み込み、最初の Reliable Event を適用します。Editor では Space または Enter で後続イベントを進められます。

現在の fixture はリポジトリに置いた protobuf JSON です。Web の編集データから Delivery を生成する処理、サーバーからの Delivery 取得、実機入力との接続はまだありません。表示も `LocalPresentationPlaceholderRenderer` による仮表示です。

`Assets/Scripts/PresentationImport/` と `Resources/PresentationSamples/` は旧 JSON schema 用の移行中の実装とサンプルとして残っていますが、SampleScene からは起動しません。
