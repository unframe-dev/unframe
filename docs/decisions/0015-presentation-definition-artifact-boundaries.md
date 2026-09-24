# ADR-0015: Definition と素材集合の構造境界を定める

- **Status**: Accepted（構造境界。具体契約は Presentation v2）
- **Date**: 2026-09-15
- **Related**: [Presentation Architecture](../packages/ARCHITECTURE.md), [ADR-0007](./0007-timeline-runtime-run-wire-contract.md), [ADR-0014](./0014-presentation-rendering-scope.md), [ADR-0016](./0016-model-animation-scope.md), [Contracts Architecture](../../packages/contracts/ARCHITECTURE.md)

## Context

現行の Definition / RenderBundle schema は静的 Surface の初期 subset である。Timeline catalog は Definition に属することまで決定済みだが配置が未定であり、公開物が参照する `assetSetHash` の入力形式も定義されていない。

意味モデル、描画成果物、素材 descriptor、公開・配信・実行時の値を分離し、完全な schema を具体化する際の境界を固定する。

## Decision

### PresentationDefinition

コンパイル後の Definition は次の構造を持つ。

```text
PresentationDefinition
├─ schemaVersion
├─ presentationId
├─ metadata
├─ stage
│  ├─ coordinateSystem
│  ├─ size
│  └─ zones
├─ scene
│  ├─ nodes
│  └─ surfaces
└─ flow
   ├─ initialGroupId
   ├─ groups → steps → cues
   ├─ variables
   └─ timelines
```

- `scene.nodes` は空間配置、owner、audience、初期 transform / 表示状態を持つ。`scene.surfaces` は内容ツリー、意味情報、State、Interaction、Render Intent を持つ。
- SurfaceNode と Semantic Surface の 1:1 対応、ID と owner の規則を維持する。描画 partition と Artifact ID は RenderBundle に属する。
- `flow.timelines` は Timeline ID をキーとする catalog とし、ADR-0007 の意味論を維持する。再生中の Run、開始時刻、現在値は Definition に入れない。
- Group / Step / Cue の構造と、Variable の型・初期値・owner は既存設計を維持する。現在の Group / Step と Variable の現在値は Runtime State に属する。
- Component Instance、公開 Action / Output は compile 時に展開する。Theme の参照は必要な具体値へ解決し、編集用 Token catalog や Component package を Definition に残さない。描画に必要な内容ツリーと解決済み値は保持し、Theme の build provenance は RenderBundle に記録する。
- 素材は使用箇所から `assetId` で参照する。現行の top-level `assets` descriptor 辞書は、下記 AssetSetManifest へ移す。
- 独立 AudioNode、音声専用の素材・操作は持たない。動画に含まれる音声は Video の一部とする。
- ModelNode は Model Asset の内蔵 animation clip を参照できる。再生の採用範囲と空間 Transform との境界は [ADR-0016](./0016-model-animation-scope.md) に従う。Clip ID の binding と Runtime contract は [Presentation v2](../packages/DATA_MODEL.md) に定義する。

### AssetSetManifest

素材 descriptor の正本を、Definition と RenderBundle から独立した immutable な manifest に置く。

```text
AssetSetManifest
├─ schemaVersion
└─ assets: Record<AssetId, AssetDescriptor>
   └─ AssetDescriptor
      ├─ checksum          素材の実バイト列の SHA-256
      ├─ mediaType
      └─ encodedSizeBytes  素材の実バイト数
```

`assets` は Definition と RenderBundle が参照する素材と、その配信に必要な依存素材の集合とする。未参照の編集用素材、source code、build cache は含めない。画像、フォント、動画、モデル等を同じ catalog で識別し、素材内部の形式・依存・再生条件は各型の契約で検証する。

`assetSetHash` は manifest 全体の canonical JSON の SHA-256 とする。manifest は自身の hash、取得 URL、session ID、publication epoch、ローカル filesystem path を持たない。Asset ID が同じまま実バイト列が変わる場合も `assetSetHash` と公開物の hash が変わり、異なる素材集合として識別される。

RenderBundle / Delivery の texture 等の descriptor に checksum や size を含める既存契約は維持する。これらは manifest と実素材から生成し、同じ Asset ID の descriptor が異なる組み合わせは拒否する。形式別の寸法、codec、font metadata と予算は各 artifact 契約が所有する。

### Build、Publication、Delivery、Runtime

- Compiler は Definition、RenderBundle、AssetSetManifest と素材の実体を生成する。参照の存在・型・依存の完全性は、この成果物の組に対して検証する。
- Control Plane は整合する成果物の hash を PublishedPresentation に固定する。PublicationFence、publish lock、Session binding は既存設計を維持する。
- DeliveryManifest は参加者・端末ごとの選択結果と取得 URL を持つ。Runtime State は現在値と実行中の Run を持ち、コンパイル成果物へ書き戻さない。

## Consequences

Definition の意味が同じでも素材内容が変われば、素材集合と公開物の identity が変わる。公開物全体の整合性を Definition の hash だけで判定できない。

現行 `definition.assets` を移すため、完全版 schema への移行は互換変更ではない。schema / contract version、Compiler、Core validator、fixture、consumer を同じ変更系列で更新する。現行 M1 の出力に manifest が追加済みであるとは扱わない。

## Adoption and Follow-ups

構造の実装時は Zod / JSON Schema と cross-artifact validation を更新する。生成済み schema を直接編集しない。

Model / Clip binding、素材 profile、Surface State、各 artifact、capability / budget、version の具体契約は [Presentation v2](../packages/DATA_MODEL.md) に定義する。Compiler と consumer の移行はこの契約に従って実装する。
