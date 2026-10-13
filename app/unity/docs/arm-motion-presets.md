# 腕モーションによるローカル進行

UnityのUIプレビューは、24場面・25イベントの発表リハーサルを表示します。8種類の腕モーションは判定器で利用できますが、このプレゼンで使用するのは振り下ろし・右横振り・両手を広げる動作です。片腕の動作は左右どちらのコントローラーでも成立します。Presenterで校正が完了し、プレゼン開始後にのみ受け付けます。Audience・校正中・退出確認中・アニメーション中は認識履歴を破棄します。

| プリセット   | 動作                 |
| ------------ | -------------------- |
| SwipeLeft    | 腕を左へ振る         |
| SwipeRight   | 腕を右へ振る         |
| SwipeDown    | 腕を振り下ろす       |
| SwipeUp      | 腕を振り上げる       |
| PushForward  | 正面へ押し出す       |
| PullBackward | 手前へ引く           |
| SpreadHands  | 近い両手を広げる     |
| CloseHands   | 広げた両手を近づける |

## 設定と操作

`Unframe > UI > Open Presentation UI Preview` でシーンを開き、Presenterから `Unframe rehearsal` を選択します。マーカーを校正し、Start presentationで開始します。片腕の動作は、使用する手のトリガーを保持しながら動作します。両腕は左右どちらか1つ以上のトリガーを保持しながら両手を広げます。開始位置は押下時に固定されます。

| 場面 | 動作         | 演出                          |
| ---- | ------------ | ----------------------------- |
| 10   | 振り下ろす   | タイトルと5個の仮モデルが降下 |
| 14   | 振り下ろす   | 対象が上から現れる            |
| 15   | 右へ横振り   | 内容・モデルが横に切り替わる  |
| 16   | 両手を広げる | モデルを拡大                  |

その他はNext/Aで進行します。12のみ、文字の表示と指差し後のモデル移動にそれぞれ1回の操作を使います。モーション場面でもNext/Aで手動スキップできます。Xは最初から再生します。操作ごとにトリガーを離してください。UIクリックに使った右トリガーは離すまでモーションから除外します。詳細は [発表リハーサル](presentation-rehearsal.md) を参照してください。

正本は `Assets/Resources/MotionPresentation/MotionPresentationDefinition.json` の共有v2 Cue定義です。`Tools/generate-motion-presentation.ts` が既存CoreでCueとTimelineの実行を検証し、ローカル表示用のDelivery / Snapshot / Controlイベントと `LocalMotionPlan.json` を生成します。Sceneの準備は毎回この生成済みデータを割り当てます。Inspectorの `Cues` を独立して編集する運用にはしません。

リポジトリ直下から以下を実行できます。

```bash
pnpm --filter @unframe/contracts exec tsx ../../app/unity/Tools/generate-motion-presentation.ts
pnpm --filter @unframe/contracts exec tsx ../../app/unity/Tools/generate-motion-presentation.ts --check
pnpm --filter @unframe/contracts exec tsx --test ../../app/unity/Tools/motion-presentation.test.ts
```

`PresentationFixtures` の旧JSONは汎用の契約回帰テストとArUco診断に使用しており、通常のUIプレビューからは参照しません。

## 判定の既定値

- トリガー押下で開始位置と頭の向きを記録し、保持中に認識します。片腕は押した側の手、両腕は左右両方の位置を記録します。静止による自動開始は行いません。
- 片腕は0.28m以上、1.20秒以内、平均速度0.25m/s以上。指定方向からの横ずれは主方向の変位の65%以下。
- 両手は押下時から手間距離が0.20m以上広がる／縮まることで判定します。開始・終了の絶対的な手幅に制限はありません。制限時間2.00秒、手間距離の平均変化速度0.10m/s以上です。
- 両手は左右それぞれも初期中心から0.04m以上離れる／近づくことが必要です。左右が同じ移動量でなくても成立しますが、片手だけを動かしても成立しません。
- 水平方向は動作開始時の頭の向き、上下は重力方向を基準とします。頭と手の共通の平行移動を除外し、頭の向きだけを変えても進みません。
- 必要な追跡が失われる、無効な座標・時刻が入る、フレームが0.50秒を超えて欠ける場合は認識を中止し、トリガーを離して再び押す必要があります。

判定閾値は実機での調整前の既定値です。通常動作で誤進行しないこと、腕の可動範囲、左右手と両手の検知率をQuest実機で確認する必要があります。コントローラーの位置を使い、肘や肩の骨格は判定しません。

## モーションの診断UI

