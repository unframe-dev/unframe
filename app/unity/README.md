# Unity presentation preview

`Assets/Scenes/SampleScene.unity` は `LocalPresentationFixtureRunner` だけを表示経路として使用します。Play 開始時に `Resources/PresentationFixtures/LocalDelivery.json` と `LocalSnapshot.json` を読み込み、最初の Reliable Event を適用します。Editor では Space または Enter で後続イベントを進められます。

現在の fixture はリポジトリに置いた protobuf JSON です。SampleScene にはサーバー接続や実機入力をまだ組み込んでいません。表示も `LocalPresentationPlaceholderRenderer` による仮表示です。

ローカル受信処理は Delivery の参照関係、Snapshot の投影情報と sequence、Reliable Event の連番を検証します。`LocalDelivery.json` の hash は動作確認用の値で、Asset URL も含まれていません。公開成果物の内容検証や Asset ダウンロードは行いません。現在の描画経路が受け付ける Delivery renderer は Native UI の仮表示です。

`Assets/Scripts/PresentationImport/` と `Resources/PresentationSamples/` は旧 JSON schema 用の移行中の実装とサンプルとして残っていますが、SampleScene からは起動しません。

`PresentationControlPlaneConnection` は、HTTPS Control Plane origin、Session ID、更新可能な認証 token provider を受け取り、POST Deliveryで `quest-baked-web-v1` を固定します。POST bootstrapとpublication / assignment / projectionを照合して `PresentationBakedRuntime` へ渡し、再接続時はcredentialを更新します。publication / projectionの変更ではDeliveryを再取得します。credentialはSceneやassetへ保存しません。

`PresentationRuntimeHost` は起動時に保存済みの全 Session 選択を読み、encoded PNG cache の durable pin を復元します。Delivery の検証後に選択情報と pin を更新し、その cache を Runtime へ渡します。保存するのは publication / assignment の識別情報と Asset の checksum・サイズ・MIME です。署名付き URL と認証 credential は保存しません。保存データの破損や更新失敗では接続を停止します。

ローカルの Session 選択を取り消す場合は `PresentationControlPlaneConnection.CancelLocalSelectionAsync` を呼びます。実行中の接続と Asset 処理の終了を待ってから、その participant の選択情報と durable pin を削除します。通常の再接続やアプリ終了では選択を保持します。

`PresentationBakedRuntime` はBaked Web PNGを検証して順番にRGBA32へuploadし、全selected textureのresidencyとControl / State同期が揃ってから入力を許可します。Surface crossfadeとTimelineはauthoritative Runtime clockで描画します。Native UI、Model、Video、Local Overlayはこの接続経路では受け付けません。managed dependencyの再現・checksum検査は [Plugins README](Assets/Plugins/README.md) を参照してください。

Presenter は `SendTrackingAsync` へ canonical Quest-local Pose と同じ frame の calibration を渡して State stream へ送信できます。frame sequence は接続が割り当てます。Pose の実機取得と校正は呼び出し元が行い、body target には body の Pose を渡します。Anchor-bound Node は fresh binding を受信するまで描画を開始せず、500 ms を超えた binding は失効します。

ローカルControl Planeから取得した実DeliveryのC# consumer admission、Editorの受信・描画テストを確認済みです。Editorのnative HTTP/2 handlerと生成C# clientでは、実TLS Realtimeへの証明書pin付き接続、Control Snapshot、StateReady、keyframe受信まで確認しています。Quest実機のAndroid native HTTP/2、GPU / CPU peakとcontext lossは未検証です。

既定 `HttpClient` による実 HTTPS Asset 取得の Editor 検証は、ローカル検証用 CA が UnityTLS に信頼されず TLS 検証で失敗しました。この経路の PNG ダウンロード、cache、residency、StateReady は未確認です。システムの信頼設定や証明書検証は変更していません。
