# マーカー原点とプレゼン表示の接続

20cmのID 0マーカーで端末を位置合わせし、Delivery v2のローカルfixtureを配置する検証シーンです。通常のSampleSceneとPCAカメラ診断シーンは別に保持します。実際のSurface artifact描画・サーバー通信・複数端末同期・authoritative hit-testはこのシーンでは実装していません。表示は既存のDelivery placeholder rendererです。

## 座標と状態の責務

[ADR-0010](../../../docs/decisions/0010-spatial-surface-coordinate-contract.md)に従い、portable local TRSはメートル・右手系です。Unity境界で位置 `(x,y,-z)`、回転 `(-x,-y,z,w)` を一度だけ適用し、scaleは維持します。有限値・float範囲・Quaternionのunit length（許容差1e-9）とcanonical signを検証し、不正な入力を補正して受け入れません。Node状態とTimelineに同じ変換を使用します。

```text
Marker Presentation Controller（常に動作するRunnerとBinding）
Presentation Space（端末のworldFromPresentation、Unity world座標）
└─ Stage（RuntimeのpresentationOrigin.poseをUnity座標へ変換）
   └─ Presentation Nodes（stage/nodeのローカルTRSとTimeline）
```

このローカル検証では、マーカー中心をPresentation Spaceの基準点と定義します。マーカーの+Xは右、+Yは上、Unityの+Zは紙の裏方向です。端末で得た `ArucoOriginAlignment.OriginPose` は変換済みUnity world poseであり、再度Z反転しません。表示の合成順は `worldFromPresentation * presentationFromStage * nodeLocalChain` です。Bindingは外側とStageのscaleを1に保ち、ノード固有のscaleには触れません。

`presentationOrigin.pose` はStageからPresentation Spaceへの配置として適用します。端末の再位置合わせは外側のローカル補正だけを変更し、共有 `presentationOrigin.version` を変更しません。将来のParticipantCalibration通信やcalibrationRevisionの発行は未実装です。

SnapshotはOrigin pose/versionを必須として検証し、fenceのversionと一致した場合だけ状態全体を受け取ります。`PresentationOriginChanged` は現在より大きいversionとその新versionのfenceを持つeventだけを受け取り、State Frame sequenceをリセットして新しいkeyframeを要求する状態へ戻します。通常event・State Frame・Projection Advanceは保持中のOrigin versionとの一致が必要です。不正な入力は既存の状態やsequenceを変更しません。新versionのOriginChanged fenceの扱いはこのconsumerの検証規則であり、実サーバー接続時にも確認が必要です。

未整列・追跡喪失・原点解除・Alignmentの無効化や破棄・Runtime Snapshot未受信時にはPresentation Spaceだけを非表示にします。Runnerを非表示対象の子に置かず、進行・Timeline・Runtime状態は維持します。再整列時に最新の位置とRuntime状態で表示を戻します。Runtimeの `active / visible` をローカル整列状態で書き換えません。

`SpatialParent.presenter_anchor` は現在のFactoryが拒否します。身体追従は将来Presentation Space下にStageと独立したbranchを設け、fresh bindingとversionの一致を確認する必要があります。この検証でstage/node配置を身体追従として代用しません。

## 実機で確認する

1. `Unframe > ArUco > Open Presentation Test Scene` で `ArucoPresentationTest` を準備する。
2. `Build and Run Presentation on Quest` を実行する。Android IL2CPP / ARM64が必要です。ローカル認証設定はPCA専用builderと同じ除外処理を経由します。
3. 20cmマーカーで `ALIGNED` になるまで静止する。確定前はプレゼン非表示、確定後はマーカー基準のfixture表示になる。
4. 頭を動かし、マーカーを隠しても配置が保たれることを確認する。
5. コントローラーの人差し指トリガーでローカルfixtureの次のeventへ進む。編集中のKeyboard入力は既存RunnerのSpace/Enterです。
6. B/Yで再測定する。非表示になり、新しいマーカー位置で確定後に再表示されることを確認する。追跡喪失・休止・再センタリングも確認する。

アプリIDは専用ビルド中だけ `dev.unframe.pca.presentation` とし、PCA診断アプリと通常アプリを置き換えません。APKは `Builds/PCA/unframe-aruco-presentation.apk` に生成します。

## CLI検証

Editorを閉じてから、Unity executableへ以下を渡します。

```sh
Unity -batchmode -quit -projectPath app/unity -buildTarget Android \
  -executeMethod ArucoPresentationTestEditor.PrepareScene -logFile /tmp/unframe-origin-scene.log

Unity -batchmode -projectPath app/unity -buildTarget Android \
  -runTests -testPlatform EditMode \
  -testResults /tmp/unframe-origin-tests.xml -logFile /tmp/unframe-origin-tests.log

Unity -batchmode -quit -projectPath app/unity -buildTarget Android \
  -executeMethod ArucoPresentationTestEditor.BuildApk -logFile /tmp/unframe-origin-build.log
```

GPUを使用する既存テストがあるため `-nographics` は付けません。EditModeテストは非identityのマーカーとRuntime originの合成、Z反射、scale維持、原点version、不正Snapshotのatomic拒否、未整列・再整列・追跡喪失とシーン参照を確認します。Questのカメラ精度や描画負荷は実機確認が必要です。