UIプレビューには `QuestArmMotionDebugView` の読み取り専用パネルがあります。リハーサルシーンでは標準で非表示です。必要ならInspectorの `Diagnostic Visible` を有効にします。表示位置は頭から右へ0.22m・上へ0.08m・前へ1.05mの位置へ表示します。開始・校正・退出の画面では非表示です。UIのボタンやポインター入力を受け取らず、10Hzで表示を更新します。不要になったら同コンポーネントの `Diagnostic Visible` を解除してください。

`Frames` が増えているか、`Gate` が `OPEN` か、`Trigger` に保持する手が表示され、`State` が `Moving` に進むかを順に確認します。`H` は頭、`L/R` は左右の手です。`Usable pose` は認識処理へ渡した追跡結果、各デバイス行はXRの取得値です。`tracked?` / `flags:?` はFeatureを取得できていないことを表します。`flags:PR` は位置・回転の両方が追跡中、`pos1 rot1` は各Poseの取得成功です。UIのポインターはOVRCameraRigのTransformで動くため、UIが操作できてもこれらがすべて成功しているとは限りません。

| 表示                                                   | 確認すること                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `buttons-held`                                         | A/B/X/Yボタンを離す。トリガーは保持して動作する                                              |
| `Trigger` / `waiting release`                          | 開始に使うトリガーと、再押下が必要かを確認する。`yes` の場合は左右のトリガーを離して再び押す |
| `ui-trigger-consumed`                                  | UIクリックに使った右トリガーを離し、UIから外れた場所で再び押す                               |
| `presentation-input-disabled` / `calibration-required` | Presenterで開始し、マーカー校正が完了していること                                            |
| `animation-running`                                    | Timelineが終了するまで待つ                                                                   |
| `HeadTrackingUnavailable` / `HandTrackingUnavailable`  | H/L/Rのvalid・tracked・flags・pos・rotを確認する                                             |

| `Moving / DistanceTooSmall` | 左右の移動量と必要距離を比較する |
| `WrongDirection` / `OffAxis` | 指定方向とDeltaの向き・軸外移動を確認する |
| `WindowExpired` / `SpeedTooLow` | 移動の時間窓と平均速度を確認する |
| `BothHandsMustMove` | 両手間の開始・現在距離、左右それぞれの移動量を確認する |
| `advance-rejected` | モーションは成立済み。`Error` にあるCue / Timeline対応やイベント受信の失敗を確認する |

`Last match` は成立回数と最後のTimeline再生結果を保持します。追跡やゲートで認識が停止してもPoseと押下ボタンの採取は続けます。開始位置はトリガー押下時に固定し、認識開始に静止条件を使いません。移動距離・速度・方向・時間窓の条件は残しています。

## 通信との境界

`ArmMotionRecognizer` は入力取得・UI・進行処理を持たない判定器です。`QuestLocalArmMotionControls` が既存のQuest Trackingから位置を取得し、既存のローカル進行権限に従って接続します。

共有 v2 の `motion` Trigger は `preset` と `eitherHand` / `bothHands` を指定でき、Realtime が既存の頭・左右手 Tracking から判定します。今回のトリガー保持操作はUnityローカルプレビューのみです。現在のTracking wireにはトリガーの押下状態がなく、Realtimeの判定は従来の静止による自動開始のままです。本番で同じ操作を使用するには、押下状態を伝える通信契約とサーバー判定の設計・実装が必要です。Cue の既存 Timeline Action でフェードなどを開始する構成は [データ契約](../../../docs/packages/DATA_MODEL.md#腕モーションからの演出開始) を参照してください。Unityから検知結果を汎用next入力として送ってサーバーのMotion判定を迂回する接続は追加していません。既存のTracking/Control wireとネットワーク入口は変更していません。

このローカルプレビューはDefinitionから生成したCue ID・Timeline IDを次のイベントと照合して再生します。生のDefinitionをUnityで実行するRuntimeや、Realtimeサーバーへの接続ではありません。描画は既存Native UIの仮表示で、公開用RenderBundle / AssetSet / Buildの生成を代替しません。Web Author の場面別選択 UI と、プリセット付き本番プレゼンの Quest 実機検証は未実施です。

## 検証状況

2026-10-09に24場面のリハーサル、トリガー操作、文字領域への収まりとGPU描画を含むUnity EditModeテスト585件が成功しました。生成一致・25イベントのCue進行・Protobuf JSON形式等のテスト6件、型チェック、フォーマットと `.meta` 整合性も成功しました。今回のリハーサルのAPK再ビルドとQuest実機確認は未実施です。既存APKにはこの変更が含まれないため、上記UIメニューから再ビルドが必要です。
