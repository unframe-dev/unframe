# Gesture・演出の接続

Source の Gesture と演出 Action を Compiler が正式契約へ変換し、Realtime が Cue の選択と演出の寿命を管理する。Unity と Audience は Runtime の状態を描画 API に渡す。

## Source と Runtime

Gesture は既存8種類に `throw`／`circle` を追加した。Source の `trigger: { kind: "gesture", gesture: "throw" }` または `gesture: "circle"` で指定し、他の Gesture と同じ Cue の設定・送信形式を使用する。Quest は現在の認識カタログに含まれる候補だけを認識し、捕捉開始時の InputContext を既存 GestureInputCommand 経路へ渡す。Throw／Circle と既存 Gesture が競合する場合は専用認識器を優先する。UI 操作、追跡喪失、入力同期・校正・Step の変更は捕捉を破棄する。

Source の `effect.start` は `effectId`、対象 `nodeId`、`owner`、`seed`、`effect` を指定する。`effect.stop` は `effectId` で停止する。同じ effectId の実行中の再起動は拒否するため、複数の演出には別の ID を付ける。同時に保持できる演出 Run は最大32件。同じ Node の Dissolve は別 ID でも同時に開始できない。

`effect` の共通設定は `size`、`color`（red／green／blue／alpha）、`speed`、`durationMilliseconds`。`kind: "wave"` は `waveCycles`（0〜6）、`kind: "handGlow"` は `hand`（left／right）も指定する。Dissolve は `kind: "dissolve"`。型と検証は [正式契約](../packages/contracts/src/presentation/effects.ts) を参照する。

Runtime は実行 ID、開始 Runtime 時刻、対象、設定、seed、active／retained 状態を `effectRuns` に保持する。Snapshot、Checkpoint、Step 開始状態に保存し、Replay は `EffectRunsChanged` と RuntimeView の置換で復元する。重複配送は既存の Command ID による結果再利用で抑止する。pause 中は共有 Runtime 時計が止まり、演出も進まない。

演出対象を含む投影は `EFFECT_PLAYBACK` Capability を要求し、非対応クライアントの Control 接続を拒否する。この Capability を要求しない投影には `EffectRunsChanged` を配信しない。Anchor または HandGlow が追跡入力を使う投影は、必要な target を `trackedPoseTargets` に宣言し、`TRACKED_POSE_DELIVERY` も要求する。

演出の実効時間は共通で ceil(durationMilliseconds / speed) ミリ秒。

- Wave は実効時間で伸び切り、retained になる。明示停止、Group 所有なら所属 Group の終了、または Presentation 終了まで保持する。Presentation 所有の Run は Group を越えて残る。
- HandGlow は実効時間で完了する。再接続では以前の手軌跡を復元せず、新しく届いた有効 Pose から残光を再開する。
- Dissolve は実効時間で完了するとサーバーが対象 Node の visible を false にする。途中の停止は素材を復元する。Step を復元すると、その Step 開始時の表示状態と Run を復元する。

## 描画と手の座標

[Unity API](../app/unity/Assets/Scripts/VisualEffects/README.md) と [Web API](../app/web/audience/src/visual-effects/README.md) は通信から独立している。接続層が Node ID を Transform／Object3D に解決し、共有時計で更新する。Run の消失、対象の変更、Scene の破棄、切断で描画資源を解放する。

追跡入力は `trackedPoses` で target ごとに配送する。Anchor はこの Pose から親 Transform を作り、HandGlow は指定した左右の手の位置を直接使う。HandGlow の対象 Node は Stage 配下でもよく、手の Anchor Node は不要。Delivery は投影内の Anchor と演出から必要な target を重複なく導出する。

ライブ Pose は元 TrackingFrame の sequence とサーバーの観測時刻を持ち、クライアントでも受信後の経過を含めて500msで失効する。重複・古い sequence を新しい残光として追加しない。pause／resume、再校正、再同期、assignment 変更や再接続ではライブ入力と軌跡を破棄し、新しい入力から再開する。`frozenAnchors` は Node ごとの表示専用状態で、追跡入力や演出には使わない。

認識のサンプル時刻は秒、描画はミリ秒。Unity 認識器には Unity 座標を渡す。TrackingFrame は Quest local Pose と校正を送り、サーバーが投影する追跡 Pose は Stage local 座標になる。Unity の HandGlow は world 座標、Web は対象のローカル座標へ変換する。seed は再現性のために使うが、Unity と Web のピクセル一致は保証しない。

## 検証と受入

契約・Compiler、Runtime の入力から Cue／Snapshot／Checkpoint／Replay、Quest の捕捉、両描画アダプターを対象テストで確認する。

指定 Unity 6000.3.27f2 の本プロジェクト EditMode、および Quest／スマートフォンでの認識品質、見た目、性能は実機受入が必要。Throw／Circle と既存 Gesture の競合、重複・遅延、pause／resume、Step 復元、途中参加・再接続を含めて確認する。自動テストだけで実機受入済みとは扱わない。

Unity Dissolve の対象は不透明な静的モデルの基本色・テクスチャで、PBR 全属性は保持しない。透明素材・SkinnedMesh は対象外。両端は非対応の対象ではその Run の描画を行わず、通信と他の演出を継続する。Dissolve 完了時のサーバーによる非表示は適用される。

## ジェスチャーの周期位置出力

Throw／Circle の有効な Step では `QuestPresentationEntry.GesturePositionSampleReady` から左右の位置サンプルを受け取れる。間隔は `GesturePositionSampleIntervalSeconds`（既定0.05秒）で調整し、通信自体はこの通知で実行しない。座標・時刻・InputContext と通知寿命は [認識README](../app/unity/Assets/Scripts/VisualEffects/Gestures/README.md) を参照する。`QuestPresentationEntry` は同じ Update 内の通知を集約し、通常の0.1秒送信と共通の TrackingFrame 送信枠を使う。通知の既定間隔は0.05秒で、間隔を短くしてもサーバーの90Hz上限を超えて送信しない。送信中の通知は蓄積せず、次の有効な通知または通常周期で最新の XR Pose を採取する。

通知位置を Quest local 座標として送信したり、通知時刻を Runtime 時刻へ直接変換したりしない。TrackingFrame は Quest local Pose、校正変換、端末の Stopwatch 時刻に加え、採取時の入力同期 epoch と適用済み Reliable sequence を送り、サーバーが Stage local 座標と受信時刻へ対応付ける。サーバーは同期世代または RuntimeView 置換より前のフレームを破棄する。再同期・再校正・切断時は未送信の通知を破棄する。再接続後は新しいフレームから Anchor と描画を再開し、過去の軌跡は再送しない。
