# Unity presentation runtime

Questアプリの操作・役割別UI・本番モーション案内は[アプリUI](docs/quest-app-ui.md)を参照してください。

正式な入口は `Unframe > Presentation > Open Quest Presentation` です。Playすると役割選択から始まります。認証・資料選択・参加とデバッグでの画面確認は[QuestアプリUI](docs/quest-app-ui.md)を参照してください。標準Buildも
`Assets/Scenes/QuestPresentationScene.unity` を使用します。コンパイラーからのビルド・公開・
Session接続は [本番プレゼンの手順](docs/production-presentation.md) を参照してください。

Authoring Source をビルドし、
公開済み成果物を Control Plane と Realtime から取得して表示します。Definition JSON を
単独で読み込む経路や、手動生成Packageの表示メニューは提供しません。

`Assets/Scripts/PresentationRuntime/` は `Delivery`（配信検証）、`State`（受信状態）、`Transport`（接続・HTTP素材取得）、`Persistence`（選択・cache）、`Rendering`（描画）、`Animation`、`Quest`、Editor専用の`EditorSupport` に分けています。`PresentationBakedRuntime` はこれらを接続する入口で、`Generated` は生成専用です。EditMode テストは `Assets/Tests/EditMode/Editor/` 内で同じ責務ごとに分け、Quest の build hook は `Assets/Editor/Quest/`、Animation の Inspector は `Assets/Editor/PresentationRuntime/` の対応するディレクトリに置きます。

`PresentationControlPlaneConnection` は、HTTPS Control Plane origin、Session ID、更新可能な認証 token provider を受け取り、POST Deliveryで `quest-presentation-v2` を指定します。POST bootstrapとpublication / assignment / projectionを照合して `PresentationBakedRuntime` へ渡し、再接続時はcredentialを更新します。publication / projectionの変更ではDeliveryを再取得します。credentialはSceneやassetへ保存しません。

`PresentationRuntimeHost` は起動時に保存済みの全 Session 選択を読み、encoded asset cache の durable pin を復元します。Delivery の検証後に選択情報と pin を更新し、その cache を Runtime へ渡します。保存するのは publication / assignment の識別情報と Asset の checksum・サイズ・MIME です。このcache metadataには署名付き URL と認証 credential を保存しません。アカウント認証の暗号化保存は[QuestアプリUI](docs/quest-app-ui.md)の接続設定を参照してください。保存データの破損や更新失敗では接続を停止します。

ローカルの Session 選択を取り消す場合は `PresentationControlPlaneConnection.CancelLocalSelectionAsync` を呼びます。実行中の接続と Asset 処理の終了を待ってから、その participant の選択情報と durable pin を削除します。通常の再接続やアプリ終了では選択を保持します。

`PresentationBakedRuntime` は共通の `PresentationSceneRenderer` で Baked Web PNG、Native UI（固定／string・boolean・number変数テキスト）、埋め込みGLB、H264動画を読み込みます。全素材のサイズ・checksum、描画・モデル・動画のresidency、Control / State同期が揃ってから入力を許可します。Surface crossfadeとTimeline、モデルclip、動画はauthoritative Runtime clockを使用します。Local Overlay、Native UIのellipsis・明示font fallback・step timerは受け付けません。managed dependencyの再現・checksum検査は [Plugins README](Assets/Plugins/README.md) を参照してください。

`Assets/Scenes/QuestPresentationScene.unity` は単一OVRCameraRig、PCA、AprilTag校正、Baked Runtime、接続入口、Body Pose source、状態UIを配線した端末用Sceneです。`Unframe/Presentation/Open Quest Presentation` で配線を生成します。`QuestPresentationSession.Connect(controlPlaneOrigin, sessionId, credentialProvider, advanceLogicalEventName)` へHTTPS origin、Session ID、要求ごとに更新できるcredential provider、必要ならlogical event名を渡します。共有校正はマーカーから取得し、未確定でも認証・素材ロードを始められます。選択を切り替える際は入口の `StopAsync` の完了を待ってから再設定します。これらの値はSceneに保存しません。Development Build の端末で一時検証するときはAndroid launch Intentの `unframe.controlPlaneOrigin`、`unframe.sessionId`、`unframe.credential`、必要なら `unframe.advanceLogicalEvent` から同じ入口を起動できます。校正JSONは不要です。通常のAPKではIntentの接続設定を読み取らず、アプリUIから参加します。Intent経路はcredentialを更新しません。更新が必要な接続では `Connect` に更新可能なcredential providerを渡します。credentialをコマンド履歴・ログ・repositoryへ記録しないでください。

