# Presentation データ契約 v2

## 正本と読み方

v2 は今回の機能範囲に対するデータ契約である。構造は Zod / Protobuf、構造だけでは表せない参照整合性・計算・状態遷移・拒否条件は以下の仕様を正本とする。両方を満たして初めて有効なデータとなる。

| 対象                                                                    | 構造の正本                                                                              | 意味規則                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------- |
| Definition / RenderBundle / AssetSet / Build / Publication / Capability | [Zod v2](../../packages/contracts/src/presentation/v2/index.ts)                         | [成果物契約](./CONTRACT_ARTIFACTS.md)   |
| 配信と再接続に共通の型                                                  | [presentation v2](../../packages/contracts/proto/unframe/presentation/v2/runtime.proto) | [配信・実行契約](./CONTRACT_RUNTIME.md) |
| DeliveryManifest                                                        | [delivery v2](../../packages/contracts/proto/unframe/delivery/v2/delivery.proto)        | 同上                                    |
| Command / Event / Run / Snapshot / StateFrame                           | [realtime v2](../../packages/contracts/proto/unframe/realtime/v2/realtime.proto)        | 同上                                    |

型・意味規則が旧 Architecture の例や初期 v1 と異なる場合は、この v2 契約を優先する。Architecture と ADR は設計理由を説明する。v1 は既存 Compiler / Core が利用する初期 subset であり、v2 の代替表現ではない。アプリケーションを v2 へ移す実装は別途必要である。

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

[契約 package](../../packages/contracts/README.md) に生成・drift check・fixture の実行方法を記載する。JSON Schema と descriptor は生成物であり、手編集しない。

構造テストの合格は、GLB importer、動画 decoder、font atlas、Runtime reducer、再接続、Quest の実機動作が実装済みであることを意味しない。意味検証は Core、投影と admission は Delivery、素材変換は Compiler、描画は各 consumer の責務となる。端末の上限値は検証済み CapabilityProfile の必須入力であり、fixture の合成値を製品設定に使わない。

Core の最初の v2 実装は [公開物の整合性検証](../../packages/unframe-core/ARCHITECTURE.md#10-v2-公開物の整合性検証) である。成果物間の参照・hash を検証し、完全な意味検証や既存 Compiler / consumer の v2 接続とは区別する。
