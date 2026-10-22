# Presentation データ契約 v2

## 正本と読み方

v2 は今回の機能範囲に対するデータ契約である。構造は Zod / Protobuf、構造だけでは表せない参照整合性・計算・状態遷移・拒否条件は以下の仕様を正本とする。両方を満たして初めて有効なデータとなる。

[ADR-0027](../decisions/0027-presenter-recognition-and-runtime-authority.md) の Presenter 認識・入力世代・Step 復元・pause 中の凍結状態は採用済み設計であり、Zod / Protobuf と生成物を更新済みである。構造リンクは更新済みの正本を指す。wire・version・容量は [v3 契約](./CONTRACT_PRESENTER_AUTHORITY.md) に固定し、実行側 consumer は移行前である。以下の v2 記述と異なる場合は v3 契約を優先する。

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

### Gesture / Zone と共有進行（採用済み・未実装）

Presenter client が入力を認識し、Runtime が Cue の採用と共有状態を確定する。定義と状態の配置は次のとおりとする。

| 対象             | 採用仕様                                                                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gesture Trigger  | `swipeLeft` / `swipeRight` / `swipeUp` / `swipeDown` / `pushForward` / `pullBackward` / `spreadHands` / `closeHands` の種類を指定する。片手動作は左右どちらでも同じ種類。距離・速度・時間窓・終了判定は client 内部で調整し、ユーザー設定にしない。 |
| Zone Definition  | ID、owner、中心位置を保持する。標準形状は Presentation Space の軸に平行な一辺2mの箱。ユーザーが指定する幾何情報は中心位置だけで、形状・寸法・判定部位は選択させない。                                                                               |
| Presenter 用情報 | Gesture の操作候補と Zone ID / 位置を配布する。Gesture の上下は鉛直、前後左右は動作開始時の頭の水平向きに基づく。Zone は Body tracking の腰位置で認識し、欠損時の部位代替はしない。                                                                 |
| 入力             | Gesture の種類、または Zone ID と enter / exit を送る。認識開始時の Group / Step・Step 入場世代・server の入力世代・イベント ID を共通で持つ。送信者は認証情報から確定する。                                                                        |
| Cue              | Guard、Action、Next、優先順位の評価は Runtime が行う。`oncePerStepEntry` / `repeatable` は残し、server cooldown は削除する。通常は前者、繰り返しが必要な Cue だけ後者を明示する。                                                                   |
| Runtime State    | 入力世代、pause 中の凍結 Anchor、到達済み Step ごとの直近の開始状態を追加する。raw Pose 履歴や認識器内部状態は含めない。Step 履歴は checkpoint へ保存し、Viewer に履歴全体を投影しない。                                                            |

一動作を一種類に分類し、一度だけ通知する。動作終了後に次の動作を受け付け、固定の待ち時間や不採用動作の新 ID による再通知は設けない。異なる認識結果は別イベントとして受理順に評価し、同時成立 batch は作らない。Zone は判定開始・再開・再校正・追跡復帰時に現在位置を無通知で seed し、喪失を exit とみなさない。

`timeline.play` や `surface.setState` による演出開始と、Pose に追従する連続演出は別の経路とする。Runtime は受理した認識結果から Cue を評価し、Pose から Gesture / Zone を再認識しない。pause では共有演出全体を止め、HMD の視点と操作 UI は継続する。Step 選択は到達済みの直近開始状態を paused で復元し、明示 resume を待つ。入力の寿命・再送・復元の詳細は [配信・実行契約](./CONTRACT_RUNTIME.md) に従う。

### 現行実装との差分

現行 Zod / Protobuf / consumer は Runtime が Pose から motion / Zone を認識する方式であり、`system/tracking` actor、ユーザー指定の motion 距離・時間窓・対象の手、可変 Zone size、cooldown を持つ。Presenter の `motion_guides` は操作案内であり、client 認識契約ではない。これらは移行対象であり、採用仕様の互換機能として残さない。入力世代、Step 選択・開始状態履歴、pause 中の凍結 Anchor 保存も未実装である。2m Zone と端末認識の品質は Quest 実機で別途検証する。

[契約 package](../../packages/contracts/README.md) に生成・drift check・fixture の実行方法を記載する。JSON Schema と descriptor は生成物であり、手編集しない。

構造テストの合格は、GLB importer、動画 decoder、font atlas、Runtime reducer、再接続、Quest の実機動作が実装済みであることを意味しない。意味検証は Core、投影と admission は Delivery、素材変換は Compiler、描画は各 consumer の責務となる。端末の上限値は検証済み CapabilityProfile の必須入力であり、fixture の合成値を製品設定に使わない。

Core は静的 baked-web subset の意味検証と [build / 公開物の整合性検証](../../packages/unframe-core/ARCHITECTURE.md#10-v2-公開物の整合性検証) を持つ。Compiler / CLI は Definition、RenderBundle、AssetSet、BuildManifest と素材 bytes を出力する。v2 全体の意味検証と Delivery / Runtime consumer の接続は未完了である。