Sceneは `QuestPresentationBuild.BuildAndroid`（Unityメニュー `Unframe/Presentation/Build Quest Presentation APK` またはEditorの `-executeMethod`）で選択してAndroid APKを作ります。build helperはAndroid Build Support、IL2CPP、ARM64を確認し、`Builds/QuestPresentation.apk` を出力します。8 GiB制限下のbuildでは、Editor起動時に `BEE_BUILD_THREADS=1 IL2CPP_ADDITIONAL_ARGS='--jobs=1 --bee-jobs=1'` を指定してAndroid arm64 APKの生成まで確認済みです。生成APKにはARM64のIL2CPP・Unity・OpenXR library、`BODY_TRACKING` 権限、`required=false` のbody tracking用 `uses-feature` 2件が含まれます。Quest実機での起動・動作は未検証です。

Presenterの追跡はXR tracking-originのHead/LeftHand/RightHandを取得し、OpenXR `XR_FB_body_tracking` が有効な場合にHips jointのBodyを取得します。Head/HandはXRの追跡状態とposition・rotationの取得が揃ったときに利用可能とします。Bodyはnative runtimeがactiveでHipsのposition・orientation両方のVALID bitが立つときに利用可能とし、TRACKED bitは必須にしません。runtimeが推定した有効なHips Poseも受け入れますが、Unity側でheadをBodyとして代用しません。AndroidのOpenXR Body featureは有効化済みで、manifestにMetaのinstall-time `BODY_TRACKING` 権限とbody tracking用の2つの `uses-feature` を宣言します。`uses-feature` は既存のBaked Viewerがインストール対象から外れないよう `required=false` です。取得できないtargetはcanonical identity Poseとavailability=falseを同じTracking frameで送ります。校正は `PresentationCalibrationState` が保持し、描画・入力・Trackingで共有します。再校正は接続を維持したまま明示的に確定し直します。追跡喪失・recenter・アプリpauseでは校正を無効化し、再測定まで描画・通常入力・Trackingを止めます。アプリが動作中は、校正が無効でも全体操作UIを利用できます。右controllerのprimary buttonは指定したlogical event、左右triggerの押下開始はcontroller rayが現在StateのHit Regionに当たった場合だけSurface interactionを送ります。どちらもSessionReadyとAsset residencyが揃ってから送信し、押しっぱなしでは再送しません。Anchor-bound Node は fresh binding を受信するまで描画を開始せず、通常の追跡 binding は500 msを超えると失効します。Snapshot と State keyframe の凍結 binding は期限で消さず、新しい sample または unavailable で通常状態へ戻します。

ローカルControl Planeから取得した実DeliveryのC# consumer admission、Editorの受信・描画テストを確認済みです。Editorのnative HTTP/2 handlerと生成C# clientでは、実TLS Realtimeへの証明書pin付き接続、Control Snapshot、StateReady、keyframe受信まで確認しています。別のEditor検証では、既定 `HttpClient` と通常の証明書検証で、default Fixed Browser buildの4枚のPNGを実HTTPSから取得し、encoded cache、texture residency、StateReadyまで確認しています。いずれもQuest実機のAndroid transport、入力、GPU / CPU peak、context lossの証拠にはなりません。

## Quest実機で残る受け入れ確認

