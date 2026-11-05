# 端末校正とSession Runtime

## 採用済みの変更と適用範囲

[ADR-0027](../../../docs/decisions/0027-presenter-recognition-and-runtime-authority.md) により、Presenter の再校正では server の入力世代も更新し、状態同期後に Gesture の新しい動作を待ち、Zone を現在位置から無通知で初期化します。送信済みの旧世代入力も server が採用しません。`QuestPresentationEntry` は校正変更時に待機入力と認識状態を破棄し、再校正 command と入力同期を通してこの処理を行います。

Session の pause は共有演出を停止する操作であり、端末のアプリ休止・校正無効化とは区別します。有効な校正の下では、pause 時の凍結位置で表示を保持し、HMD 視点と操作 UI を更新します。無効な座標変換のまま描画を継続する規則ではありません。

## 現行実装

`PresentationCalibrationState` は端末ごとの校正の正本です。確定済みのcanonical `presentationFromQuestLocal`、ローカルrevision、無効理由を保持します。ネットワークのPresentationOrigin version、publication、assignmentは変更しません。受信した校正値は厳密に検証してcloneし、不正な値を受け取っても確定済み校正を置き換えません。

## 座標と描画

`AprilTagPresentationCalibration.Configure(alignment, questTrackingOrigin)` に確定マーカーのsourceとXRのtracking-origin Transformを渡します。ネットワークSceneでは単一の `OVRCameraRig.trackingSpace` を使用します。Head/HandのdevicePositionが属する座標frameと同じものを指定します。マーカーposeはUnity world座標です。

```text
presentationFromQuestLocal = inverse(worldFromPresentation) * worldFromQuestLocal
worldFromPresentation = worldFromQuestLocal * inverse(presentationFromQuestLocal)
worldFromNode = worldFromPresentation * presentationOrigin * nodeLocalChain
```

Unity / canonical間のZ反射は座標境界で行います。tracking-originの全祖先にunit scaleを要求し、非有限値、非unit quaternion、無効なframeを拒否します。

`PresentationBakedRuntime` は独立した `Calibrated Presentation Space` を所有し、校正の逆変換をworld poseへ適用します。RuntimeのPresentationOriginは生成階層だけに一度適用します。Runtime component自体は非表示にせず、接続・素材ロード・Runtime状態の受信を継続できます。校正が無効、同期未完了、素材未residentの間は生成spaceを非表示にします。

## Presenter の共有配置

初回の配置では、Stage の原点 `[0, 0, 0]` をマーカー位置に置いた状態から、マーカー確定時の HMD の高さより鉛直方向に30cm下となるよう原点だけを上下させます。原点の物理空間 X/Z、補正前の回転、スケールは維持します。HMD の向きへ回転させたり、マーカーの傾きを除去したりしません。資料の中心や個々の要素の位置・寸法は高さ補正に使用しません。

現在の原点のワールド位置を `P`、HMD のワールド位置を `H` とすると、補正後は `P' = P + worldUp * (H.y - P.y - 0.30m)` です。再配置でも同じ式を使い、現在の水平位置と回転を維持します。初期原点の位置がゼロなら、`P` はマーカー位置なので、補正量は HMD とマーカーの高さの差から30cmを引いた値になります。

物理マーカーの完全な Pose は端末校正に保持します。Presenter は高さ補正後の絶対 Pose をマーカー座標へ変換し、共有 `PresentationOrigin` としてサーバーへ送ります。マーカーが傾いている場合は、マーカー座標の X/Z 成分にも鉛直移動が現れますが、物理空間の水平位置は変わりません。Viewer / Audience は受信した Pose を適用します。サーバーで受理されるまで配置は未確定です。配置基準点や資料の bounds は使用しません。

原点がすでに設定された Session への参加・再接続では既存の共有配置を使います。再計算は Presenter の明示的な「再配置」でマーカーを測定し直したときに行います。頭部移動、マーカーの一時的な消失、tracking 復旧に伴う端末の再校正では共有配置を変更しません。Viewer は自分の高さから補正を計算しません。

