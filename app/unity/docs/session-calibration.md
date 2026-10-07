# 端末校正とSession Runtime

`PresentationCalibrationState` は端末ごとの校正の正本です。確定済みのcanonical `presentationFromQuestLocal`、ローカルrevision、無効理由を保持します。ネットワークのPresentationOrigin version、publication、assignmentは変更しません。受信した校正値は厳密に検証してcloneし、不正な値を受け取っても確定済み校正を置き換えません。

## 座標と描画

`ArucoPresentationCalibration.Configure(alignment, questTrackingOrigin)` に確定マーカーのsourceとXRのtracking-origin Transformを渡します。ネットワークSceneでは単一の `OVRCameraRig.trackingSpace` を使用します。Head/HandのdevicePositionが属する座標frameと同じものを指定します。マーカーposeはUnity world座標です。

```text
presentationFromQuestLocal = inverse(worldFromPresentation) * worldFromQuestLocal
worldFromPresentation = worldFromQuestLocal * inverse(presentationFromQuestLocal)
worldFromNode = worldFromPresentation * presentationOrigin * nodeLocalChain
```

Unity / canonical間のZ反射は座標境界で行います。tracking-originの全祖先にunit scaleを要求し、非有限値、非unit quaternion、無効なframeを拒否します。

`PresentationBakedRuntime` は独立した `Calibrated Presentation Space` を所有し、校正の逆変換をworld poseへ適用します。RuntimeのPresentationOriginは生成階層だけに一度適用します。Runtime component自体は非表示にせず、接続・素材ロード・Runtime状態の受信を継続できます。校正が無効、同期未完了、素材未residentの間は生成spaceを非表示にします。

## 接続入口

呼び出し元は認証・Session選択を担当し、次のように同じStateを渡します。

```csharp
session.Connect(controlPlaneOrigin, sessionId, credentialProvider, advanceLogicalEventName);
```

`credentialProvider` は要求ごとに有効なcredentialを返します。credential、Session ID、endpointをSceneへ保存しません。校正がまだ無効でも接続・素材ロードを始められます。Presenterだけに入力・Trackingを許可しますが、Viewerにも自分の描画用校正が必要です。

`QuestPresentationSession` はSceneの校正sourceと通信入口が同じtrackingSpaceを使用することを確認し、共有Stateで接続します。校正値が未確定でも認証・素材ロードを開始できます。Android Intentでは `unframe.controlPlaneOrigin`、`unframe.sessionId`、`unframe.credential`、必要なら `unframe.advanceLogicalEvent` を読み、同じSession入口へ接続します。校正JSONは使用せず、マーカーを実際に測定します。Intent credentialは一時検証用で、端末認証UIとSession選択UIは未接続です。

## 無効化と再測定

- 明示reset、source disable・破棄、tracking喪失、tracking frame変更で校正を無効化します。
- Quest入口はHead tracking loss、XR tracking-origin更新、application pause、入口disableでも無効化します。
- 無効化時は描画・入力・Trackingを止め、待機中の入力・Tracking送信をcancelします。すでに通信へ書き出したcommandを取り消す処理ではありません。
- tracking復帰やapplication resumeだけでは旧校正を復活させません。共有Stateを外から無効化した場合もArUco sourceへ再測定を要求します。
- 確定後にマーカーが視野から外れても校正は保持します。tracking-originの座標frameが有効であることは引き続き必要です。
- `StateReady`送信後も現行cut / originの有効keyframeを受信するまで入力・Trackingを許可しません。再同期中も同じ条件を要求します。

`QuestPresentationEntry.Summary` は校正待ち、素材ロード、同期中、Readyのrole、停止状態を提供します。`QuestPresentationStatusView` はheadの右上に状態と再測定案内を表示し、B/Yの押下開始で共有校正を無効化します。UIはcredential、Session ID、endpoint、RPC詳細を表示しません。カメラpreviewは既存のA/X権限確認とB/Y再測定を提供します。

`Unframe/Open Quest Presentation Scene` は単一OVRCameraRig、PCA source、ArUco校正、Session入口、状態UIを配線します。通信SceneにはXROrigin、TrackedPoseDriver、AR Sessionを重ねません。Meta SDKのPCA撮影姿勢とHead/Handのtracking座標を同じrigへ揃えます。使用中のMRUKはnativeのtracking-space getterへOVRCameraRigを登録します。`PassthroughCameraAccess.GetCameraPose()` は撮影時刻のworld Poseを返すため、取得後にtrackingSpaceの変換を重ねません。配線済みのSceneは再生成せず開き、編集内容を保持します。生成Sceneは既存の `QuestPresentationBuild.BuildAndroid` でビルドします。通信APKでもローカルMeta DevAgent設定を除外し、正常・失敗の両方でasset、meta、preloaded assetsを復元します。OpenCVサンプルがimport済みならビルドを拒否するため、既存の `Unframe/PCA/Prepare Fast Builds (Exclude OpenCV Samples)` で除外します。

## 検証

EditModeで非identityのtracking frame・marker姿勢、逆変換、生成階層のOriginとの合成、共有Stateのclone・原子更新、reset・pause・source停止・frame変更、再確定、keyframe待機と再同期を検証します。ArUcoを利用する実機ではOpenCVの有効化が必要です。

2026-10-07の検証では通常構成436件、OpenCV有効構成461件のEditModeテストと、ビルド設定除外・復元の8件が通過しました。OpenCV有効・ARM64 IL2CPPで通信SceneのAPK生成に成功し、カメラ権限とOpenCV / OpenXR / IL2CPPのARM64 library、ローカル設定の復元を確認しました。

Questの両眼表示、tracking/recenter通知、2〜3台の同位置表示、Android transport、実メモリ使用量は実機で別途確認します。Editorテストを実機受け入れの代わりにはしません。

Presenter再校正直後は、再校正前のAnchor sampleが最大500 msの有効期間内に描画へ使われる可能性があります。現行State frameは端末校正revisionを識別しないため、厳密な排除にはTracking受理とState frameの対応を定義する契約変更が必要です。最初の複数台実証はAnchorに追従しない静的スライドで行い、Presenter Anchor追従の再校正は別途検証します。

## 複数台の最初の実証

1. サーバー担当がBaked Webの素材・Session・端末ごとの有効credentialを準備します。現時点では端末認証とSession選択は外部の呼び出し元または検証用Intentが担当します。
2. 各Questを同じSessionへ接続し、同じ物理ID 0マーカー（黒い正方形の一辺20 cm）を測定します。ArUcoはQuest 3/3SとPCA対応OS、OpenCV有効化を必要とします。
3. 校正確定後にReady表示を確認し、頭を動かして各端末で同じ位置にスライドが残ることを比較します。
4. Presenterのlogical eventを設定した場合は右controllerのprimary buttonで操作し、Viewerの表示が追従することを確認します。実証用Presentationに対応するevent定義が必要です。
5. 各端末でB/Y再測定、アプリpause/resumeを試し、校正が無効な間の表示・操作停止と、再測定後の復帰を確認します。

最初の実証は静的スライドを使用します。複数台での表示・同期の受け入れ結果はまだありません。