1. Unity 6000.3.22f1のAndroid arm64 / OpenXR buildをQuestへ導入し、`nix shell --inputs-from . nixpkgs#android-tools --command adb devices` で端末が `device` と表示されることを確認する。接続先として、認証済みSessionのHTTPS Control Plane origin、Session ID、更新可能なcredential provider、端末から到達できるRealtime HTTPS endpointと有効な証明書、期限内のHTTPS PNG URLを持つ公開済みBaked Web Presentationを用意する。認証情報をSceneやrepositoryへ保存しない。
2. `QuestPresentationBuild.BuildAndroid` で専用SceneのAPKを作り、アプリUIから参加する。一時検証Intentは `QuestPresentationBuild.BuildDevelopment` で作成したDevelopment APKで使用する。Control Plane Delivery / bootstrap、Android native HTTP/2 Realtime、既定 `HttpClient` のAsset取得を同一Sessionで通す。
3. Deliveryで選ばれた全PNGについて、HTTPSの証明書検証、サイズ・MIME・checksum、encoded cacheのpin、順次decode / RGBA32 upload、CPU readback copy破棄、全textureのresidencyを確認する。Control / StateのSnapshotとreplayを適用して `StateReady` を送り、入力同期のREADYまで通常入力が無効であること、State変更・crossfade・Timelineが正しい絵と順序で表示されることを確認する。pause中の途中参加では凍結表示を維持し、再接続とアプリ再起動では同じSession選択、cache pin、fresh Snapshotへの復帰を確認する。
4. Presenter端末で8種類のGestureと腰位置のZone出入りを認識し、同期済みの開始文脈で送信してRuntimeがCueを確定することを確認する。再校正・世代変更では途中認識を破棄し、Zoneを無通知seedする。Quest-local body / head / hand Poseは同じframeのcalibrationとともに追従用に送り、Logical Eventの確定とAnchor bindingの新鮮さを確認する。未接続時や、凍結状態を持たないstale Anchorでは対象を描画しない。context lossなどでpinned textureのresidencyを失わせた場合は描画と入力が止まり、Control / Stateが `asset_residency_lost` で閉じることを確認する。
5. 端末、OS、Unity build、Presentation / Delivery hash、選択texture数と解像度、測定ツールと時刻を記録する。Deliveryのunique selected textureのdecoded GPU bytes合計とserial load CPU bytes最大値を[ADR-0012](../../docs/decisions/0012-texture-budget-residency-contract.md)の各256 MiB tier、encoded cacheを実際に設定したhard limit / reserve（baselineは4 GiB / 512 MiB）に照合する。別にpreload中の実CPU / GPU memory peak、upload peak、process / driver overhead、State変更・crossfade中の追加download / allocation、cacheの空き容量・evictionを計測する。実process peakをportable tierの256 MiBと直接比較して失格にしない。端末log、Realtime / Control Planeのfence・ready・disconnect記録、Profiler capture、画面記録を合否の証拠として残す。

これらの実機確認は未実施です。端末用SceneとPose / 入力adapterはEditorでの配線・契約検証まで完了しており、端末上の動作・性能測定は未検証です。

## Editor表示と回帰テスト

`nix run .#presentation-sample` と `Unframe > Presentation > Play Local Sample in Editor` で、
`examples/presentation` を正式コンパイル・公開し、通常のSession接続で表示できます。
手順と制約は[本番プレゼン](docs/production-presentation.md)を参照してください。
Web編集画面用の `Preview` は別の製品機能として維持します。

合成Delivery/Snapshotを直接適用する旧リハーサル、仮描画、旧ローカルUIとその専用Scene・生成器は削除しました。
旧プレゼン定義の原本は `AuthoringArchive/` に保管しています。
回帰試験のJSONとパーサーは `Assets/Tests/EditMode/Editor/FixturesData` と `Support` に置き、
実行コードやResourcesには含めません。テストデータをビルド時に退避する処理も不要です。

