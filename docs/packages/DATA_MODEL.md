# Presentation データ契約 v2

## 正本と読み方

v2 は今回の機能範囲に対するデータ契約である。構造は Zod / Protobuf、構造だけでは表せない参照整合性・計算・状態遷移・拒否条件は以下の仕様を正本とする。両方を満たして初めて有効なデータとなる。

| 対象                                                                    | 構造の正本                                                                           | 意味規則                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------- |
| Definition / RenderBundle / AssetSet / Build / Publication / Capability | [Zod v2](../../packages/contracts/src/presentation/index.ts)                         | [成果物契約](./CONTRACT_ARTIFACTS.md)   |
| 配信と再接続に共通の型                                                  | [presentation v2](../../packages/contracts/proto/unframe/presentation/runtime.proto) | [配信・実行契約](./CONTRACT_RUNTIME.md) |
| DeliveryManifest                                                        | [delivery v2](../../packages/contracts/proto/unframe/delivery/delivery.proto)        | 同上                                    |
| Command / Event / Run / Snapshot / StateFrame                           | [realtime v2](../../packages/contracts/proto/unframe/realtime/realtime.proto)        | 同上                                    |

型・意味規則が旧 Architecture の例や初期 v1 と異なる場合は、この v2 契約を優先する。Architecture と ADR は設計理由を説明する。v1 は初期 subset の履歴であり、現在の静的 Compiler / Core は v2 だけを生成・検証する。Delivery / Runtime / Unity の接続は別途必要である。

M3A は Theme と Structured composition の静的 `baked-web` 経路を v2 へ接続する。その authoring と compile-time 解決規則は [M3A Structured Authoring Contract](./AUTHORING_CONTRACT.md) を正本とする。この接続は CLI / reference project まで実装され、動的機能と consumer 接続は後続に残る。

## 情報の配置

```text
PresentationDefinition
├─ schemaVersion / presentationId / metadata
├─ stage: coordinateSystem / size / zones
├─ scene: nodes / surfaces
└─ flow: initialGroupId / groups / variables / timelines

RenderBundle          描画成果物、モデル素材と clip の対応、build provenance
AssetSetManifest      Asset ID → checksum / mediaType / encodedSizeBytes
BuildManifest         一回の build が生成した上記成果物の hash と version
PublishedPresentation 公開 epoch と build の固定参照
DeliveryManifest      参加者・端末別に選択した公開物と取得情報
Runtime State         進行・変数・Node・再生・遷移の現在値
```

Definition にダウンロード URL、端末 capability、現在の再生時刻を入れない。AssetSet に自身の hash を入れず、公開物がその canonical hash を参照する。配信 URL の更新は公開された素材の identity を変えない。

## 採用範囲

- 3D は Native 3D、静的・有限 State の UI は baked-web、連続更新は限定 Native UI の短文・数値・timer、事前計算した内部アニメーションは Video。
- 任意の HTML / JS を実行する WebView、独立音声・BGM・効果音・空間音声は対象外。Video 内の音声は動画と一体で再生する。
- モデルは通常一 clip、crossfade 中だけ二 clip。部位 mask / layer / additive は対象外。モデル内部の姿勢と空間 Node の TRS を分離する。
- Surface State は固定した内容ツリーへの型付き override。Node の追加・削除・並べ替えは行わない。

採用理由は [描画方式](../decisions/0014-presentation-rendering-scope.md)、[成果物境界](../decisions/0015-presentation-definition-artifact-boundaries.md)、[モデルアニメーション](../decisions/0016-model-animation-scope.md) を参照する。

## 検証と実装の境界

### 腕モーションからの演出開始

既存の `motion` Trigger に `preset` を指定して、腕の動作を Cue の開始条件にできる。Group / Step / Cue / Action / Timeline の構造は変更しない。片腕のプリセットは `swipeLeft`、`swipeRight`、`swipeDown`、`swipeUp`、`pushForward`、`pullBackward`。`subject` は presenter の anchor で、`target` は `eitherHand`、`leftHand`、`rightHand` のいずれか。両腕の `spreadHands`、`closeHands` は `target: "bothHands"` を必要とする。これらの複合対象は motion 専用で、zoneEdge には指定できない。

```json
{
  "kind": "motion",
  "actor": { "kind": "system", "source": "tracking" },
  "subject": {
    "kind": "anchor",
    "owner": { "kind": "presenter" },
    "target": "eitherHand"
  },
  "preset": "swipeUp",
  "minimumDistanceMeters": 0.28,
  "windowMilliseconds": 1200
}
```

この Trigger を持つ Cue の既存 `timeline.play` Action で opacity の Timeline を開始すれば、振り上げをきっかけにフェードインできる。`surface.setState` の crossfade も同じ Action 経路を使う。動作成立時に演出を開始する方式であり、腕の変位で再生位置や透明度を連続操作する契約ではない。`preset` を持たない既存の距離条件も引き続き有効。

本番では Realtime が presenter の既存 Tracking Pose を評価する。クライアントが送る「認識できた」という通知を判定の正本にはしない。共有 v2 Definition の Publication 保存・読み戻しが対応し、旧 Control Plane v1 draft schema は変更しない。Web Author の Cue 編集・プリセット選択 UI は未実装。Realtime は共有 Definition の motion preset を Tracking Pose から評価する。Presenter Delivery には対応する操作案内のメタデータを投影する。Tracking wire にトリガーボタン状態は含まれず、ボタン保持を認識開始条件にはしない。

Realtime のプリセット判定は、頭からの相対手位置と動作開始時の頭の水平向きを使う。上下は Y 軸、前方は canonical の -Z を頭の回転で変換した水平方向。0.20 秒の静止（速度 0.12m/s 以下）で準備し、Cue の距離・時間窓に加えて平均速度 0.25m/s 以上を要求する。片腕の横ずれは主方向変位の65%以下。両腕は広げる場合に手間距離 0.50m 以下から 0.60m 以上へ、縮める場合はその逆へ動かし、左右とも開始時の中心からの距離を 0.10m 以上変える。両腕の `minimumDistanceMeters` は手間距離の変化量を表す。

必要な追跡の欠損、0.50 秒を超えるフレーム間隔、場面変更で再準備を必要とする。成立後も再び静止するまで認識しない。これらは実装の既定値であり、Quest 実機での認識率・誤検出の調整は未完了。

[契約 package](../../packages/contracts/README.md) に生成・drift check・fixture の実行方法を記載する。JSON Schema と descriptor は生成物であり、手編集しない。

構造テストの合格は、GLB importer、動画 decoder、font atlas、Runtime reducer、再接続、Quest の実機動作が実装済みであることを意味しない。意味検証は Core、投影と admission は Delivery、素材変換は Compiler、描画は各 consumer の責務となる。端末の上限値は検証済み CapabilityProfile の必須入力であり、fixture の合成値を製品設定に使わない。

Core は静的 baked-web subset の意味検証と [build / 公開物の整合性検証](../../packages/unframe-core/ARCHITECTURE.md#10-v2-公開物の整合性検証) を持つ。Compiler / CLI は Definition、RenderBundle、AssetSet、BuildManifest と素材 bytes を出力する。v2 全体の意味検証と Delivery / Runtime consumer の接続は未完了である。
