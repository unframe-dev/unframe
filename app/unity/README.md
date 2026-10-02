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

ローカルControl Planeから取得した実DeliveryのC# consumer admission、Editorの受信・描画テストを確認済みです。Editorのnative HTTP/2 handlerと生成C# clientでは、実TLS Realtimeへの証明書pin付き接続、Control Snapshot、StateReady、keyframe受信まで確認しています。別のEditor検証では、既定 `HttpClient` と通常の証明書検証で、default Fixed Browser buildの4枚のPNGを実HTTPSから取得し、encoded cache、texture residency、StateReadyまで確認しています。いずれもQuest実機のAndroid transport、入力、GPU / CPU peak、context lossの証拠にはなりません。

## Quest実機で残る受け入れ確認

1. Unity 6000.3.22f1のAndroid arm64 / OpenXR buildをQuestへ導入し、`nix shell --inputs-from . nixpkgs#android-tools --command adb devices` で端末が `device` と表示されることを確認する。接続先として、認証済みSessionのHTTPS Control Plane origin、Session ID、更新可能なcredential provider、端末から到達できるRealtime HTTPS endpointと有効な証明書、期限内のHTTPS PNG URLを持つ公開済みBaked Web Presentationを用意する。認証情報をSceneやrepositoryへ保存しない。
2. `PresentationControlPlaneConnection.RunAsync` に `PresentationBakedRuntime` を渡す端末用Sceneまたは一時検証fixtureを用意し、Control Plane Delivery / bootstrap、Android native HTTP/2 Realtime、既定 `HttpClient` のAsset取得を同一Sessionで通す。現行 `SampleScene` はこの経路を起動しないため、Sceneへの接続と実機Pose / 入力adapterの用意が先に必要である。端末用build / deployを自動化するrepository commandも現時点ではない。
3. Deliveryで選ばれた全PNGについて、HTTPSの証明書検証、サイズ・MIME・checksum、encoded cacheのpin、順次decode / RGBA32 upload、CPU readback copy破棄、全textureのresidencyを確認する。Control / StateのSnapshotとreplayを適用して `StateReady` が送られるまで入力が無効であり、その後にState変更・crossfade・Timelineが正しい絵と順序で表示されることを確認する。再接続とアプリ再起動では同じSession選択、cache pin、fresh Snapshotへの復帰を確認する。
4. PresenterのQuest-local body / head / hand Poseと同じframeのcalibration、実機入力をadapterから送信し、Tracking Trigger、Anchor bindingの新鮮さ、Logical Eventの確定を確認する。未接続・stale anchorでは対象を描画しない。context lossなどでpinned textureのresidencyを失わせた場合は描画と入力が止まり、Control / Stateが `asset_residency_lost` で閉じることを確認する。
5. 端末、OS、Unity build、Presentation / Delivery hash、選択texture数と解像度、測定ツールと時刻を記録する。Deliveryのunique selected textureのdecoded GPU bytes合計とserial load CPU bytes最大値を[ADR-0012](../../docs/decisions/0012-texture-budget-residency-contract.md)の各256 MiB tier、encoded cacheを実際に設定したhard limit / reserve（baselineは4 GiB / 512 MiB）に照合する。別にpreload中の実CPU / GPU memory peak、upload peak、process / driver overhead、State変更・crossfade中の追加download / allocation、cacheの空き容量・evictionを計測する。実process peakをportable tierの256 MiBと直接比較して失格にしない。端末log、Realtime / Control Planeのfence・ready・disconnect記録、Profiler capture、画面記録を合否の証拠として残す。

これらの実機確認は未実施です。端末用SceneとPose / 入力adapterも未接続であり、現在のEditor成功を実機合格として扱いません。