`stage.placementReferencePoint` と Delivery catalog の配置基準点は契約上保持しますが、Quest の高さ補正では参照しません。ビルド・公開時の既存の配置基準点・モデル bounds の検証は変更していません。今回の修正による契約変更、資料の再公開、Session の作り直しは不要です。確定済みの共有配置を新しい高さ補正で更新する場合は、Presenter が「再配置」を行います。

更新には期待する原点 version と command ID を付けます。通信失敗時は同じ command を再送し、原点 version の競合時は Snapshot を再取得してマーカーの再測定を要求します。校正が無効になった場合も未確定の計測値と command を破棄します。共有原点は Reliable Event と Snapshot で配信され、途中参加・再接続でも復元します。原点更新後はローカル状態への反映と新しい cut の `StateReady`、Presenter の入力同期の完了を待ちます。通常の原点更新では `CommandEpoch` は増えません。Tracking は原点 version を付けて送り、サーバーが共有原点の逆変換で Stage 座標へ変換します。pause 中の凍結 Anchor も物理位置を維持する座標へ変換し直して配信します。

## 接続入口

呼び出し元は認証・Session選択を担当し、次のように同じStateを渡します。

```csharp
session.Connect(controlPlaneOrigin, sessionId, credentialProvider);
```

`credentialProvider` は要求ごとに有効なcredentialを返します。credential、Session ID、endpointをSceneへ保存しません。校正がまだ無効でも接続・素材ロードを始められます。Presenterだけに入力・Trackingを許可しますが、Viewerにも自分の描画用校正が必要です。

`QuestPresentationSession` はSceneの校正sourceと通信入口が同じtrackingSpaceを使用することを確認し、共有Stateで接続します。校正値が未確定でも認証・素材ロードを開始できます。Development Build のAndroid Intentでは `unframe.controlPlaneOrigin`、`unframe.sessionId`、`unframe.credential` を読み、同じSession入口へ接続します。校正JSONは使用せず、マーカーを実際に測定します。通常のAPKはIntentの接続設定を読み取りません。Intent credentialは一時検証用です。通常の端末認証・資料選択・参加は[QuestアプリUI](quest-app-ui.md)を使用します。

## 無効化と再測定

- 明示reset、source disable・破棄、tracking喪失、tracking frame変更で校正を無効化します。
- Quest入口はHead tracking loss、XR tracking-origin更新、application pause、入口disableでも無効化します。
- 無効化時は描画・入力・Trackingを止め、待機中の入力・Tracking送信をcancelします。すでに通信へ書き出したcommandを取り消す処理ではありません。
- tracking復帰やapplication resumeだけでは旧校正を復活させません。共有Stateを外から無効化した場合もAprilTag sourceへ再測定を要求します。
- 確定後にマーカーが視野から外れても校正は保持します。tracking-originの座標frameが有効であることは引き続き必要です。
- 稼働中は `StateReady` 送信後も現行 cut / origin の有効 keyframe を受信するまで入力・Tracking を許可しません。pause 中は keyframe が配信されないため、確定した Reliable 状態で表示と Resume / End を許可します。

`QuestPresentationEntry.Summary` は校正待ち、素材ロード、同期中、Readyのrole、停止状態を提供します。`QuestPresentationStatusView` は操作メニューに状態と再測定案内を表示し、B/Yの押下開始で端末の校正を無効化し、Presenter は共有配置の再測定も要求します。UIはcredential、Session ID、endpoint、RPC詳細を表示しません。カメラpreviewは既存のA/X権限確認とB/Y再測定を提供します。

