# Unity presentation preview

`Assets/Scripts/PresentationRuntime/` は `Delivery`（配信検証）、`State`（受信状態）、`Transport`（接続）、`Persistence`（選択・cache）、`Rendering`（描画）、`Animation`、`Fixtures`、`Quest` に分けています。`PresentationBakedRuntime` はこれらを接続する入口で、`Generated` は生成専用です。EditMode テストは `Assets/Tests/EditMode/Editor/` 内で同じ責務ごとに分け、Quest の build hook は `Assets/Editor/Quest/`、Animation と Fixtures の Inspector は `Assets/Editor/PresentationRuntime/` の対応するディレクトリに置きます。

`Assets/Scenes/SampleScene.unity` は `LocalPresentationFixtureRunner` だけを表示経路として使用します。Play 開始時に `Resources/PresentationFixtures/LocalDelivery.json` と `LocalSnapshot.json` を読み込み、最初の Reliable Event を適用します。Editor では Space または Enter で後続イベントを進められます。

通信なしのQuest検証には `Unframe > ArUco > Open Presentation Test Scene` を使用します。共有マーカー校正、各端末のローカル操作、休止・追跡喪失後の再測定を検証する手順は [ローカルMR検証](docs/local-mr-verification.md) を参照してください。

現在の fixture はリポジトリに置いた protobuf JSON です。SampleScene にはサーバー接続や実機入力をまだ組み込んでいません。表示も `LocalPresentationPlaceholderRenderer` による仮表示です。

ローカル受信処理は Delivery の参照関係、Snapshot の投影情報と sequence、Reliable Event の連番を検証します。`LocalDelivery.json` の hash は動作確認用の値で、Asset URL も含まれていません。公開成果物の内容検証や Asset ダウンロードは行いません。現在の描画経路が受け付ける Delivery renderer は Native UI の仮表示です。

配信・実行は v2 契約のみを使用します。旧 JSON importer とサンプルは廃止し、v1 データの読み込み・変換、独立音声、ページ番号を直接指定する操作は提供しません。

`PresentationControlPlaneConnection` は、HTTPS Control Plane origin、Session ID、更新可能な認証 token provider を受け取り、POST Deliveryで `quest-baked-web-v1` を固定します。POST bootstrapとpublication / assignment / projectionを照合して `PresentationBakedRuntime` へ渡し、再接続時はcredentialを更新します。publication / projectionの変更ではDeliveryを再取得します。credentialはSceneやassetへ保存しません。

`PresentationRuntimeHost` は起動時に保存済みの全 Session 選択を読み、encoded PNG cache の durable pin を復元します。Delivery の検証後に選択情報と pin を更新し、その cache を Runtime へ渡します。保存するのは publication / assignment の識別情報と Asset の checksum・サイズ・MIME です。署名付き URL と認証 credential は保存しません。保存データの破損や更新失敗では接続を停止します。

ローカルの Session 選択を取り消す場合は `PresentationControlPlaneConnection.CancelLocalSelectionAsync` を呼びます。実行中の接続と Asset 処理の終了を待ってから、その participant の選択情報と durable pin を削除します。通常の再接続やアプリ終了では選択を保持します。

`PresentationBakedRuntime` はBaked Web PNGを検証して順番にRGBA32へuploadし、全selected textureのresidencyとControl / State同期が揃ってから入力を許可します。Surface crossfadeとTimelineはauthoritative Runtime clockで描画します。Native UI、Model、Video、Local Overlayはこの接続経路では受け付けません。managed dependencyの再現・checksum検査は [Plugins README](Assets/Plugins/README.md) を参照してください。

`Assets/Scenes/QuestPresentationScene.unity` は単一OVRCameraRig、PCA、ArUco校正、Baked Runtime、接続入口、Body Pose source、状態UIを配線した端末用Sceneです。`Unframe/Open Quest Presentation Scene` で配線を生成します。`QuestPresentationSession.Connect(controlPlaneOrigin, sessionId, credentialProvider, advanceLogicalEventName)` へHTTPS origin、Session ID、要求ごとに更新できるcredential provider、必要ならlogical event名を渡します。共有校正はマーカーから取得し、未確定でも認証・素材ロードを始められます。選択を切り替える際は入口の `StopAsync` の完了を待ってから再設定します。これらの値はSceneに保存しません。端末で一時検証するときはAndroid launch Intentの `unframe.controlPlaneOrigin`、`unframe.sessionId`、`unframe.credential`、必要なら `unframe.advanceLogicalEvent` から同じ入口を起動できます。校正JSONは不要です。Intentのcredentialは一時検証用で、期限をまたぐ更新は呼び出し元のproviderから行います。credentialをコマンド履歴・ログ・repositoryへ記録しないでください。