Unity Test RunnerのEditModeで回帰試験を実行してください。
`Sample/PresentationSampleServiceIntegrationTests` と `LocalEditorE2E` の実サービス試験には、
起動済みのサンプルサービスまたは各E2Eの接続情報が必要です。
Web Previewとnative Runtimeの自動検証コマンドは[scripts README](../../scripts/README.md#local-editor-と-unity)を参照してください。
Unity CIは静的チェックのみで、Editor試験やQuest実機試験を実行しません。

## AprilTag・カメラの実機検証

`Assets/Scripts/MR/` は `Camera`（権限・映像取得・プレビュー）、`MarkerDetection`（マーカー検出・姿勢推定）、`Alignment`（原点確定・Presentation への接続）、`Diagnostics`（計測・ログ）に分けています。対応する EditMode テストは `Assets/Tests/EditMode/Editor/MR/` の同じ責務のディレクトリに置きます。MR の Editor 操作は `Assets/Editor/MR/` の `MarkerDetection`、`Alignment` に、共通Scene生成・ビルド設定・アセット除外処理は `Build` に置きます。座標契約から Unity への変換は `PresentationRuntime/Rendering/PresentationCoordinateAdapter.cs` が担います。

Quest のカメラ映像表示とマーカー校正は `Assets/Scenes/AprilTagPresentationTest.unity` に集約しています。Unity の `Unframe > Diagnostics > AprilTag > Open Presentation Test Scene` で開き、`Build and Run Presentation on Quest` で Android 実機へ起動できます。接続条件、カメラ権限、操作、ログ回収は [PCA 実機プレビュー手順](docs/pca-device-preview.md) を参照してください。

AprilTag 検出は任意の有償依存 OpenCV for Unity を使用します。通常の checkout は依存なしでコンパイル・EditMode テストを実行できます。この状態ではカメラ映像表示と Presentation Runtime を利用できますが、AprilTag パネルには `DISABLED` とセットアップ要件が表示され、検出・姿勢推定・マーカーからの原点確定は開始しません。OpenCV に依存しない原点・座標・Runtime のテストは常に実行します。OpenCV を直接使う検出・GPU・worker のテストと印刷マーカー生成メニューは有効化時にのみコンパイルします。

AprilTag を実機で使用する開発環境では、ライセンスを持つ OpenCV for Unity を `Assets/OpenCVForUnity/` へ導入した後、Unity の `Project Settings > Player > Other Settings > Scripting Define Symbols` に `UNFRAME_OPENCV_FOR_UNITY` を追加します。Editor のテストに使う Standalone と実機 build に使う Android の両方へ追加し、再コンパイル後にテストと build を実行します。define の変更は各開発環境で設定し、`ProjectSettings/ProjectSettings.asset` のこの変更を commit しないでください。アドオンも Git の管理対象外です。アドオンを削除するときは先に define を外してください。define のみを設定してアドオンを導入していない環境はコンパイルエラーになります。

同じシーンで OpenCV for Unity の `ArucoDetector` に AprilTag `tag36h11` 辞書（`DICT_APRILTAG_36h11`）を設定して検出・姿勢推定を実行します。ID 0、黒い正方形の一辺15cm、白い余白込み22.5cmを使用し、観客向けWebの既定印刷マーカーと柄・向き・寸法を揃えています。WebのAprilTag 3 WASMとは検出実装が異なります。安定した原点を確定すると立方体と XYZ 軸を表示し、PCA 取得・検出を停止します。B/Y で再測定できます。[印刷マーカーと原点合わせの実機手順](docs/apriltag-marker-detection.md) を参照してください。

Unityのクラス名・Scene名・APK名・診断ログの保存先は `AprilTag` に統一しています。旧ArUco `DICT_4X4_50` の印刷マーカーは使用できません。AprilTagでのQuest実機精度・検出距離は未検証です。

端末の校正状態と通信Runtimeの接続方法は [Session校正](docs/session-calibration.md) を参照してください。

## Model / Video authoring example

[media-presentation](../../examples/media-presentation/README.md)をLocal Editorで開くと、同素材の2つのModel、音声付きVideoと操作Cueを使用できます。WebGLの音声開始はEditorの「再生」クリックでbrowser activationを取得します。再生拒否時はエラーを表示してLocalの時計を一時停止し、次の再生クリックで再試行できます。MP4 bytesは全選択素材を検証し、decoderとRenderTextureは現在Group / Surface Stateの動画だけを準備します。通常Runtimeは初回decoder準備をStateReady前に待ち、切替中は入力を止めてstate受信を続けます。GLB importer、VideoPlayer、RenderTexture、Blob URLはcandidateの破棄・表示切替・Runtime停止で解放します。Quest固有のGPU、decoder、音声出力は別の実機検証範囲です。

### 混在Surfaceの重なりと操作

PNG・Native UI文字・動画は、同じSemantic Surface内のLayer順序を共通の描画順位へ変換します。Native文字はTMPのレイアウトを使用し、矩形clipとopacityを反映したMeshで描画します。準備済みの動画もSemantic Surfaceの座標で操作判定を行い、表示不能・未準備の動画は入力対象にしません。

`PresentationMixedSurfaceTests`、`PresentationNativeSurfaceRenderingTests`、`PresentationMeshClipTests` が順位・操作・clipの回帰条件です。Quest実機での透明物重なりとコントローラー操作は別途確認が必要です。