`Unframe/Presentation/Open Quest Presentation` は単一OVRCameraRig、PCA source、AprilTag校正、Session入口、状態UIを配線します。通信SceneにはXROrigin、TrackedPoseDriver、AR Sessionを重ねません。Meta SDKのPCA撮影姿勢とHead/Handのtracking座標を同じrigへ揃えます。使用中のMRUKはnativeのtracking-space getterへOVRCameraRigを登録します。`PassthroughCameraAccess.GetCameraPose()` は撮影時刻のworld Poseを返すため、取得後にtrackingSpaceの変換を重ねません。配線済みのSceneは再生成せず開き、編集内容を保持します。生成Sceneは既存の `QuestPresentationBuild.BuildAndroid` でビルドします。通信APKでもローカルMeta DevAgent設定を除外し、正常・失敗の両方でasset、meta、preloaded assetsを復元します。OpenCVサンプルがimport済みならビルドを拒否するため、既存の `Unframe/Tools/OpenCV/Prepare Fast Builds (Exclude OpenCV Samples)` で除外します。

## 検証

RealtimeのControl接続はState handshakeとStateReady送信が完了するとRuntimeControlを送信できます。Pause中はサーバーがState keyframeを送らないため、PresenterのResume／Endは校正やkeyframeの受信を必要としません。LogicalInput・SurfaceInteraction・Trackingは引き続き校正と現行keyframeを必要とします。Control接続が失効した場合はRuntimeControlも停止します。

EditModeで非identityのtracking frame・marker姿勢、逆変換、生成階層のOriginとの合成、共有Stateのclone・原子更新、reset・pause・source停止・frame変更、再確定、keyframe待機と再同期を検証します。AprilTagを利用する実機ではOpenCVの有効化が必要です。

Native EditorのサービスE2EとShowcaseは、テスト用の共有校正を明示的に設定し、描画・カメラの対象に独立した`PresentationSpace`を使用します。テスト用校正はtracking frameからworld原点への変換を計算するため、Runtimeのhostが非identityでも従来のカメラ配置を維持します。隔離プロジェクトを作る`test-native-editor.sh`も、校正・trackingの共通コードとXR組込みモジュールを含めます。これは実機のマーカー測定を代替するものではありません。

2026-10-07の検証では通常構成436件、OpenCV有効構成461件のEditModeテストと、ビルド設定除外・復元の8件が通過しました。OpenCV有効・ARM64 IL2CPPで通信SceneのAPK生成に成功し、カメラ権限とOpenCV / OpenXR / IL2CPPのARM64 library、ローカル設定の復元を確認しました。

Questの両眼表示、tracking/recenter通知、2〜3台の同位置表示、Android transport、実メモリ使用量は実機で別途確認します。Editorテストを実機受け入れの代わりにはしません。

Presenter の再校正・再同期では入力 context を更新し、認識状態をリセットします。pause 中の凍結 Anchor と再開後の fresh sample の扱いは[配信・実行契約](../../../docs/packages/CONTRACT_RUNTIME.md)に従います。実機の校正精度と追跡復帰は別途確認します。

## 複数台の最初の実証

1. サーバー担当がBaked Webの素材・Session・端末ごとの有効credentialを準備します。通常の参加は[QuestアプリUI](quest-app-ui.md)、一時検証はDevelopment Buildの上記Intent入口を使用します。
2. 各Questを同じSessionへ接続し、同じ物理ID 0マーカーを測定します。黒い正方形の一辺500・400・250・150mmから、印刷物に一致する寸法を位置合わせ画面で選択します（既定150mm）。Audience WebXRも同じ寸法を選びます。AprilTagはQuest 3/3SとPCA対応OS、OpenCV有効化を必要とします。
3. 校正確定後にReady表示を確認し、頭を動かして各端末で同じ位置にスライドが残ることを比較します。
4. Presenterのlogical eventを設定した場合は右controllerのprimary buttonで操作し、Viewerの表示が追従することを確認します。実証用Presentationに対応するevent定義が必要です。
5. 各端末でB/Y再測定、アプリpause/resumeを試し、校正が無効な間の表示・操作停止と、再測定後の復帰を確認します。

最初の実証は静的スライドを使用します。複数台での表示・同期の受け入れ結果はまだありません。