Sceneは `QuestPresentationBuild.BuildAndroid`（Unityメニュー `Unframe/Build Quest Presentation` またはEditorの `-executeMethod`）で選択してAndroid APKを作ります。build helperはAndroid Build Support、IL2CPP、ARM64を確認し、`Builds/QuestPresentation.apk` を出力します。8 GiB制限下のbuildでは、Editor起動時に `BEE_BUILD_THREADS=1 IL2CPP_ADDITIONAL_ARGS='--jobs=1 --bee-jobs=1'` を指定してAndroid arm64 APKの生成まで確認済みです。生成APKにはARM64のIL2CPP・Unity・OpenXR library、`BODY_TRACKING` 権限、`required=false` のbody tracking用 `uses-feature` 2件が含まれます。Quest実機での起動・動作は未検証です。

Presenterの追跡はXR tracking-originのHead/LeftHand/RightHandを取得し、OpenXR `XR_FB_body_tracking` が有効な場合にHips jointのBodyを取得します。Head/HandはXRの追跡状態とposition・rotationの取得が揃ったときに利用可能とします。Bodyはnative runtimeがactiveでHipsのposition・orientation両方のVALID bitが立つときに利用可能とし、TRACKED bitは必須にしません。runtimeが推定した有効なHips Poseも受け入れますが、Unity側でheadをBodyとして代用しません。AndroidのOpenXR Body featureは有効化済みで、manifestにMetaのinstall-time `BODY_TRACKING` 権限とbody tracking用の2つの `uses-feature` を宣言します。`uses-feature` は既存のBaked Viewerがインストール対象から外れないよう `required=false` です。取得できないtargetはcanonical identity Poseとavailability=falseを同じTracking frameで送って、Runtimeのmotion/dwellを取り消します。校正は `PresentationCalibrationState` が保持し、描画・入力・Trackingで共有します。再校正は接続を維持したまま明示的に確定し直します。追跡喪失・recenter・アプリpauseでは校正を無効化し、再測定まで描画と操作を止めます。右controllerのprimary buttonは指定したlogical event、左右triggerの押下開始はcontroller rayが現在StateのHit Regionに当たった場合だけSurface interactionを送ります。どちらもSessionReadyとAsset residencyが揃ってから送信し、押しっぱなしでは再送しません。Anchor-bound Node は fresh binding を受信するまで描画を開始せず、500 ms を超えた binding は失効します。

ローカルControl Planeから取得した実DeliveryのC# consumer admission、Editorの受信・描画テストを確認済みです。Editorのnative HTTP/2 handlerと生成C# clientでは、実TLS Realtimeへの証明書pin付き接続、Control Snapshot、StateReady、keyframe受信まで確認しています。別のEditor検証では、既定 `HttpClient` と通常の証明書検証で、default Fixed Browser buildの4枚のPNGを実HTTPSから取得し、encoded cache、texture residency、StateReadyまで確認しています。いずれもQuest実機のAndroid transport、入力、GPU / CPU peak、context lossの証拠にはなりません。

## Quest実機で残る受け入れ確認

1. Unity 6000.3.22f1のAndroid arm64 / OpenXR buildをQuestへ導入し、`nix shell --inputs-from . nixpkgs#android-tools --command adb devices` で端末が `device` と表示されることを確認する。接続先として、認証済みSessionのHTTPS Control Plane origin、Session ID、更新可能なcredential provider、端末から到達できるRealtime HTTPS endpointと有効な証明書、期限内のHTTPS PNG URLを持つ公開済みBaked Web Presentationを用意する。認証情報をSceneやrepositoryへ保存しない。
2. `QuestPresentationBuild.BuildAndroid` で専用SceneのAPKを作り、上記 `Configure` または一時検証Intentで起動する。Control Plane Delivery / bootstrap、Android native HTTP/2 Realtime、既定 `HttpClient` のAsset取得を同一Sessionで通す。
3. Deliveryで選ばれた全PNGについて、HTTPSの証明書検証、サイズ・MIME・checksum、encoded cacheのpin、順次decode / RGBA32 upload、CPU readback copy破棄、全textureのresidencyを確認する。Control / StateのSnapshotとreplayを適用して `StateReady` が送られるまで入力が無効であり、その後にState変更・crossfade・Timelineが正しい絵と順序で表示されることを確認する。再接続とアプリ再起動では同じSession選択、cache pin、fresh Snapshotへの復帰を確認する。
4. PresenterのQuest-local body / head / hand Poseと同じframeのcalibration、実機入力をadapterから送信し、Tracking Trigger、Anchor bindingの新鮮さ、Logical Eventの確定を確認する。未接続・stale anchorでは対象を描画しない。context lossなどでpinned textureのresidencyを失わせた場合は描画と入力が止まり、Control / Stateが `asset_residency_lost` で閉じることを確認する。
5. 端末、OS、Unity build、Presentation / Delivery hash、選択texture数と解像度、測定ツールと時刻を記録する。Deliveryのunique selected textureのdecoded GPU bytes合計とserial load CPU bytes最大値を[ADR-0012](../../docs/decisions/0012-texture-budget-residency-contract.md)の各256 MiB tier、encoded cacheを実際に設定したhard limit / reserve（baselineは4 GiB / 512 MiB）に照合する。別にpreload中の実CPU / GPU memory peak、upload peak、process / driver overhead、State変更・crossfade中の追加download / allocation、cacheの空き容量・evictionを計測する。実process peakをportable tierの256 MiBと直接比較して失格にしない。端末log、Realtime / Control Planeのfence・ready・disconnect記録、Profiler capture、画面記録を合否の証拠として残す。

これらの実機確認は未実施です。端末用SceneとPose / 入力adapterはEditorでの配線・契約検証まで完了しており、端末上の動作・性能測定は未検証です。

## ArUco・カメラの実機検証

`Assets/Scripts/MR/` は `Camera`（権限・映像取得・プレビュー）、`MarkerDetection`（マーカー検出・姿勢推定）、`Alignment`（原点確定・Presentation への接続）、`Diagnostics`（計測・ログ）に分けています。対応する EditMode テストは `Assets/Tests/EditMode/Editor/MR/` の同じ責務のディレクトリに置きます。MR の Editor 操作は `Assets/Editor/MR/` の `Camera`、`MarkerDetection`、`Alignment` に、ビルド設定・アセット除外処理は `Build` に置きます。座標契約から Unity への変換は `PresentationRuntime/Rendering/PresentationCoordinateAdapter.cs` が担います。

Quest のカメラ映像表示は、専用の `Assets/Scenes/PassthroughCameraDeviceTest.unity` で検証します。Unity の `Unframe > PCA > Open Device Test Scene` で開き、`Build and Run on Quest` で Android 実機へ起動できます。接続条件、カメラ権限、操作、ログ回収は [PCA 実機プレビュー手順](docs/pca-device-preview.md) を参照してください。

ArUco 検出は任意の有償依存 OpenCV for Unity を使用します。通常の checkout は依存なしでコンパイル・EditMode テストを実行できます。この状態ではカメラ映像表示と Presentation Runtime を利用できますが、ArUco パネルには `DISABLED` とセットアップ要件が表示され、検出・姿勢推定・マーカーからの原点確定は開始しません。OpenCV に依存しない原点・座標・Runtime のテストは常に実行します。OpenCV を直接使う検出・GPU・worker のテストと印刷マーカー生成メニューは有効化時にのみコンパイルします。

ArUco を実機で使用する開発環境では、ライセンスを持つ OpenCV for Unity を `Assets/OpenCVForUnity/` へ導入した後、Unity の `Project Settings > Player > Other Settings > Scripting Define Symbols` に `UNFRAME_OPENCV_FOR_UNITY` を追加します。Editor のテストに使う Standalone と実機 build に使う Android の両方へ追加し、再コンパイル後にテストと build を実行します。define の変更は各開発環境で設定し、`ProjectSettings/ProjectSettings.asset` のこの変更を commit しないでください。アドオンも Git の管理対象外です。アドオンを削除するときは先に define を外してください。define のみを設定してアドオンを導入していない環境はコンパイルエラーになります。

同じシーンで OpenCV for Unity の ArUco 検出・姿勢推定を実行します。`DICT_4X4_50` の ID 0、黒い正方形の一辺20cmを使用します。安定した原点を確定すると立方体と XYZ 軸を表示し、PCA 取得・検出を停止します。B/Y で再測定できます。[印刷マーカーと原点合わせの実機手順](docs/aruco-marker-detection.md) を参照してください。

端末の校正状態と通信Runtimeの接続方法は [Session校正](docs/session-calibration.md) を参照してください。
