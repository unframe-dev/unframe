# Unframe Presentation Architecture

- **Status**: Adopted design baseline
- **Date**: 2026-08-25
- **Scope**: Presentation authoring, compilation, delivery, and runtime target architecture
- **Maturity**:
  - Architecture baseline: adopted
  - Presentation Progression semantic model: v1 baseline
  - Progression wire / Runtime contract: draft
  - Authoring、Rendering、Delivery の下位契約: follow-up
- **Related**:
  - [Presentation Implementation Design](./DESIGN.md)
  - [ADR-0005: 空間プレゼンテーションのドメインモデルを定義する](../decisions/0005-spatial-presentation-domain-model.md)
  - [ADR-0006: プレゼンテーションアーキテクチャを定義する](../decisions/0006-presentation-rendering-strategy.md)
  - [Repository Architecture](../../ARCHITECTURE.md)
  - [Server Architecture](../../app/server/ARCHITECTURE.md)

## 1. この文書の位置付け

この文書は、Unframe のプレゼンテーションについて、コード、GUI、描画、配布、Runtime を一つの形式へ押し込まず、共通の意味モデルを中心に接続する目標アーキテクチャを定義する。

この文書に記載された境界と原則は設計上の基準として採用する。ただし、すべてが現在のコード、API、Unity Runtime に実装済みであることを意味しない。現行実装との差は「現行実装との関係」に明記する。

## 2. 全体構成

```text
Presentation Orchestrator / Component Manifest / Component Structure
        │  restricted authoring DSL
        │
        ├─ Parse → Lossless Syntax Tree / Source Map ←→ GUI / Code editing
        ├─ Import / Symbol resolution / Typecheck
        └─ Static AST lowering
                   │
                   ▼
           Declaration Graph
                   │ Normalize / Validate with Syntax Tree
                   ▼
          Semantic Authoring IR ←→ GUI Semantic Commands
                   │ Compile / Resolve
                   │                      Opaque Renderer Source (TS / React / CSS)
                   │                                  │ Bundle / Isolated Browser rendering
                   │                                  ▼
                   ├───────────────────────── Renderer Artifact
                   ▼
PresentationDefinition JSON + RenderBundle + Asset Set
        │ publish
        ▼
Immutable Release
        │
        ├─ Delivery path
        │  └─ Control Plane
        │     ├─ Schema / ownership / hash validation
        │     └─ Role / capability delivery projection
        │          │
        │          ▼
        │     DeliveryManifest
        │          │
        │          ▼
        │     Unity Runtime clients
        │     ├─ Presenter
        │     └─ Viewer
        │
        └─ Session path
           └─ Room / Session (pins Release)
                  │
                  ▼
              Venue Edge
              ├─ Canonical progression
              ├─ Reliable Control / Snapshot
              └─ Latest-wins State Stream
                  │
                  ▼
              Same Unity Runtime clients
```

### 基本原則

- TSX、JSON、Protobuf は用途ごとの表現形式とする。v1 の PresentationDefinition は canonical JSON として build するが、JSON を Authoring Source にはしない。
- `.unframe.tsx` はプレゼンテーション全体を直接描画する巨大な実装ではなく、Component の配置と接続を行う composition root とする。
- Component の公開契約と renderer 実装を分離する。
- GUI と Code は同じ Semantic Authoring IR を編集する。
- GUI が任意の TSX、CSS、JavaScript を完全に逆解析できるとはみなさない。
- Local Compiler は Presentation Orchestrator、Component Manifest、Component Structure を parse / typecheck し、検証済み AST から Declaration Graph へ静的に lower する。これらを JavaScript として実行しない。
- Opaque renderer だけが通常の TS / React / CSS を bundle して renderer artifact を生成する。renderer の実行環境は Authoring DSL の lowering から分離する。
- Control Plane と Unity Runtime は Authoring Source、React、CSS、renderer source を実行しない。
- PresentationDefinition JSON、Texture、Video、Protobuf は生成物であり、編集元の正本にはしない。
- Presentation の意味、build 成果物、配信 projection、実行中状態を別の契約として扱う。
- Room と Session は immutable Release を参照し、実行中に Draft を直接参照しない。
- すべての参照可能な構成要素に安定 ID を割り当て、配列位置や描画順を ID の代わりに使用しない。

## 3. 契約の階層

### 3.1 Component Manifest

Component package の公開契約であり、次を定義する。

- Props
- Slots
- Parts
- Variants
- Runtime States
- Actions
- Output Events
- 必須 Theme Token
- 対応 renderer
- Editor metadata
- Version と migration 情報

Component Action は compile 時に `surface.setState`、Node State、Timeline、Variable などの canonical Action batch へ展開する。Component Output は明示された canonical event source へ展開し、参照箇所では canonical Trigger へ置き換える。どちらも Runtime wire contract に Component 固有の操作として残さない。

### 3.2 Semantic Authoring IR

GUI と Code が共同で編集する authoring 上の正規化モデルである。

次を保持する。

- Component Instance と package lock
- Spatial Tree と Surface Tree
- Frame Layout と配置意図
- Theme、Token、Named Style
- State、Action、Output、Global Flow
- Source range、source hash、stable ID
- Component override、Detach、diagnostics
- Editor が必要とする authoring metadata

任意の React object、DOM object、Three.js object、Unity object は保持しない。

### 3.3 PresentationDefinition

Presentation の意味モデルである。

```text
PresentationDefinition
├─ Metadata
├─ Stage / Coordinate Space / Zone
├─ Semantic Scene Graph
├─ Group / Flow / State / Action
├─ Semantic Surface
├─ Interaction
└─ Opaque Asset References
```

エンコード方式自体は意味モデルの一部ではないが、v1 の Local Compiler は PresentationDefinition を canonical `presentation.definition.json` として生成する。この JSON は永続化、検証、export、interop に使う最終的な意味 artifact であるが、GUI / Code 編集の Authoring Source ではない。

### 3.4 RenderBundle

Local Compiler が生成する immutable な build 成果物である。

```text
RenderBundle
├─ Textures
├─ Videos
├─ Native UI plans
├─ Surface state artifacts
├─ Resolved hit regions
├─ Semantic trees
├─ Source / Definition hashes
└─ Compiler / Render environment provenance
```

RenderBundle は Signed URL を保持しない。Asset ID、checksum、生成条件などの永続情報を保持し、取得 URL は Delivery 時に解決する。

### 3.5 DeliveryManifest

Unity Runtime 向けに解決した delivery envelope である。共有可能な静的 projection profile と、認証済み participant / assignment への binding を分離する。

```text
DeliveryManifest
├─ Presentation / RenderBundle revision
├─ ProjectionProfileDescriptor またはその参照
│  ├─ Runtime renderer graph
│  ├─ Selected renderer and resolution
│  ├─ Visible resource set
│  ├─ Local overlay definitions
│  └─ Required runtime capabilities
├─ ProjectionInstance
└─ participant 固有の Asset access bindings
```

```ts
type ProjectionProfileKey = {
  releaseId: ReleaseId;
  role: SessionRole;
  capabilityProfileId: CapabilityProfileId;
};

type ProjectionProfileDescriptor = {
  projectionProfileId: ProjectionProfileId;
  key: ProjectionProfileKey;
  visibleNodeIds: SpatialNodeId[];
  visibleSurfaceIds: SemanticSurfaceId[];
  rendererBindings: Record<RenderSurfaceId, RendererArtifactId>;
  localOverlays: LocalOverlayDefinition[];
};

type ProjectionInstance = {
  projectionProfileId: ProjectionProfileId;
  participantId: ParticipantId;
  assignmentEpoch: number;
};
```

Control Plane は同じ `ProjectionProfileKey` から同じ `ProjectionProfileDescriptor` を生成し、profile 単位で cache / 共有できるようにする。`ProjectionProfileId` は descriptor の canonical content と projection contract version に対応し、同じ Release、role、正規化済み capability profile の participant ごとに作り直さない。

Profile は `participantId`、`assignmentEpoch`、endpoint、credential、Signed URL を含まない。これらの participant / assignment 固有値と期限付き Asset access binding は DeliveryManifest の instance 側で解決する。client が申告した capability を authorization に使用せず、Control Plane が正規化・検証した `CapabilityProfileId` は renderer compatibility の選択だけに使用する。

配布形式は Protobuf を第一候補とするが、具体的な schema と versioning は別途決定する。

### 3.6 Immutable Release

Release は、互いに整合する PresentationDefinition、RenderBundle、Asset Set、contract version を束ねる publish 済みの immutable な実行単位である。Room と Session は Release ID を pin し、Delivery、Snapshot、Reliable Event は同じ Release を参照する。

### 3.7 Runtime State

Session 中に変化する状態であり、PresentationDefinition や RenderBundle へ書き戻さない。

| Layer                    | Authority            | Producer                      | 保持・復元                                              |
| ------------------------ | -------------------- | ----------------------------- | ------------------------------------------------------- |
| Shared Runtime State     | Venue Edge           | Venue Edge                    | Snapshot / Reliable Event。高頻度値は State Stream     |
| Participant Runtime View | なし。派生 view      | Venue Edge（profile は Control Plane） | profile と Shared Runtime State から再生成       |
| Client-local State       | Unity client / device | Unity client                  | 必要な場合だけ端末内で保持                              |

#### Shared Runtime State

Venue Edge が唯一の authority であり、すべての participant に共通する canonical state を保持する。

```ts
type SharedRuntimeState = {
  progression: ProgressionRuntimeState;
  nodeStates: Record<NodeId, NodeRuntimeState>;
  surfaceStates: Record<SurfaceId, SurfaceRuntimeState>;
  mediaStates: Record<SurfaceId, MediaRuntimeState>;
  variables: Record<VariableId, Scalar>;
  activeRuns: RuntimeRunSnapshot[];
  presentationOrigin: PresentationOrigin;
  presence: SharedPresenceState;
};
```

Progression、確定した resource state、Presentation Origin、Presence は Snapshot / Reliable Event へ反映する。Presenter Anchor sample、Timeline の frame 間補間値などの高頻度値も Venue Edge authority だが、latest-wins の sampled state とし、raw sample history を Snapshot や Reliable Event に含めない。

v1 は participant ごとに異なる server-authoritative Variable、Surface State、Progression を持たない。将来必要になった場合は明示的な `ParticipantRuntimeState` contract を追加し、Participant Runtime View や Client-local State を writable canonical state として流用しない。

#### Participant Runtime View

Participant Runtime View は Shared Runtime State の読み取り model であり、独立した authority や mutation API を持たない。`projection` は profile / instance / view の生成処理に使い、生成結果を Runtime View と呼ぶ。

```ts
type ParticipantRuntimeView = {
  projectionProfileId: ProjectionProfileId;
  assignmentEpoch: number;
  baseReliableSequence: number;
  progression: ProgressionRuntimeState;
  nodeStates: Record<NodeId, NodeRuntimeState>;
  surfaceStates: Record<SurfaceId, SurfaceRuntimeState>;
  mediaStates: Record<SurfaceId, MediaRuntimeState>;
  variables: Record<VariableId, Scalar>;
  activeRuns: RuntimeRunSnapshot[];
  presence: ProjectedPresenceState;
  enabledLogicalInputs: LogicalEventName[];
};

type ProjectedRuntimeSnapshot = {
  projectionProfileId: ProjectionProfileId;
  assignmentEpoch: number;
  reliableSequence: number;
  runtimeView: ParticipantRuntimeView;
};
```

Control Plane は Release、role、正規化済み capability profile から静的な `ProjectionProfileDescriptor` を生成する。Venue Edge はその profile、`ProjectionInstance`、Shared Runtime State を組み合わせ、participant ごとの Runtime View、Projected Runtime Snapshot、Reliable Event、State Frame を生成する。Unity client は受信後に unauthorized resource を非表示化する authority を持たず、配信前の projection で除外する。

Role による visibility と ResourceOwner による lifetime は別概念とする。

```ts
type ProjectionAudience =
  | { kind: "all" }
  | { kind: "role"; role: "presenter" | "viewer" };
```

Projection は参照 closure を満たさなければならない。visible resource が必要とする Spatial ancestor、Semantic Surface、renderer binding、Asset descriptor を欠く profile は Delivery 前に拒否する。capability 差は renderer / resolution / local overlay の選択だけを変え、Shared Progression、認可、semantic resource identity を変更しない。

Presenter notes の内容は Release 内の Presenter 限定 projection resource、control の利用可否は Shared Progression から導出する Runtime View、panel の開閉や hover は Client-local State とする。Projection 自体を Action target や Variable scope にしない。

#### Client-local State

Client-local State は participant の一つの device が所有し、Venue Edge の Snapshot、Reliable Event、Shared Guard / Cue / Action に混入させない。

```ts
type ClientLocalState = {
  calibration: ParticipantCalibration;
  viewport: ViewportState;
  selection: LocalSelectionState;
  personalAnnotations: PersonalAnnotation[];
  overlayStates: Record<LocalOverlayId, LocalOverlayState>;
};

type LocalSpatialParent =
  | { kind: "viewport" }
  | {
      kind: "anchor";
      owner: { kind: "self" };
      target: AnchorTarget;
    };
```

`PresentationOrigin` は Shared Runtime State、各 Quest の `ParticipantCalibration` は Client-local State とする。Viewer の head / hand に追従する HUD は profile に含まれる Local Overlay definition を、client が `self` Anchor と local calibration で配置する。`self` Anchor を Shared Spatial Tree、Shared Snapshot、Reliable Event へ入れない。

Presenter control の押下は認証済み Logical Input へ変換できるが、hover、selection、viewport、panel 開閉、local annotation は shared input にしない。Personal annotation を将来同期する場合は participant-private contract を別に追加する。

## 4. Presentation Orchestrator

`presentation.unframe.tsx` は Presentation metadata、Component Instance、Spatial placement、Props、Slot、State、Action、Output、Global Flow、Theme、Asset の選択を所有する。

Component 内部の Frame、Text、装飾などを Presentation Orchestrator へ展開して記述しない。

```tsx
import { definePresentation } from "@unframe/presentation";
import { Hero } from "./components/Hero/Hero.manifest";
import { Counter } from "./components/Counter/Counter.manifest";

export default definePresentation({
  metadata: {
    title: "Spatial Presentation",
  },

  scene: (
    <Group id="intro">
      <Hero id="hero" title="Spatial Presentation" />
      <Counter id="timer" initialValue={60} anchor="rightHand" />
    </Group>
  ),

  flow: ({ event, instance }) => [
    event("presenter.next")
      .in("intro-idle")
      .do(instance("hero").action("show"))
      .to("intro-shown"),

    event(instance("timer").output("completed"))
      .in("intro-shown")
      .to("intro-completed"),
  ],
});
```

この TSX は最終構文を固定するものではなく、Composition Root と Component Manifest の責務を説明するための例である。

## 5. Component Package

Structured Component は次の source 構成を持つ。

```text
components/Hero/
├─ Hero.manifest.ts
└─ Hero.structure.tsx
```

Component ごとの test file や test directory はこの source 構成に含めず、テストの配置と方式は contract / visual regression test の設計で別途定義する。

`Hero.preview.tsx` のような preview source は任意の authoring / development aid とする。Preview は Component contract、default Props、Component Structure の正本ではなく、PresentationDefinition や RenderBundle の build input に含めない。Preview がなくても check、build、publish できなければならない。Package integrity は preview source も改ざん検知の対象にできるが、Manifest hash、Structure hash、renderer artifact の cache key には含めない。

### 5.1 Component Manifest

```ts
export const Hero = defineComponentManifest({
  componentId: "@unframe/components/Hero",
  version: 1,

  authoring: {
    mode: "structured",
    structure: "./Hero.structure.tsx",
  },

  props: {
    title: stringProp({ required: true }),
    subtitle: stringProp({ required: false }),
  },

  slots: {
    media: {
      accepts: ["image", "video", "modelViewport"],
      cardinality: "one",
      required: false,
    },
  },

  parts: {
    root: {
      overridable: ["placement", "style"],
    },
    title: {
      overridable: ["content", "style"],
    },
  },

  states: {
    hidden: state(),
    shown: state(),
  },

  actions: {
    show: action({
      inputs: {},
      preconditions: [surfaceState("root", "hidden")],
      effects: [
        setSurfaceState("root", "shown"),
        playTimeline("reveal", {
          completion: "blocking",
        }),
      ],
    }),
  },

  outputs: {
    completed: output({
      payload: {},
      producer: timelineCompleted("reveal"),
    }),
  },

  renderers: ["baked-web"],
});
```

GUI は Manifest から Inspector と編集可能範囲を構築する。Structured Component の `renderers` は対応可能な generic renderer を宣言する compatibility metadata であり、Component 固有 implementation entry ではない。renderer 実装を解析して公開契約を推測しない。

### 5.2 Structured Component source boundary

- GUI が内部構造を理解できる。
- GUI と Code の意味論的 round-trip を保証する。
- Props、Slot、Part、State、Frame Layout を宣言的モデルとして編集できる。
- GUI が変更できる構文を限定し、任意の式や制御構造を自動変換しない。
- 内部構造の正本は、Manifest とは別の `*.structure.tsx` に保存する宣言的な Component Structure とする。

Manifest は Component の公開契約と Structure entry を所有する。Component Structure は stable local ID を持つ内部 Node、親子関係、Layout、State override、Interaction、Slot placement、公開 Part との対応を所有する。Declaration Graph と Semantic Authoring IR はこれらの Authoring Source から生成する派生物であり、正本ではない。PresentationDefinition には lower 後の canonical Scene、Surface、Flow だけを含め、raw Structure source は含めない。

v1 の Structured Component は Component 固有の React、CSS、DOM renderer entry を持たない。Compiler が Component Structure を renderer-independent な Primitive graph へ lower し、`baked-web` や将来の `native-ui` などの generic renderer がその graph を描画する。Structured Component の見た目は Structure、型付き Theme Token、Named Style、Primitive property で表現する。Component 固有の任意 React / CSS が必要な場合は Opaque Component とする。

Generic renderer は Structure に宣言されていない Semantic Node、State、Interaction、Action、Output を追加できない。Semantic Tree と Hit Region の意味は Structure から生成し、renderer は pixel layout や region bounds などの concrete geometry だけを解決する。renderer output から Structured Component の意味や編集構造を逆推論しない。

authoring mode は Component version ごとに一つに固定し、renderer ごとに Structured / Opaque を切り替えない。Structured と Opaque の変更は公開 authoring contract の破壊的変更として Component version と migration を更新する。

Component package lock は Component ID、package version、package integrity、Manifest hash に加え、Structured Component では Structure hash を固定する。公開契約を変えない Structure 変更も package integrity と Structure hash を変更し、Compiler cache と RenderBundle を再生成する。lockfile の serialized format は Authoring contract で別途定義する。

Component Structure の共通 DSL 制約、parse / typecheck、static AST lowering は 6.1〜6.3 に従う。具体的な Primitive node union と property schema は Component contract で定義する。

### 5.3 Opaque Component

```text
components/CustomChart/
├─ CustomChart.manifest.ts
├─ CustomChart.web.tsx
└─ CustomChart.css
```

- 任意の React、CSS、JavaScript を使用できる。
- GUI が編集できるのは Manifest が公開した Props、Slot、Part と Instance placement に限定する。
- 内部実装は Code が所有する。
- build 時に Web Surface として描画できる。
- 任意の `map`、条件分岐、関数計算は build 可能でも GUI 内部編集の対象にはしない。

Opaque Component は Component Structure を持たず、Manifest が Component 固有 renderer entry を参照する。意味情報、State、Interaction、Action、Output の公開境界は Manifest だけを正本とし、renderer の DOM、React tree、CSS、実行結果から追加の意味を推測しない。Manifest に宣言されていない interaction や Output を renderer が発生させる構成は build error とする。

Opaque Manifest は Action / Output lowering に必要な公開 Runtime target を `semantics` として宣言する。`semantics` は Node、Surface、Surface State、Interaction、Timeline、Variable、Media の stable local ID と renderer binding key だけを持ち、内部 Node hierarchy、Layout、DOM、CSS、React component を持たない。これは editable な Component Structure ではなく、Opaque renderer と canonical Presentation model を接続する semantic adapter である。

Opaque renderer は Manifest の binding key に concrete geometry や artifact を対応付けるが、宣言済み target の意味や ID を変更できない。Compiler は Opaque Action / Output template の local target を `semantics` から解決し、参照先の欠落、ID や binding key の重複、必須 binding の未結合、renderer が追加した未宣言 binding を build error とする。

Component package lock は Opaque Component の Manifest hash と renderer entry hash を固定する。renderer source または依存 lock が変わった場合は package integrity と entry hash を変更し、renderer artifact を再生成する。完全な drift 検証と renderer provenance は Rendering / Delivery follow-up で定義する。

Presentation Orchestrator、Component Manifest、Structured Component Structure は、GUI の source mapping と意味論的 round-trip を成立させるため、静的解析できる制限付き DSL とする。Local Compiler は import、symbol、型を解決した検証済み AST から Declaration Graph へ直接 lower し、これらの source を JavaScript として実行しない。

Opaque renderer は通常の TS / React / CSS として bundle し、renderer artifact を生成する。artifact の Browser 実行は静的 authoring lowering とは別の隔離境界で行う。Opaque Component の意味情報は静的に lower した Component Manifest から取得し、renderer の React tree、DOM、CSS、実行結果から推測しない。Control Plane、Venue Edge、Unity Runtime は authoring source や renderer source を実行しない。

自由な Code と完全な GUI 編集を同時に保証せず、Component 単位で境界を明示する。

### 5.4 Component Instance と Detach

Component Instance は Component ID、package lock、Props、Variant、Slot binding、公開 Part override、resource owner を持つ。Component Instance から生成する Spatial Node、Timeline、Variable、Zone は同じ owner を継承し、Component Manifest や Structure が別 scope へ上書きしない。共有 lifetime が必要な内容は別の presentation-owned Component Instance として配置する。

Component 内部では local ID を使用し、Compiler が Instance ID と local ID から安定した Runtime ID を生成する。Global Flow は Component 内部 Node を直接参照せず、公開 Part、Action、Output を参照する。

Structured Component の抽象を超えた編集が必要な場合は Detach する。

- 現在の Props、Slot、Variant、Override を適用する。
- Component を独立した authoring subtree へ展開する。
- 参照されている安定 ID を維持する。
- Package 更新から切り離す。
- Delivery artifact や Texture から Component source を復元しない。

Detach は Structured Component を project-local な Manifest と Structure へ materialize する one-way operation とする。Compiler は現在の Props、Variant、Slot、公開 Part override を適用し、Orchestrator 上の Component Instance ID と resource owner、local Component source 内の内部 local ID、公開 Part / Action / Output ID を維持して、外部 Component package の lock を外す。Global Flow の公開参照は同じ論理 ID を参照し続けなければならない。

Detach は Compiler が対応する宣言 AST から canonical な local Manifest / Structure AST を生成し、再度 static lowering と検証を通した後に source と lockfile を原子的に保存する。nested Component Instance は参照を維持し、再帰的に Detach しない。元 package の ID と version は provenance として保持できるが、更新や自動 reattach には使用しない。v1 は reattach と Opaque Component の Detach を持たない。

Opaque Component は editable な Component Structure を持たないため Detach できない。renderer source、DOM、Texture、Video artifact から Structured authoring subtree を生成しない。

### 5.5 Component Action / Output lowering

Component Action と Component Output は Component Manifest が公開する authoring abstraction であり、Runtime command や Runtime object ではない。

Component Action invocation は Semantic Authoring IR まで次の情報を保持する。

```ts
type Scalar = null | boolean | number | string;
type ScalarType = "null" | "boolean" | "number" | "string";

type ActionValue<T extends Scalar = Scalar> =
  | { kind: "literal"; value: T }
  | { kind: "eventPayload"; field: PayloadFieldId }
  | { kind: "variable"; variableId: VariableId };

type ComponentActionInvocation = {
  kind: "component.action";
  componentInstanceId: ComponentInstanceId;
  actionId: ComponentActionId;
  arguments: Record<ActionParameterId, ActionValue>;
};
```

`ComponentInstanceId` は Presentation Orchestrator 内、`ComponentActionId` と `ActionParameterId` は Component Manifest 内で一意な、空でない stable string ID とする。Manifest の `inputs` は `Record<ActionParameterId, ScalarType>` として各 argument の型を宣言する。

Local Compiler は invocation を Component Manifest の宣言的な precondition と effect template に従って展開する。

- precondition は invocation を含む Cue の既存 Guard と `all` で結合する。
- effect は canonical `Action[]` へ展開する。
- Component local の Surface、Node、Timeline、Variable、Interaction ID は、Component Instance ID と宣言済み local ID から決定的な canonical ID へ解決する。
- Canonical ID を配列位置、render order、React `key` から生成しない。公開 local ID の変更は Component contract の破壊的変更または明示的 migration として扱う。
- `ActionValue` は、その使用先が明示的に値式を受け付ける canonical Action field にだけ展開できる。Action kind、target ID、Surface State ID など、Runtime graph の形を決める値は動的にしない。
- Runtime は値式を同じ pre-event snapshot に対して評価してから Action batch を検証し、atomic に適用する。

Component Action の展開後は、Component Instance ID、Component Action ID、renderer implementation を PresentationDefinition と Runtime wire の実行命令に残さない。Source range と展開元の Component 情報は Semantic Authoring IR、diagnostics、build provenance にだけ保持できる。

Component Output は payload schema と producer を必ず宣言する、canonical event source への型付き alias とする。

```ts
type CanonicalEventPayload = Record<PayloadFieldId, Scalar>;

type ComponentOutputPayloadField = {
  type: ScalarType;
  value: Scalar;
};

type ComponentOutputProducer =
  | { kind: "surfaceInteraction"; interactionId: ComponentLocalInteractionId }
  | { kind: "timelineCompleted"; timelineId: ComponentLocalTimelineId }
  | { kind: "mediaCompleted"; surfaceId: ComponentLocalSurfaceId }
  | { kind: "timer"; afterMilliseconds: number };

type ComponentOutputDefinition = {
  payload: Record<PayloadFieldId, ComponentOutputPayloadField>;
  producer: ComponentOutputProducer;
};
```

`PayloadFieldId` は一つの Output payload schema 内で一意な stable string ID とする。lowering 後は、その Output reference から生成した Cue の payload scope に属し、同じ Cue の Guard と Action だけが参照できる。Payload field の global registry は作らず、別の Output が同じ field ID を使っても同一 field とはみなさない。通常の Logical Input payload field は、その input contract が別に定義する。

Component local の Node、Surface、Surface State、Interaction、Timeline、Variable、Media ID は同じ Component の semantic declaration だけを参照できる。Structured Component では Component Structure、Opaque Component では Manifest の `semantics` が宣言元となる。Compiler はこれらを Component Instance ID と組み合わせ、canonical target ID へ解決する。ID の serialized encoding は下位 contract で固定するが、論理 ID は文字列連結の偶然や配列位置に依存させない。

ComponentLocalSurfaceId は SemanticSurfaceId、`node.patch` と Timeline の Component local Node は SpatialNodeId へ lower する。SurfaceContentNodeId と RenderSurfaceId を Component Action / Output の Runtime target にしない。

Output payload は v1 では有限個の名前付き Scalar field だけを持つ flat record とし、各値は Manifest で compile 時に固定する。producer event からの動的 field projection、任意の object、再帰的な配列、renderer object は v1 に含めない。動的値を区別する必要がある interaction は、異なる Output または Interaction ID と固定 payload の組み合わせとして宣言する。

Output reference は compile 時に次の規則で canonical Trigger へ一意に置き換える。

| Output producer | Canonical Trigger | Actor |
| --- | --- | --- |
| `surfaceInteraction` | 同じ canonical Interaction ID を参照する `surfaceInteraction` | v1 は認証済み Presenter |
| `timelineCompleted` | 同じ canonical Timeline ID を参照する `timelineCompleted` | System |
| `mediaCompleted` | 同じ canonical Surface ID を参照する `mediaCompleted` | System |
| `timer` | `afterMilliseconds` を保持する Step timer | System |

`timer` は Component の mount 時刻ではなく、Output reference を含む Cue が属する Step の entry を基準にする。Step exit で破棄し、Step reentry では新しい `stepEntryEpoch` に属する timer として開始する。Native UI の Runtime Clock はこの同じ Step timer を表示へ binding できるが、完了判定と Output 発生は Venue Edge が行う。Component Output から別の `semanticEvent` を producer として参照することは v1 では許可しない。これにより producer chain と event cycle を作らない。

Compiler は `component.output`、Component 固有 event name、producer mapping を Runtime wire に残さず、解決済み Trigger と Cue の `fixedPayload` だけを出力する。Output reference から生成した Cue では Manifest の固定 payload を `fixedPayload` に設定する。

actor は Component Manifest が指定または上書きしない。Surface interaction は認証済み ingress event の actor、Timeline、Media、Timer の完了は System actor を使用する。Opaque Component も renderer JavaScript から任意の Output を emit できず、Manifest に宣言された producer だけを使用する。Renderer acknowledgement を Output producer や progression の完了条件にしない。

Compiler は少なくとも次を build error とする。

- 存在しない Component Instance、Action、Output、local target への参照
- Action argument、Output payload、producer の型不一致
- private local Node や renderer 内部 object への参照
- 空または非決定的な Component Action 展開
- 展開後の canonical Action batch における property conflict
- Output payload の宣言型と固定値の不一致
- Opaque renderer 実行結果から未宣言 Output を生成する構成

Canonical Cue 自体は Action を伴わず Step または Group だけを遷移できるため、`actions` の空配列を許可する。Component Action invocation を記述した場合は、一つ以上の canonical Action へ展開できなければならない。

この節は target canonical contract の決定である。現行 Control Plane の ADR-0005 schema は引き続き一つ以上の旧 Element Action を要求しており、この文書変更だけで現行 OpenAPI schema を変更したとはみなさない。

## 6. Authoring Compiler と GUI / Code round-trip

### 6.1 Authoring mode ごとの compiler path

Authoring Source はすべて同じ方法で実行せず、意味を宣言する source と任意の描画実装を分離する。

| Source | Compiler path | Output |
| --- | --- | --- |
| Presentation Orchestrator | parse / typecheck 後、AST から静的に lower | Presentation Declaration Graph |
| Component Manifest | parse / typecheck 後、AST から静的に lower | Component Declaration Graph（contract / semantics） |
| Structured Component Structure | parse / typecheck 後、AST から静的に lower | Component Declaration Graph fragment |
| Opaque Component renderer | 通常の TS / React / CSS として bundle | renderer artifact |

Declaration Graph は context-specific な root を持つ同じ宣言モデルとして、Orchestrator、Manifest、Structure の参照を接続する。Opaque renderer の React tree、DOM、CSS、実行結果は Declaration Graph ではない。Opaque renderer と Component semantics は Manifest の binding key だけで接続する。

### 6.2 Static Authoring DSL

Presentation Orchestrator、Component Manifest、Structured Component Structure は TypeScript / TSX の構文を使うが、JavaScript runtime semantics を持つ汎用プログラムではない。JSX は React JSX ではなく、Compiler が認識する宣言構文とする。

v1 の DSL で許可する構文は次に限定する。

- lockfile で固定した Component Manifest、Compiler SDK、Primitive、型の静的 ESM import
- `definePresentation`、Manifest builder、Structure Primitive など Compiler が認識する宣言 API
- literal、object / array literal、JSX、immutable な `const`、型注釈、type-only import
- literal stable ID による参照
- 単一式で宣言値を返し、外部の可変状態を捕捉しない Compiler-defined callback

少なくとも次は許可しない。

- `let`、代入、mutation
- `if`、`switch`、loop、再帰、`map` などによる Node topology の動的生成
- 任意関数呼び出し、closure、class、`new`
- dynamic import、`require`、`eval`、`Function`
- `async`、Promise、timer
- filesystem、network、process environment、wall clock、random、DOM、React state / hook への依存
- 配列位置、計算値、実行順序から生成する ID

Node topology と stable ID は source から静的に確定しなければならない。Props、Variant、State は property、content、style、visibility を選択できるが、Node の生成や削除には使用しない。反復構造は Slot または stable ID を明示した instance として表現する。Compiler が認識しない helper や user-defined macro は v1 の authoring declaration に使用しない。

### 6.3 Static lowering pipeline

```text
Authoring Source
      ↓ Parse
Lossless Syntax Tree / Source Map
      ↓ Static module resolution / Symbol resolution / Typecheck
Validated Authoring AST
      ↓ Context-specific static lowering
Declaration Graph
      ↓ Normalize / Validate
Semantic Authoring IR
```

Compiler は source と lockfile を解決した後、Lossless Syntax Tree を保持したまま import、symbol、型、DSL signature を検証する。lowering は AST と解決済み symbol だけを入力とし、Authoring Source を transpile、bundle、実行しない。Declaration Graph は plain data であり、関数、closure、DOM、React object、renderer object を含めない。

Normalization は少なくとも、stable ID の一意性、参照整合性、Component contract、source range との対応、context ごとの許可 node、静的 topology を検証する。unsupported syntax、未解決または許可されていない import / call、計算された ID、AST と Declaration Graph の対応欠落は build error とする。具体的な parser、TypeScript API、AST patch library は implementation design で選択できるが、この静的 lowering contract を変更してはならない。

Opaque renderer はこの pipeline に入れず、通常の module bundling で renderer artifact を生成する。artifact を Layout / capture のために実行する場合は renderer 専用の隔離された Browser environment を使用する。Browser capability、module resolution、cache invalidation、Font / Locale を含む再現性は Rendering / Delivery follow-up で固定する。

### 6.4 GUI / Code round-trip

GUI は TSX 文字列を推測で書き換えず、実行結果や Declaration Graph から Code を逆生成しない。

```text
Code
  ↓ Parse / Typecheck / Static lowering
Lossless Syntax Tree / Source Map ───────┐
  ↓                                      │
Declaration Graph                       │
  ↓ Normalize / Validate                │
Semantic Authoring IR                   │
  ↕ GUI Semantic Commands               │
Validated Syntax Tree Patch ────────────┘
  ↓ Recompile / Atomic save
Code
```

必要な対応情報は次のとおりである。

- Stable ID
- Source range
- Source hash
- IR hash
- Component version
- Semantic command
- Conflict diagnostics

Authoring Source と lockfile を永続的な正本とし、Declaration Graph と Semantic Authoring IR は再生成可能な派生物とする。GUI の Semantic Command は対象 Stable ID、期待する source hash と IR hash を持ち、Lossless Syntax Tree を patch した後に再度 static lowering と validation を行う。現在の hash と一致しない command は stale conflict として拒否し、自動 merge しない。成功した source patch と lockfile 更新は原子的に保存する。

保証する round-trip は正規化後の意味論的同値性であり、任意の手書きソースについて文字列単位の完全一致を保証しない。patch 対象外の comment と formatting は Lossless Syntax Tree で保持する。Compiler は Stable ID、source range、Component contract と対応できない Declaration Graph を生成せず、制限付き DSL の範囲で対応を作れない source を build error とする。

## 7. Scene Graph

Scene Graph は Spatial Tree と Surface Tree からなる 2.5D 構造とする。

```text
Group
└─ Spatial Tree
   ├─ Container3D
   ├─ Model
   ├─ Audio
   └─ SurfaceNode ── 1:1 ── Semantic Surface
                               ├─ Surface Tree
                               │  ├─ Frame
                               │  ├─ Text
                               │  ├─ Image
                               │  ├─ Video
                               │  └─ Shape
                               │
                               └─ compile ── 1..N Render Surfaces
```

Surface は次の三層を別の canonical identity として扱う。

- **SurfaceNode** は Spatial Tree 上の host であり、Transform と Timeline の対象である。
- **Semantic Surface** は PresentationDefinition 上の安定した意味、State、Interaction、Surface Tree、Render Intent を持つ。
- **Render Surface** は一つの Semantic Surface から Compiler が生成する RenderBundle 内の描画 partition である。

v1 は一つの SurfaceNode と一つの Semantic Surface を 1:1 に対応させ、一つの Semantic Surface を一つ以上の Render Surface へ lower する。同じ Semantic Surface を複数の SurfaceNode へ配置する mirroring は含めず、再利用や複数配置は Component Instance と SurfaceNode をそれぞれ作成して表現する。

### 7.1 Group

Group は物語上の進行スコープであり、Scene Graph の親子構造や resource ID namespace ではない。v1 の Runtime resource owner は `presentation` または一つの `group` に限定し、`step` scope は作らない。Step は Cue の有効範囲であり、resource lifetime ではない。

```ts
type ResourceOwner =
  | { kind: "presentation" }
  | { kind: "group"; groupId: GroupId };

type OwnedResource = {
  owner: ResourceOwner;
};
```

ownership の正本は各独立 resource の `owner` とし、Group に `ownedNodeIds` などの重複した一覧を保存しない。Compiler / Delivery は canonical owner から Group ごとの activation index を派生生成できるが、その index を authoring の正本にしない。各 resource kind の ID は owner ごとの namespace ではなく、PresentationDefinition 全体で一意とする。

owner を直接持つ独立 resource と、owner を継承する resource を次に固定する。

| Resource | owner |
| --- | --- |
| Component Instance | authoring declaration で所有 |
| Spatial Node、Timeline、Variable、Zone | `owner` を直接所有 |
| Semantic Surface | host SurfaceNode から継承 |
| SurfaceContentNode、Interaction | Semantic Surface から継承 |
| Media Runtime State / Run | Semantic Surface から継承 |
| Render Surface / renderer artifact | Semantic Surface から継承 |
| Step / Cue | 構造上所属する Group に固定 |
| Asset、Theme、Component package | Runtime lifecycle scope の対象外 |

ResourceOwner は immutable な Definition contract であり、Action や Runtime State から変更しない。owner は Spatial parent、`active`、`visible`、現在の Group と別概念とする。

参照は短い lifetime から同じまたは長い lifetime への方向だけを許可する。

| 参照元 | 参照可能な target |
| --- | --- |
| presentation-owned resource | presentation-owned resource |
| group G-owned resource | presentation-owned resource / group G-owned resource |
| Group G の Step / Cue | presentation-owned resource / group G-owned resource |

presentation-owned resource から group-owned resource、Group A から Group B の resource への参照は build error とする。この規則は Spatial parent、Timeline target、Variable、Zone、Surface、Interaction、Action、Guard、Trigger の参照に共通して適用する。

`Cue.next.groupId` は別 Group への遷移先を示すため、この resource 参照規則の対象外とする。ただし遷移元 Cue が遷移先 Group の resource を Action、Guard、Trigger から参照する権限は与えない。

Spatial ownership と Spatial parent は分離する。group-owned Node は presentation-owned Node、Stage、Anchor を parent にできるが、presentation-owned Node は group-owned Node を parent にできず、異なる Group の Node 間に parent relation を作れない。Group は単一の Root Spatial Node を所有する必要はなく、Compiler は owner と parent relation から複数の group root を導出できる。

Presentation 全体で継続する背景、共有 HUD、累積 Variable、ambient media、Timeline は presentation-owned とする。Group の Step / Cue は presentation-owned resource を変更でき、その結果は次の Group にも残る。独立した global Cue は v1 に含めず、presentation-owned Surface の Interaction も現在の Group / Step に対応する Cue がある場合だけ Progression へ影響する。

### 7.2 Stable identity と Spatial Node Graph

Authoring と PresentationDefinition の ID、Compiler が生成する ID を分離する。

| ID | 所有 contract | 安定性 |
| --- | --- | --- |
| `SpatialNodeId` | Authoring Source / PresentationDefinition | author-stable |
| `SurfaceNodeId` | Authoring Source / PresentationDefinition | author-stable、`SpatialNodeId` の kind-safe subtype |
| `SemanticSurfaceId` | Authoring Source / PresentationDefinition | author-stable |
| `SurfaceContentNodeId` | Authoring Source / PresentationDefinition | Semantic Surface 内で author-stable |
| `RenderSurfaceId` | RenderBundle | compiler-derived、build-local |
| `RendererArtifactId` | RenderBundle | compiler-derived、build-local |

既存の canonical Trigger、Guard、Action、Snapshot に現れる `SurfaceId` は `SemanticSurfaceId` を意味する。`NodeId` は `SpatialNodeId` を意味し、Surface Tree 内部の `SurfaceContentNodeId` を含めない。RenderSurfaceId は authoring API と PresentationDefinition に現れない。

Semantic Authoring IR と PresentationDefinition は Spatial Node を安定 ID で管理する。

```ts
type SpatialNodeBase = {
  id: SpatialNodeId;
  owner: ResourceOwner;
  parentId: SpatialNodeId | null;
  order: number;
  name?: string;
};

type SceneGraph = {
  rootNodeId: SpatialNodeId;
  nodes: Record<SpatialNodeId, SpatialNode>;
  surfaces: Record<SemanticSurfaceId, SemanticSurface>;
};
```

Code 上の入れ子表現は parse 時にこの関係へ正規化する。`parentId` の循環を禁止し、`order` と ID を分離する。

### 7.3 Spatial Tree

- Position は meter とする。
- 座標系は right-handed、Y-up、forward -Z とする。
- Rotation は `[x, y, z, w]` 順の正規化 Quaternion とする。
- Scale は無次元倍率とする。
- Presentation Origin、Stage、Spatial Node、Body Anchor を親座標として扱う。

ここまでの座標規約は ADR-0005 で固定済みである。Transform の合成順、Quaternion の乗算順、matrix layout、Unity との変換、Surface logical coordinate と UV の完全な変換規則は下位 contract で固定する。

```ts
type AnchorTarget = "head" | "leftHand" | "rightHand" | "body";

type SpatialParent =
  | { kind: "stage" }
  | { kind: "node"; nodeId: SpatialNodeId }
  | {
      kind: "anchor";
      target: AnchorTarget;
      owner: { kind: "presenter" };
      followPosition: boolean;
      followRotation: boolean;
    };
```

Shared Spatial Tree の Anchor owner は v1 では Session の Presenter だけとする。`ParticipantId` は Session 実行時の identity であり、PresentationDefinition、RenderBundle、Release へ埋め込まない。Viewer 自身の head / hand へ配置する UI は Shared Spatial Tree の node とせず、ProjectionProfileDescriptor の Local Overlay definition と Client-local State の `self` Anchor で表現する。

Presenter Anchor が利用できない場合、別 participant の Anchor や Stage origin へ暗黙に fallback しない。対象の Anchor binding を unavailable とし、その Anchor を subject とする Trigger は成立させない。unavailable 中の描画方針は Delivery / Runtime projection contract で固定する。

### 7.4 SurfaceNode と Semantic Surface

- SurfaceNode は Spatial Tree と Semantic Surface を接続する leaf host とする。
- Spatial Transform、`active`、`visible`、`opacity` は SurfaceNode が所有する。
- Surface の物理 size、logical size、State、Interaction、Surface Tree は Semantic Surface が所有する。
- Surface 内部は logical unit を使用する。
- 原点は左上、+X は右、+Y は下とする。
- SurfaceContentNode は同じ Semantic Surface または Frame を親とし、Spatial Node を親にしない。

```ts
type SurfaceNode = Omit<SpatialNodeBase, "id"> & {
  id: SurfaceNodeId;
  kind: "surface";
  surfaceId: SemanticSurfaceId;
};

type SemanticSurface = {
  id: SemanticSurfaceId;
  hostNodeId: SurfaceNodeId;
  physicalSizeMeters: [number, number];
  logicalSize: [number, number];
  fit: "contain" | "cover" | "stretch";
  rootFrameId: SurfaceContentNodeId;
  initialStateId: SurfaceStateId;
  states: Record<SurfaceStateId, SurfaceStateDefinition>;
  renderIntent: SurfaceRenderIntent;
};
```

Compiler は次の invariant を検証する。

- `SurfaceNode.surfaceId` と `SemanticSurface.hostNodeId` が双方向に一致する。
- 一つの SurfaceNode は一つの Semantic Surface だけを host し、一つの Semantic Surface は一つの SurfaceNode だけを参照する。
- SurfaceNode は Spatial Tree 上の leaf とし、2D 内容を Spatial child として保持しない。
- `rootFrameId` とすべての SurfaceContentNode が同じ Semantic Surface に所属し、別 Surface の Node を親または child にしない。
- `physicalSizeMeters` と `logicalSize` の各要素は有限かつ正である。
- SurfaceNode または Semantic Surface の orphan、重複参照、ID kind の取り違えを build error とする。

### 7.5 Render Surface lowering と Runtime 参照

一つの Semantic Surface は一つ以上の Render Surface へ lower する。Native UI、Baked Web、Video はいずれも Render Surface の renderer artifact として扱い、Semantic Surface と並列の意味 identity を作らない。

```ts
type RenderSurface = {
  id: RenderSurfaceId;
  semanticSurfaceId: SemanticSurfaceId;
  logicalBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  layer: number;
  artifacts: Record<RendererArtifactId, SurfaceRendererArtifact>;
  stateBindings: Record<SurfaceStateId, RenderSurfaceStateBinding>;
};

type RenderSurfaceStateBinding =
  | { kind: "empty" }
  | { kind: "artifacts"; artifactIds: RendererArtifactId[] };
```

`logicalBounds` は親 Semantic Surface の logical coordinate space で表す。RenderSurfaceId は同じ source、lockfile、Compiler version、configuration に対して決定的に生成するが、author-stable ID ではなく、Compiler version や partition strategy が変われば変更できる。

lowering は次を満たさなければならない。

- 一つの Render Surface は一つの Semantic Surface だけに所属し、Semantic Surface boundary を越えて内容を統合しない。
- 複数 Surface の texture atlas や GPU batching は Asset / Runtime 最適化であり、Render Surface identity を統合しない。
- Render Surface の集合、bounds、layer はすべての Surface State に対して同じ build 内で固定する。状態ごとに内容が存在しない partition は明示的な empty binding を持てる。
- すべての到達可能な Surface State について、各 Render Surface が選択可能な artifact、native plan、または明示的な empty binding を持つ。
- `artifacts` binding の `artifactIds` は空でなく、同じ Render Surface の `artifacts` に存在しなければならない。
- DeliveryManifest は target capability に応じ、各 Render Surface について互換な artifact を一つ選択する。

Runtime contract が参照できる ID を次に固定する。

| Contract | 参照可能な target |
| --- | --- |
| `node.patch`、Timeline track | SurfaceNode を含む `SpatialNodeId` |
| `surface.setState`、Surface Interaction、media Action | `SemanticSurfaceId` |
| Guard、Progression、Snapshot、Reliable Event | `SemanticSurfaceId` / `SpatialNodeId` |
| RenderBundle、Delivery renderer graph | `RenderSurfaceId` |
| Authoring 内部編集 | `SurfaceContentNodeId` |

RenderSurfaceId は Trigger、Guard、Action、Timeline、Snapshot、Reliable Event に含めない。SurfaceContentNodeId も公開 Interaction や Semantic Node へ明示的に lower された場合を除き、Runtime progression から直接参照しない。

一つの Semantic Surface が複数 Render Surface へ分割されても、`surface.setState` は一回の canonical state change とする。すべての partition は同じ transition run と `runId` に従って原子的に切り替え、Render Surface ごとの独立した canonical state を作らない。Surface 全体の Transform と opacity は SurfaceNode に一度だけ適用する。

`media.play`、`media.pause`、`media.seek` と `mediaCompleted` も SemanticSurfaceId を参照し、同じ Semantic Surface の media partition を一つの canonical media run として扱う。独立した再生位置や完了判定が必要な media は別 Semantic Surface に分ける。Render Surface や renderer acknowledgement を media authority にしない。

Render Surface の具体的な partition algorithm、自動化範囲、author override、artifact format は Rendering / Delivery follow-up で定義する。

## 8. Frame Layout

初期 Layout は次の三種類とする。

- `absolute`: 自由配置
- `stack`: 縦横方向の自動配置
- `grid`: 表、カード、一覧

親 Frame が Layout 方式を持ち、子 Node が親 Layout に対応する Placement を持つ。

```text
Frame(layout=stack)
├─ Text(placement=stack)
├─ Image(placement=stack)
└─ Frame(placement=stack, layout=grid)
```

Layout は最終座標だけでなく、配置意図を Authoring IR に保持する。

### 8.1 Dimension

```ts
type Dimension =
  | { kind: "fixed"; value: number }
  | { kind: "percent"; value: number }
  | { kind: "fill"; weight?: number }
  | { kind: "content" };
```

### 8.2 Layout invariants

- Surface は一つの root Frame を持つ。
- 親 Layout と子 Placement の種類を一致させる。
- Layout size、gap、padding は有限かつ非負とする。
- `content` size は deterministic に測定できる Primitive に限定する。
- Spatial Node を Frame 直下へ配置しない。
- Model を Surface 内へ表示する場合は `ModelViewport` などの明示的な Surface Primitive とする。

## 9. Theme、Token、Style

Theme は型付き Token と Named Style を持つ。

```text
Theme
├─ Tokens
│  ├─ Color
│  ├─ Logical Length
│  ├─ Spatial Length
│  ├─ Font Face
│  ├─ Duration
│  └─ Easing
└─ Named Styles
   ├─ TextStyle
   ├─ FrameStyle
   ├─ ShapeStyle
   └─ ModelStyle
```

Token 参照は文字列展開規則ではなく、型付き参照として保持する。Font は OS の font name ではなく、原則として Asset ID で参照する。

Resolution 順序は次に固定する。

```text
Primitive Default
    ↓
Named Style
    ↓
Component Variant
    ↓
Instance Override
    ↓
Runtime State / Animation
```

Theme は Layout、parent、Spatial Transform、Anchor、Flow を変更しない。CSS は `baked-web` renderer の実装詳細であり、Runtime 契約にしない。

## 10. Rendering Strategy

Semantic Scene Graph を優先し、renderer は Compiler の出力戦略とする。

```text
Authoring Surface
       ↓ Local Compiler
Semantic Surface
       ├─ SurfaceNode → native-3d composition
       └─ Render Surface
          ├─ baked-web
          ├─ native-ui
          └─ video
```

### 10.1 Native 3D

- Model
- Shape
- Light
- Spatial Audio
- Transform
- Anchor tracking

### 10.2 Baked Web

- React、CSS、UI library を固定された Browser 環境で描画する。
- Render Surface 単位で Texture を生成する。
- Runtime では一枚の Quad として扱う。
- Surface 内部 Node は Runtime Graph から消える。
- Typography、Border、Fill、Shadow、Gradient、2D Layout は Texture へ焼き込む。

### 10.3 Native UI

- Timer
- Counter
- 短い動的 Text
- Runtime data や user input で継続的に変化する限定 UI

任意の CSS を実行せず、versioned portable UI contract と、更新可能 property の allowlist を使用する。

### 10.4 Video

- 複雑だが事前に確定できる連続演出に使用する。
- Codec、alpha、audio、seek、loop、device capability は Delivery 契約で検証する。

### 10.5 Component と Surface

- Component は再利用と編集の境界である。
- Semantic Surface は意味状態と interaction の境界、Render Surface は描画 partition、SurfaceNode は空間 animation の境界である。
- 一つの Component が複数 Surface や Native Node へ展開されることを許す。
- 常に一緒に意味状態を変更する内容は同じ Semantic Surface にまとめられる。
- 独立して移動する内容は別 SurfaceNode、独立して状態変更や入力処理をする内容は別 Semantic Surface または Native Node に分ける。

## 11. Surface Render Intent

Semantic Surface は具体的な renderer ではなく、必要な実行特性と renderer preference を持つ。

```ts
type SurfaceRenderIntent = {
  updateModel:
    | { kind: "static" }
    | { kind: "finite-state"; stateIds: SurfaceStateId[] }
    | {
        kind: "continuous";
        source: "timeline" | "runtime-data" | "user-input";
        maximumUpdateRateHz?: number;
      };

  interaction:
    | { kind: "none" }
    | { kind: "regions"; events: LogicalEventName[] }
    | { kind: "native-input" };

  internalAnimation:
    | { kind: "none" }
    | { kind: "precomputed"; durationSeconds: number }
    | { kind: "runtime" };

  rendererPreference: "auto" | "baked-web" | "native-ui" | "video";
  fallbackPolicy: "reject" | "degrade";
};
```

Renderer の基本選択規則は次のとおりとする。

| Surface の特性 | 基本 renderer |
| --- | --- |
| 静的な Typography、Card、Table | `baked-web` |
| 少数の有限状態 | `baked-web` + state artifacts |
| 入力非依存の連続演出 | `video` |
| Timer、Counter、入力値などの継続変化 | `native-ui` |
| Surface 全体の移動、回転、拡縮、Fade | Unity SurfaceNode |

`rendererPreference` は authoring 上の希望であり、target capability と build 結果を踏まえた concrete renderer は RenderBundle と DeliveryManifest で確定する。

## 12. v1 Presentation Progression の意味論

v1 は Surface State を含むプレゼンテーション進行について、State Machine、Trigger、Guard、Action、Timeline の意味論的基準を定義する。wire schema、Snapshot の正確な表現、transport の保持期間は下位契約として draft のまま残す。

```text
Group       = State Machine のスコープ
Step        = 現在の進行状態
Cue         = Trigger で発火する遷移候補
Action      = 意味論的状態へ適用する atomic batch の要素
Timeline    = 連続値の時間変化
Surface State = Surface ごとの意味論的な有限状態
```

Step、Surface State、Timeline Run は別の状態である。

```text
Progression State: intro-idle / intro-shown / result
Surface State:     hidden / shown / selected / correct
Timeline Run:      title-fade-in の 420 ms 地点
```

### 12.1 Authority と基本 invariant

- Venue Edge を Session Runtime の single authority とし、Trigger、Guard、Cue 選択、Action、Timeline 完了、Group / Step 遷移を canonical evaluation する。
- v1 では同時に active な Group と Step をそれぞれ一つに限定する。
- Group は State Machine のスコープであり、Scene Graph の親子関係には使用しない。
- 現在の Step に属する Cue だけを評価する。
- 一つの input event から受理する Cue は最大一つとする。複数対象の演出は一つの Cue に複数 Action を持たせて表現する。
- Cue 内の Action は順序付き命令列ではなく、同じ pre-event state に対して計画し、同時に開始する atomic batch とする。
- 連続的な値変化は Timeline に記述し、Action の暗黙的な実行順へ依存しない。
- Renderer は PresentationDefinition の意味を変更せず、Surface State や Timeline を RenderBundle の artifact へ lower する。
- Progression の `SurfaceId` は常に SemanticSurfaceId、`NodeId` は常に SpatialNodeId とし、RenderSurfaceId と SurfaceContentNodeId を canonical state に保持しない。
- v1 で Global Progression を変更できる外部 input は Presenter 由来に限定する。System の内部 completion event は許可するが、participant 固有 interaction から共有進行を変更する規則は v1 に含めない。

### 12.2 Flow definition

Group と Presentation は配列の先頭に依存せず、初期 ID を明示する。

```ts
type PresentationFlow = {
  initialGroupId: GroupId;
  groups: Record<GroupId, GroupFlow>;
  variables: Record<VariableId, VariableDefinition>;
};

type VariableDefinition = {
  id: VariableId;
  owner: ResourceOwner;
  type: ScalarType;
  initialValue: Scalar;
};

type GroupFlow = {
  id: GroupId;
  initialStepId: StepId;
  steps: Record<StepId, StepDefinition>;
};

type StepDefinition = {
  id: StepId;
  cues: CueDefinition[];
};

type CueDefinition = {
  id: CueId;
  priority: number;
  order: number;
  trigger: Trigger;
  fixedPayload?: CanonicalEventPayload;
  guard?: Guard;
  firePolicy:
    | { kind: "oncePerStepEntry" }
    | { kind: "repeatable"; cooldownMilliseconds: number };
  actions: Action[];
  next:
    | { kind: "stay" }
    | { kind: "step"; stepId: StepId }
    | { kind: "group"; groupId: GroupId }
    | { kind: "end" };
};
```

`fixedPayload` がある Cue では、Trigger source event 自身の payload の代わりにこの値を Guard と Action の `eventPayload` 参照へ渡す。Component Output lowering は `fixedPayload` を必ず生成する。通常の Logical Input Cue は `fixedPayload` を省略し、認証済み ingress event の payload を使用する。Timeline、Media、Timer など payload を持たない内部 Trigger は、省略時に空 record を使用する。

`stay` は現在の Step を再入場せず、Surface interaction などへの反応だけを行う。現在の Step ID を指定する self transition は Step 再入場として扱い、`oncePerStepEntry` の消費状態を初期化する。

### 12.3 Runtime progression state

PresentationDefinition は初期状態と遷移規則を保持し、実行中の位置と進捗は Runtime State として管理する。

```ts
type ProgressionPhase =
  | { kind: "stable" }
  | {
      kind: "transitioning";
      cueId: CueId;
      blockingRunIds: RuntimeRunId[];
      pendingNext: CueDefinition["next"];
    };

type ProgressionRuntimeState = {
  currentGroupId: GroupId;
  currentStepId: StepId;
  groupEntryEpoch: number;
  stepEntryEpoch: number;
  stepEnteredAtRuntimeTimeMilliseconds: number;
  phase: ProgressionPhase;
};

type RuntimeRunOwner =
  | { kind: "presentation" }
  | {
      kind: "group";
      groupId: GroupId;
      groupEntryEpoch: number;
    };
```

Timer、Cue 消費状態、cooldown は `stepEntryEpoch` に属する。これにより self transition と Group reentry の後に、古い Step entry の timer や once 実行状態を復元しない。

Surface transition、Timeline、Media は共通の **Runtime Run** として追跡する。各 Run は `runId`、`RuntimeRunOwner`、原因 Cue、開始 runtime time、完了条件、状態を持つ。Surface transition と Media Run は Semantic Surface、Timeline Run は Timeline Definition から owner を継承する。group-owned Run は開始時の `groupEntryEpoch` を固定し、同じ Group の再入場後に以前の completion を適用しない。blocking run は Progression Phase の `blockingRunIds` と対応し、Snapshot から復元できなければならない。

`transitioning` 中は、Timeline 完了などの内部イベントを除く通常の Trigger input を無視する。v1 では input queue や任意 interrupt を持たない。

### 12.4 Surface State

Surface State は `hidden`、`shown`、`selected`、`correct` のような意味論的状態であり、Texture ID、Material、CSS class、Unity GameObject を参照しない。

```ts
type SurfaceStateDefinition = {
  id: SurfaceStateId;
  semanticOverrides: SurfaceSemanticOverride[];
  enabledInteractionIds: InteractionId[];
};

type SurfaceRuntimeState = {
  stateId: SurfaceStateId;
  transition?: {
    runId: RuntimeRunId;
    fromStateId: SurfaceStateId;
    toStateId: SurfaceStateId;
    startedAtRuntimeTime: number;
    durationMilliseconds: number;
    easing: Easing;
  };
};
```

Spatial Node に共通する `active`、`visible`、`opacity`、`transform` は Surface State へ重複させず、Node Runtime State として管理する。

```ts
type NodeRuntimeState = {
  active: boolean;
  visible: boolean;
  opacity: number;
  transform: Transform;
};
```

`surface.setState` を受理した時点で Semantic Surface の canonical `stateId` は遷移先へ変更する。Crossfade 中の旧状態、開始時刻、duration は `transition` に保持し、`runId` で対応する Runtime Run と結びつける。Guard と canonical Semantic Tree が参照する Surface State は遷移先の `stateId` とする。

同じ Semantic Surface に属するすべての Render Surface はこの一つの transition と `runId` を投影し、個別に state や完了時刻を決定しない。一つでも必要な state binding を欠く RenderBundle は Delivery 前に拒否する。

v1 の Surface transition は `cut` または blocking な `crossfade` に限定する。同じ Semantic Surface に transition が active な間の新しい `surface.setState` は reject し、replace、interrupt、queue は含めない。Crossfade 中は Surface interaction を無効にし、完了後に遷移先 State の hit region を有効にする。

```text
surface.setState("correct")
        ↓ renderer lowering
baked-web: correct texture を選択
native-ui: property を更新
video: 対応する clip を選択
```

RenderBundle はすべての到達可能な Surface State に対応する artifact または native plan を持たなければならない。対応 artifact がない Presentation / RenderBundle の組み合わせは Delivery 前に拒否する。

### 12.5 Runtime input event と Trigger

Input source は device 固有入力を Logical Event へ変換する。Trigger はイベントの成立条件だけを記述し、状態変更を行わない。

```ts
type SessionRole = "presenter" | "viewer";

type SystemEventSource = "tracking" | "timer" | "timeline" | "media" | "runtime";

type RuntimeActor =
  | {
      kind: "participant";
      participantId: ParticipantId;
      role: SessionRole;
    }
  | {
      kind: "system";
      source: SystemEventSource;
    };

type TriggerActorSelector =
  | { kind: "presenter" }
  | { kind: "system"; source?: SystemEventSource };

type TrackedSubjectSelector =
  | {
      kind: "participant";
      owner: { kind: "presenter" };
    }
  | {
      kind: "anchor";
      owner: { kind: "presenter" };
      target: AnchorTarget;
    };

type RuntimeSubject =
  | { kind: "participant"; participantId: ParticipantId }
  | {
      kind: "anchor";
      ownerParticipantId: ParticipantId;
      target: AnchorTarget;
    };

type Trigger =
  | {
      kind: "logicalInput";
      action: LogicalEventName;
      actor: TriggerActorSelector;
    }
  | {
      kind: "semanticEvent";
      event: SemanticEventName;
      actor: TriggerActorSelector;
    }
  | {
      kind: "surfaceInteraction";
      actor: TriggerActorSelector;
      surfaceId: SurfaceId;
      interactionId: InteractionId;
    }
  | {
      kind: "zoneEdge";
      actor: { kind: "system"; source: "tracking" };
      subject: TrackedSubjectSelector;
      zoneId: ZoneId;
      edge: "enter" | "exit";
      dwellMilliseconds?: number;
      hysteresisMeters?: number;
    }
  | {
      kind: "motion";
      actor: { kind: "system"; source: "tracking" };
      subject: TrackedSubjectSelector;
      minimumDistanceMeters: number;
      windowMilliseconds: number;
    }
  | { kind: "timer"; afterMilliseconds: number }
  | { kind: "timelineCompleted"; timelineId: TimelineId }
  | { kind: "mediaCompleted"; surfaceId: SurfaceId };
```

`actor` は event を発生させた認証済み主体、`subject` は追跡または判定の対象であり、subject であること自体は権限を与えない。Presenter は Session role であり、Runtime event の identity では `participantId` と ingress 時に検証した role の両方を保持する。Session の Presenter は creator に固定し、v1 では途中交代しない。

participant 起点の canonical event は、認証済み Realtime connection の JWT claims から Venue Edge が `participantId` と role を設定する。client payload に actor、role、subject を含めず、client がこれらを申告しても採用しない。System actor は Venue Edge 内部の tracking evaluator、timer、timeline、media、runtime lifecycle だけが生成でき、client から System event を送信する wire path は設けない。

`TriggerActorSelector` の `presenter` は `RuntimeActor.kind === "participant"` かつ `role === "presenter"` にだけ一致する。`system` は System actor に一致し、`source` が指定されていれば同じ source だけに一致する。PresentationDefinition は具体的な `participantId` を使う actor selector を持たない。Viewer input は Shared Progression の Trigger に一致させず、Projection / Client-local State に対する入力規則を定義するまでは共有 Action を発生させない。

`surfaceInteraction` は現在の canonical Surface State において対象 Interaction が存在し、有効である場合だけ成立する。client が申告した Surface State は判定に使用しない。v1 の `logicalInput` と `surfaceInteraction` は Presenter actor、Timeline / Media / Timer completion は対応する System source だけを受理する。通常の `semanticEvent` は宣言した selector を照合する。Compiler は producer と actor selector の不正な組み合わせを build error とする。

Zone と Motion は Venue Edge が認証済み Presenter Tracking Stream から評価し、edge 成立時に `actor = system / tracking`、`subject = Presenter またはその Anchor` の内部イベントへ変換する。subject selector は現在の Session Presenter を concrete `participantId` へ解決する。Raw Pose は Reliable Event として replay せず、現在の zone membership や hysteresis など、誤再発火を防ぐための小さな edge detector state だけを Snapshot に含める。

```ts
type RuntimeInputEvent = {
  eventId: string;
  actor: RuntimeActor;
  subject?: RuntimeSubject;
  kind: RuntimeInputKind;
  payload: CanonicalEventPayload;
  capturedAt?: number;
  ingressSequence: number;
};
```

認証、role、event kind、subject の検証に失敗した入力は canonical event にせず、`ingressSequence` も割り当てない。`eventId` は冪等適用、Venue Edge が受理時に割り当てる `ingressSequence` は順序決定に使用する。client の `capturedAt` は診断専用であり、イベント順序には使用しない。

`timer.afterMilliseconds` の基準は Step entry とし、Step exit で破棄する。Pause 中は timer を進めない。

### 12.6 Guard

Guard は同じ pre-event snapshot に対して評価する、純粋かつ有限な宣言的 predicate とする。

```ts
type Guard =
  | { kind: "all"; guards: Guard[] }
  | { kind: "any"; guards: Guard[] }
  | { kind: "not"; guard: Guard }
  | {
      kind: "compare";
      left: ValueReference;
      operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
      right: Scalar;
    };

type ValueReference =
  | { kind: "variable"; variableId: VariableId }
  | { kind: "eventPayload"; field: PayloadFieldId }
  | { kind: "surfaceState"; surfaceId: SurfaceId }
  | {
      kind: "nodeField";
      nodeId: NodeId;
      field: "active" | "visible" | "opacity";
    };
```

Variable は PresentationDefinition で型、初期値、ResourceOwner を宣言する。Group G の Guard / Action は presentation-owned または Group G-owned Variable、presentation-owned definition は presentation-owned Variable だけを参照できる。任意 JavaScript、callback、時刻取得、乱数、network access、Renderer state の参照は許可しない。

### 12.7 Action

Action は renderer-independent な意味論的対象だけを変更する。

```ts
type NodeRuntimeStatePatch = {
  active?: ActionValue<boolean>;
  visible?: ActionValue<boolean>;
  opacity?: ActionValue<number>;
  transform?: Transform;
};

type Action =
  | {
      kind: "surface.setState";
      surfaceId: SurfaceId;
      stateId: SurfaceStateId;
      transition?:
        | { kind: "cut" }
        | {
            kind: "crossfade";
            durationMilliseconds: number;
            easing: Easing;
            completion: "blocking";
          };
    }
  | {
      kind: "node.patch";
      nodeId: NodeId;
      patch: NodeRuntimeStatePatch;
    }
  | {
      kind: "timeline.play";
      timelineId: TimelineId;
      completion: "blocking" | "nonBlocking";
      conflict: "reject";
    }
  | { kind: "timeline.stop"; timelineId: TimelineId }
  | { kind: "variable.set"; variableId: VariableId; value: ActionValue }
  | { kind: "media.play"; surfaceId: SurfaceId }
  | { kind: "media.pause"; surfaceId: SurfaceId }
  | { kind: "media.seek"; surfaceId: SurfaceId; positionSeconds: ActionValue<number> };
```

`ActionValue` の参照は Cue を発火させた event payload と同じ pre-event Variable snapshot に対して解決する。型不一致、存在しない payload field、未定義 Variable、非有限 number は batch validation error とする。`transform`、target ID、Surface State ID のように Runtime graph の構造を決める値は v1 では静的値に限定する。

Runtime は Cue を受理する前に、すべての Action target、Surface State、Timeline、値の型、property conflict を検証する。一つでも不正なら batch 全体を拒否し、partial apply や Step 遷移を行わない。Delivery preflight で検出できなかった実行時 fault が発生した場合は、進行を継続せず Runtime を `Paused` にする。

Action 同士の順序に意味を持たせない。依存した順次演出は次の Step、Timeline keyframe、または `timelineCompleted` Trigger で表現する。

v1 の Action conflict は action 配列順で解決しない。同一 Surface への複数 `surface.setState`、同一 Variable への複数書き込み、同一 Node field への複数 patch、Node patch と Timeline の同一 property 所有、同一 Timeline の play / stop、同一 media target への競合操作は batch validation で reject する。異なる field への Node patch だけは一つの patch として統合できる。`replace`、additive animation、暗黙的な last-write-wins は将来拡張とする。

### 12.8 Timeline

Timeline は連続補間可能な property の時間変化だけを所有する。

```ts
type TimelineDefinition = {
  id: TimelineId;
  owner: ResourceOwner;
  durationMilliseconds: number;
  tracks: Array<{
    target: {
      nodeId: NodeId;
      property:
        | "opacity"
        | "transform.position"
        | "transform.rotation"
        | "transform.scale";
    };
    keyframes: Array<{
      timeMilliseconds: number;
      value: number | Vector3 | Quaternion;
      easing: Easing;
    }>;
  }>;
};
```

- Surface 全体の Transform と opacity は、その Semantic Surface に対応する SurfaceNode の track として表現する。
- `SurfaceStateId`、Texture ID、renderer、CSS property、任意の Component 内部値は Timeline track にしない。
- Baked Web Render Surface 内部の個別 Node を動かす必要がある場合は、Semantic Surface 分割、有限状態 artifact、Video、Native UI のいずれかへ lower する。
- Timeline は absolute 値を指定する。各 track の最初の keyframe は `0 ms`、最後の keyframe は Timeline duration とし、keyframe 時刻は単調増加して同時刻を許可しない。
- Rotation は正規化 Quaternion の shortest-path SLERP で補間する。
- 同じ `target/property` を同時に所有できる Timeline Run は一つだけとする。v1 の conflict policy は `reject` のみであり、replace と additive animation は含めない。
- group-owned Timeline は同じ Group または presentation-owned Spatial Node、presentation-owned Timeline は presentation-owned Spatial Node だけを target にできる。
- group-owned Timeline は Group exit 時に停止する。presentation-owned Timeline は明示的な `timeline.stop` または Presentation 終了まで Group をまたいで継続できる。Step 遷移だけではどちらも停止しない。
- Timeline の開始・完了は Venue Edge の monotonic runtime clock で決定する。Renderer acknowledgement を完了条件にしない。
- Runtime は開始時刻と Timeline 定義を配信し、各 client はローカル補間する。補間結果を毎 frame Reliable Event として送信しない。

Pause 中は Timeline と media playback の runtime clock を進めない。Runtime Resume 時は pause duration を除外して基準時刻を再計算する。

### 12.9 Cue の選択と遷移手順

一つの Runtime Input Event を次の順序で処理する。

1. Runtime が `Running` であり、session、role、release、assignment、lease、Presentation Origin version が一致することを検証する。
2. `eventId` を bounded idempotency window で重複排除し、新規イベントへ `ingressSequence` を割り当てる。
3. Venue Edge の monotonic clock を進め、現在時刻以前の内部 completion event を先に処理する。
4. 現在の Group / Step に属する Cue から、Trigger、Guard、fire policy、cooldown を満たす候補を作る。
5. `priority` 降順、`order` 昇順、`cueId` 辞書順で候補を並べ、先頭の一件だけを選択する。
6. 選択した Cue の Action batch と `next` を事前検証する。
7. Surface / Node / Variable の即時変更を atomic に適用し、Surface transition、Timeline、media action を開始する。
8. blocking run があれば Progression Phase を `transitioning` にし、現在の Step と `pendingNext` を保持する。
9. blocking run がすべて完了したら `next` を atomic に適用し、Progression Phase を `stable` に戻す。
10. zero-duration action から生じた内部 event を同じ event loop で処理する。build validation と runtime microstep 上限により無限遷移を防ぐ。

同じ `priority` と `order` を持つ Cue は build validation error とする。Runtime の `cueId` 比較は、不正な Delivery を受けた場合にも結果を決定的にするための fallback である。

`eventId` による transport 上の重複排除、`oncePerStepEntry` による意味論的な一回実行、`cooldownMilliseconds` による連続入力抑制は別の機能として管理する。Cooldown は leading-edge とし、window 終了後の暗黙的な trailing 発火は行わない。

### 12.10 Group lifecycle

Presentation 開始時は presentation-owned Node、Surface、Variable、Media、Zone の状態を Definition の初期値から一度だけ初期化し、presentation-owned Timeline を停止状態にした後で `initialGroupId` へ入場する。presentation-owned Runtime State と Run は Group 切替では reset または停止せず、明示的な Action、Presentation の再初期化、Presentation 終了によってだけ変更または破棄する。

Group exit では次を順に適用する。

1. 旧 Group の Step / Cue と、group-owned Interaction を無効化する。
2. 旧 Group 所有の Surface transition、Timeline、Media Run を cancel する。group-owned blocking Run が残る状態では exit を開始しない。
3. 旧 Group 所有の Spatial Node を deactivate する。
4. 旧 Group 所有の Node、Surface、Media、Variable、Zone の Runtime State と Trigger edge memory を canonical Runtime State から除去する。
5. `GroupExited` を確定する。

Group entry では次を順に適用する。

1. `currentGroupId` を新 Group へ変更し、`groupEntryEpoch` を増加する。
2. 新 Group 所有の Node、Surface、Media、Variable、Zone を Definition の初期値から生成する。Timeline は停止状態から開始する。
3. Spatial Node の initial `active`、`visible`、`opacity`、`transform` を適用する。
4. Trigger edge memory を現在値から seed し、入場時の疑似 edge を発火しない。
5. `stepEntryEpoch` を増加し、Cue consumption、cooldown、timer を新しい epoch へ初期化する。
6. `initialStepId` を有効にして Step entry runtime time を更新し、entry 処理後から Trigger 評価を開始する。
7. 完成した state に対する `GroupEntered` と `StepEntered` を確定する。

Group exit / entry は一つの canonical transition として適用し、途中状態を Cue 評価へ公開しない。旧 Group の Cue が同じ Action batch で変更した presentation-owned resource は entry 後もその値を維持する。inactive Group の Runtime State は保持せず、Snapshot にも含めない。

v1 の Group reentry policy は `reset` に固定する。Group ごとの進行位置や Timeline elapsed を保持する `resume` は checkpoint 契約が必要になるため含めない。

### 12.11 Reliable Event、State Stream、Snapshot

進行に関する離散的決定は Reliable Control へ送る。

```text
RuntimeStatusChanged
GroupEntered / GroupExited
CueAccepted
SurfaceStateChanged
NodeStateCommitted
TimelineStarted / TimelineCompleted / TimelineCanceled
VariableChanged
StepEntered
PresentationEnded
```

Reliable Event は session 内で単調増加する `sequence`、冪等適用用の `eventId`、原因となった `causeEventId`、runtime time、release と origin の識別情報を持つ。Texture variant や Unity renderer 情報は payload に含めない。

Pose、Timeline の毎 frame 補間値、連続的な Element State frame は latest-wins の State Stream とし、event log へ保存しない。離散的な Cue 採用と最終状態は Reliable Event と Snapshot の両方へ反映する。

```ts
type SharedRuntimeSnapshot = {
  snapshotVersion: number;
  runtimeId: RuntimeId;
  releaseId: ReleaseId;
  presentationRevision: number;
  definitionHash: string;
  renderBundleHash: string;
  reliableSequence: number;

  runtimeStatus: "running" | "paused" | "terminating";
  progression: ProgressionRuntimeState;
  surfaceStates: Record<SurfaceId, SurfaceRuntimeState>;
  nodeStates: Record<NodeId, NodeRuntimeState>;
  mediaStates: Record<SurfaceId, MediaRuntimeState>;
  variables: Record<VariableId, Scalar>;
  activeRuns: RuntimeRunSnapshot[];
  presentationOrigin: PresentationOrigin;
  presence: SharedPresenceState;

  stepCueState: {
    stepEntryEpoch: number;
    consumedCueIds: CueId[];
    cooldownDeadlines: Record<CueId, number>;
    timerDeadlines: Record<CueId, number>;
  };
  recentEventIds: string[];
  triggerEdgeMemory: TriggerEdgeMemory;
};
```

`surfaceStates`、`nodeStates`、`mediaStates`、`variables`、`activeRuns` は presentation-owned resource と Snapshot の `currentGroupId` に属する resource だけを含む。group-owned Runtime Run は `groupId` と `groupEntryEpoch` が Snapshot の progression と一致しなければならない。inactive Group の状態を暗黙的な checkpoint として保持しない。

`SharedRuntimeSnapshot` は Venue Edge の recovery と canonical state transfer に使用する内部 contract であり、client へそのまま配信しない。再接続 client は自身の `ProjectionInstance` に対応する `ProjectedRuntimeSnapshot` を適用した後、同じ `projectionProfileId` と `assignmentEpoch` を持つ `reliableSequence + 1` 以降の projected Reliable Event を順序適用する。不一致の場合は DeliveryManifest と Snapshot を再取得する。

Timeline の tick 履歴は replay せず、Runtime Run の開始時刻と elapsed から現在値を再計算する。Definition、RenderBundle、Snapshot の hash または revision が一致しない場合は実行を開始しない。Shared / Projected Snapshot の正確な wire schema と recovery 手順は次の Runtime Run / Snapshot follow-up で固定する。

### 12.12 v1 validation requirements

Compiler、Control Plane、Delivery projection は少なくとも次を検証する。

- `initialGroupId`、`initialStepId`、Cue の `next` が存在する。
- Cue、Surface、Surface State、Timeline、Node、Variable の参照先が存在する。
- すべての group owner が存在し、resource kind ごとの ID が PresentationDefinition 全体で一意である。
- presentation-owned resource が group-owned resource を参照せず、Group G-owned resource / Cue が別 Group の resource を参照しない。
- Spatial parent、Timeline target、Component Instance から生成した resource、SurfaceNode から継承する resource の owner が lifetime 規則と一致する。
- PresentationDefinition と Release に concrete `ParticipantId` が含まれず、Shared Spatial Tree の Anchor owner が Presenter selector だけである。
- Trigger の actor / subject selector と producer の組み合わせが 12.5 の規則に一致し、Viewer input から Shared Action へ到達する経路がない。
- participant actor が認証済み connection identity から、System actor が許可された内部 event source からだけ生成される。
- 同じ `ProjectionProfileKey` が同じ canonical profile を生成し、profile に participant / assignment 固有値や Signed URL が含まれない。
- ProjectionProfileDescriptor の visible resource set が参照 closure を満たし、capability 差が認可や Shared semantic state を変更しない。
- Projected Snapshot / Event / State Frame の `projectionProfileId` と `assignmentEpoch` が受信 participant の ProjectionInstance と一致する。
- 同じ Step に `priority` と `order` が重複する Cue がない。
- Timeline keyframe の時刻、型、Quaternion、duration が正しく、各 track が `0 ms` と duration を境界に持つ。
- 同一 Timeline 内で `target/property` が競合しない。
- 同一 Cue の Action batch に v1 で許可されない property conflict がない。
- Surface State と renderer artifact、hit region の対応が完全である。
- `surfaceInteraction` が参照する Interaction が対象 Surface State で利用できる。
- Surface transition 中に interaction が有効化されない。
- Group exit をまたいで blocking run が残らない。
- group-owned Runtime Run の `groupId` と `groupEntryEpoch` が現在の Group entry と一致する。
- Snapshot が Step entry、timer deadline、Cue state、active Runtime Run を復元できる。
- Snapshot が presentation-owned resource と current Group-owned resource だけを含む。
- zero-duration の内部イベントだけで到達できる無限遷移がない。
- Snapshot に renderer artifact ID、Signed URL、raw Pose history が含まれない。

Conformance test では、event の重複、Cue 競合、cooldown、遷移中の追加入力、Timeline conflict、scope を越える不正参照、Presenter / Viewer の role spoof、client 起点の System event、actor と subject の不正な組み合わせ、Presenter Anchor unavailable、profile の共有と participant 固有値の隔離、unauthorized resource の配信前除外、projection profile / assignment mismatch、Client-local State が Shared State に混入しないこと、presentation-owned state の Group 間継続、group-owned state の exit 時破棄と reentry reset、Pause / Resume、Snapshot + Replay 後の状態一致を検証する。

### 12.13 Example

次の Cue は Presenter の `next` で title Surface を `shown` にし、Surface crossfade と Model Timeline の完了後に次の Step へ進む。

```ts
const showTitle: CueDefinition = {
  id: "show-title",
  priority: 100,
  order: 0,
  trigger: {
    kind: "logicalInput",
    action: "presenter.next",
    actor: { kind: "presenter" },
  },
  firePolicy: { kind: "oncePerStepEntry" },
  actions: [
    {
      kind: "surface.setState",
      surfaceId: "title",
      stateId: "shown",
      transition: {
        kind: "crossfade",
        durationMilliseconds: 300,
        easing: "easeOut",
        completion: "blocking",
      },
    },
    {
      kind: "timeline.play",
      timelineId: "model-enter",
      completion: "blocking",
      conflict: "reject",
    },
  ],
  next: { kind: "step", stepId: "intro-shown" },
};
```

Cue を受理すると `title.stateId` は直ちに `shown` になり、Progression Phase は `transitioning` になる。この間の二回目の `presenter.next` は無視する。Surface transition と `model-enter` が両方完了した時点で `intro-shown` へ遷移する。

## 13. Interaction と Semantic Metadata

### 13.1 Logical Event

Device 固有入力を Presentation Flow へ直接保存しない。Unity または入力 adapter が device input を Logical Event へ変換する。

```text
presenter.next
quiz.answer.a
timer.completed
presenter.enterZone
```

### 13.2 Semantic Tree

Texture 化された Surface でも内容の意味を失わないよう、表示 artifact と Semantic Tree を分離する。

```ts
type SemanticNode = {
  id: SemanticNodeId;
  parentId: SemanticNodeId | null;
  order: number;
  role: "heading" | "paragraph" | "image" | "button" | "table" | "list" | "listItem";
  text?: string;
  language?: string;
  alt?: string;
  actionId?: InteractionId;
};
```

Semantic Tree は検索、翻訳、読み上げ、caption、presenter notes、Agent editing、accessibility の基礎として使用する。

Semantic Tree は Surface State ごとに解決済みの完全 Tree を持つ。v1 では状態差分だけを保存して適用する形式を採用せず、最適化は後から追加する。

### 13.3 Hit Region

Baked Surface の interaction は、Authoring 上の semantic interaction を build 時に解決した hit region として Delivery する。

```ts
type ResolvedInteractiveRegion = {
  interactionId: InteractionId;
  semanticNodeId: SemanticNodeId;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  coordinateSpace: "normalized";
  event: LogicalEventName;
  priority: number;
};
```

Hit region は Semantic Surface State ごとに解決し、bounds は Render Surface ではなく Semantic Surface 全体の normalized coordinate space で表す。UV 原点、fit/crop、overlap priority、visibility を Delivery contract で固定する。v1 は矩形 click interaction に限定する。

## 14. RenderBundle

```ts
type RenderBundle = {
  schemaVersion: 1;
  bundleId: string;
  sourceHash: string;
  definitionHash: string;

  compiler: {
    name: string;
    version: string;
    environmentHash: string;
  };

  buildContext: {
    locale: string;
    timezone: string;
    colorScheme: "light" | "dark";
    themeId: ThemeId;
    themeHash: string;
  };

  surfaces: Record<SemanticSurfaceId, CompiledSemanticSurface>;
};
```

### 14.1 Compiled Semantic Surface

```ts
type CompiledSemanticSurface = {
  semanticSurfaceId: SemanticSurfaceId;
  logicalSize: [number, number];
  physicalSizeMeters: [number, number];
  renderSurfaceIds: RenderSurfaceId[];
  renderSurfaces: Record<RenderSurfaceId, RenderSurface>;
  semanticsByState: Record<SurfaceStateId, SemanticTree>;
  interactionsByState: Record<SurfaceStateId, ResolvedInteractiveRegion[]>;
};
```

RenderBundle の `surfaces` key は PresentationDefinition の SemanticSurfaceId と一致し、RenderSurfaceId から意味対象を逆引きしない。Semantic Tree と Hit Region は Semantic Surface State ごとに解決する。実行中は canonical `stateId` に対応する Semantic Tree を accessibility と意味的な interaction に使用し、transition 中の Hit Region は 12.4 の規則に従う。

各 Render Surface の `SurfaceRendererArtifact` は次の discriminated union とする。

- `BakedWebArtifact`
- `NativeUIArtifact`
- `VideoArtifact`

### 14.2 Baked Web Artifact

Surface State ごとに一つ以上の解像度 artifact を持つ。

```text
BakedWebArtifact
└─ states
   ├─ idle
   │  ├─ 1K texture
   │  ├─ 2K texture
   │  └─ hit regions
   └─ selected
      ├─ 1K texture
      ├─ 2K texture
      └─ hit regions
```

各 texture artifact は Asset ID、media type、pixel size、checksum、color space、alpha mode を保持する。

### 14.3 Native UI Artifact

Native UI Artifact は portable UI tree と、Runtime から変更可能な property の allowlist を持つ。更新可能 property は、宣言された Runtime Variable または Runtime Clock への declarative binding で接続する。任意の JSON property mutation や client 固有の完了判定は許可しない。Timer や Counter の完了は Venue Edge authority が判定する。

### 14.4 Video Artifact

Video Artifact は Asset ID、checksum、duration、loop、alpha、audio、codec capability を保持する。

## 15. コンパイルと配信

```text
Orchestrator / Manifest / Structured Component Structure
        ├─ Parse → Lossless Syntax Tree / Source Map
        ├─ Import / Symbol resolution / Typecheck
        └─ Static AST lowering
                    ↓
            Declaration Graph
                    ↓ Normalize / Validate with Syntax Tree
Semantic Authoring IR
        ↓
Component Manifest resolution
        ↓
Component / Slot / Variant expansion
        ↓
Theme / Token resolution
        ↓
Surface partition
        ├──────────────────────────────────────┐
        │                                      │
        │       Opaque Renderer TS / React / CSS
        │                    ↓ Bundle
        │             Renderer Artifact
        │                    ↓ Isolated Browser rendering
        └────────────────────┤
                             ↓
Browser capture / Native UI plan / Video generation
        ↓
Canonical PresentationDefinition JSON + RenderBundle
        ↓ publish
Immutable Release
        ↓ Control Plane validation and role / capability projection
DeliveryManifest
        ↓
Unity Runtime
```

### Local Compiler

- Authoring Source を parse し、Lossless Syntax Tree、Source Map、Stable ID の対応を保持する。
- Presentation Orchestrator、Component Manifest、Structured Component Structure の import、symbol、型、DSL signature を解決し、検証済み AST から Declaration Graph へ静的に lower する。
- Opaque renderer の TS / React / CSS だけを通常の module として bundle し、renderer artifact を生成する。
- Declaration Graph を正規化し、Syntax Tree / Source Map と対応する Semantic Authoring IR を生成する。
- Component、Slot、Variant を解決する。
- Theme、Token、Style を解決する。
- Surface boundary を決める。
- Browser 環境で Layout と capture を行う。
- Texture、Video、Native UI plan を生成する。
- Semantic Tree、hit region、source map を生成する。
- PresentationDefinition を canonical JSON として serialize する。
- PresentationDefinition と RenderBundle の hash を対応付ける。

Static lowering が参照できる入力は、Authoring Source、lock された Component package、Theme、Asset metadata、Compiler configuration に限定する。同じ source、lockfile、compiler version、configuration から同じ Declaration Graph と PresentationDefinition JSON を生成する。Opaque renderer artifact の Browser 実行は別の隔離境界とし、その capability と再現性は Rendering / Delivery contract で固定する。

### Control Plane

- Authoring source や renderer implementation を実行しない。
- PresentationDefinition と RenderBundle の schema、hash、revision を検証する。
- Asset ownership、ready status、checksum を検証する。
- Release、認可済み role、正規化済み capability profile から共有可能な ProjectionProfileDescriptor を生成する。
- profile を participant / assignment 固有の ProjectionInstance と Asset access binding へ結合して DeliveryManifest を生成する。
- Signed URL を生成し、永続化しない。
- Definition と RenderBundle の異なる revision を混在させない。

### Immutable Release

Release は publish された `PresentationDefinition`、`RenderBundle`、Asset Set、各 contract version を一つに束ねた immutable な実行単位である。Room と Session は一つの Release を pin し、Snapshot と Reliable Event はその Release を識別する。Draft の変更を active Room へ反映する方法、または Session 中に Release を差し替える方法は、この文書では決めない。

### Unity Runtime

- DeliveryManifest を検証する。
- ProjectionInstance、Projected Runtime Snapshot / Event / State Frame の profile と assignment fence を検証する。
- Runtime renderer graph を構築する。
- Asset を download、cache、preload、unload する。
- Spatial Transform、Anchor、State、Transition、Playback を適用する。
- Device input を Logical Event へ変換する。
- calibration、viewport、selection、personal annotation、Local Overlay state を Client-local State として所有する。
- TSX、CSS、React、Component implementation を解釈しない。

## 16. 想定ファイル構成

```text
presentation/
├─ presentation.unframe.tsx
├─ theme.unframe.ts
├─ components/
│  ├─ Hero/
│  │  ├─ Hero.manifest.ts
│  │  └─ Hero.structure.tsx
│  ├─ Counter/
│  │  ├─ Counter.manifest.ts
│  │  └─ Counter.structure.tsx
│  └─ CustomChart/
│     ├─ CustomChart.manifest.ts
│     ├─ CustomChart.web.tsx
│     └─ CustomChart.css
├─ assets/
├─ .unframe-cache/
│  └─ renderers/
│     └─ CustomChart.web.bundle.js
└─ dist/
   ├─ presentation.definition.json
   ├─ presentation.render-bundle.json
   ├─ presentation.delivery-manifest.pb
   └─ generated-assets/
```

`.unframe-cache/renderers/` は Local Compiler が Opaque renderer source から再生成できる中間 bundle を保持できるが、version control、publish、Release には含めない。Release に含める renderer artifact は RenderBundle の一部として hash と provenance を固定する。

`dist/presentation.definition.json` は v1 の最終的な PresentationDefinition artifact である。ただし、GUI / Code 編集を JSON だけで継続することは保証せず、Authoring Source と Semantic Authoring IR の対応情報は別に保持する。

## 17. 現行実装との関係

この文書は目標アーキテクチャである。2026-08-25 時点の現行実装について、次を区別する。

### Current

- Control Plane の `PresentationDefinition` は JSON/OpenAPI 契約である。
- 現行 Definition は metadata、stage、asset references、Group、Element、Anchored Element Group、Step、Cue、Trigger、Action、Transition を持つ。
- Control Plane は Definition 全体を revision 条件付きで原子的に保存する。
- Asset URL や object key は Definition に保存せず、Asset IDで参照する。
- 現行 Web Editor は Slide ベースの PoC model を使用しており、target PresentationDefinitionへ未接続である。
- Unity の手書き importer は target PresentationDefinition の完成 consumer ではない。

### Target, not implemented

- Semantic Authoring IR
- `.unframe.tsx` Orchestrator
- Orchestrator / Manifest / Structure AST の static lowering、Declaration Graph normalization、Opaque renderer bundling の build pipeline
- Canonical `presentation.definition.json` の deterministic serialization
- Component Manifest と package format
- Structured / Opaque authoring mode
- Spatial Tree / Surface Tree の canonical schema
- Frame Layout、Theme、Token、Named Style
- Surface Render Intent
- RenderBundle
- Surface State artifact、semantic tree、hit region
- v1 Presentation Progression semantic model の実装と、Progression wire / Runtime contract
- Native UI portable contract
- DeliveryManifest Protobuf
- Unity の hybrid renderer graph
- Deterministic Local Compiler

既存の `PresentationDefinition` schema をこの文書だけで置き換えたとはみなさない。実装時は契約変更、migration、OpenAPI/Protobuf artifact、Web/Unity consumer、contract testを同期する。

## 18. 採用済みの設計判断

- 意味モデルを中心に Code、GUI、build、delivery、runtime を分離する。
- `.unframe.tsx` は Composition Root とする。
- Component Manifest と renderer implementation を分離する。
- Structured Component は独立した Component Structure を正本とし、Component 固有 renderer implementation を持たない。
- Opaque Component は Manifest を意味の正本、Component 固有 renderer を描画の正本とし、editable Detach を許可しない。
- Component Action は宣言的な compile-time macro とし、canonical Action batch へ完全に展開する。
- Component Output は明示された event producer と固定 Scalar payload を持ち、canonical Trigger へ完全に展開する。
- GUI と Code は Semantic Authoring IR を共有する。
- GUI は Lossless Syntax Tree と Source Map で Code を書き換え、Declaration Graph や renderer artifact から Code を逆生成しない。
- Structured と Opaque Component を区別する。
- Local Compiler は Orchestrator、Manifest、Structure を実行せず、検証済み AST から Declaration Graph へ静的に lower する。
- Opaque renderer だけを通常の TS / React / CSS として bundle し、renderer artifact の意味は静的に lower した Manifest と binding key で接続する。
- v1 の最終 PresentationDefinition artifact は canonical JSON とする。
- Scene Graph は Spatial Tree と Surface Tree からなる 2.5D 構造とする。
- Group は進行スコープ、Scene Graph は空間親子関係とする。
- Runtime resource owner は presentation または一つの Group に限定し、Step scope と Group ごとの ID namespace を作らない。
- ownership は Spatial parent と分離し、resource 参照は同じまたは長い lifetime への方向だけを許可する。
- presentation-owned Runtime State / Run は Group をまたいで継続し、group-owned state は exit で破棄して reentry で reset する。
- SurfaceNode と Semantic Surface は 1:1、Semantic Surface と Render Surface は 1:N とする。
- SurfaceNode は Spatial Transform、Semantic Surface は State / Interaction、Render Surface は描画 partition を所有する。
- canonical Runtime contract の SurfaceId は SemanticSurfaceId を意味し、RenderSurfaceId を Progression と Runtime State に含めない。
- Semantic Surface は physical size と logical size を持つ。
- Frame Layout は `absolute`、`stack`、`grid`から始める。
- Theme は型付きTokenとNamed Styleを持つ。
- ComponentとSurfaceを同一視しない。
- RendererはCompilerの出力戦略とする。
- UnityとControl Planeはauthoring codeを実行しない。
- Domain Stateとrenderer artifactを分離する。
- Semantic metadataをTextureから分離する。
- PresentationDefinition、RenderBundle、DeliveryManifest、Runtime Stateを別契約にする。
- v1 semantic baseline として Group を State Machine scope、Step を進行状態、Cue を遷移候補に固定する。
- Venue Edge が Trigger、Guard、Cue、Action、Timeline 完了を canonical evaluationする。
- 一イベントにつき一 Cue を選択し、Cue 内の Action batch を事前検証後に atomic 適用する。
- Surface State は意味論的 ID とし、renderer artifact から分離する。
- blocking run の完了後に次の Step へ進み、遷移中の通常 input は無視する。
- Group 再入場は reset とし、Snapshot と Reliable Event から同じ進行状態へ収束できるようにする。
- Room / Session は immutable Release を pin し、Draft と実行中の状態を混在させない。

## 19. Follow-ups

以下は採用済みの architecture baseline を実装契約へ落とすための follow-up である。特に最初の項目群は、Progression wire / Runtime contract を v1 として固定する前に閉じる。

### Resolved follow-ups

- [x] Component Action / Output の canonical Action / event source への lowering 規則を 5.5 で定義した。
- [x] Structured Component の Component Structure と renderer implementation の source boundary を 5.2〜5.4 で定義した。
- [x] Static Authoring DSL、AST lowering、Declaration Graph normalization、semantic round-trip、source mapping、Detach の compiler contract を 5.4 と 6.1〜6.4 で定義した。
- [x] SurfaceNode、Semantic Surface、Render Surface の identity、cardinality、lowering、Runtime 参照規則を 7.2〜7.5 と 14.1 で定義した。
- [x] Group scope / presentation scope の resource owner、参照方向、lifecycle、Runtime State 保持規則を 7.1 と 12.2〜12.12 で定義した。
- [x] actor、subject、Anchor owner の型、解決境界、認可規則を 7.3 と 12.5 で定義した。
- [x] Shared Runtime State、Participant Runtime View、Client-local State の authority、producer、profile / instance、projection schema を 3.5 と 3.7 で定義した。

### Progression wire / Runtime contract の blocking follow-ups

1. Step entry epoch、timer deadline、step ごとの Cue 消費状態、Runtime Run の Snapshot schema
2. Action conflict matrix と Runtime fault / Pause の扱い
3. Surface transition の完了、interaction、hit region 有効化の wire 表現
4. Timeline の absolute interpolation、Quaternion、Run lifecycle の wire 表現
5. Release、Room、Session、Snapshot の参照整合性と、Draft を active Room へ反映する規則
6. Reliable Event / Snapshot / State Stream の transport schema、保持期間、runtime microstep 上限

### Rendering / Delivery の follow-ups

1. Semantic Surface の state ごとの完全 Semantic Tree と Hit Region schema
2. Native UI portable subset と Runtime Variable / Clock binding
3. Transform 合成、Quaternion 乗算、matrix layout、Unity 変換、Surface / UV 変換の完全な座標規約
4. Component から Surface への分割規則、partition の自動化範囲、author override
5. Texture state artifact 数と GPU / RAM build budget
6. Resolution、mipmap、compression、preload、eviction policy
7. Component Manifest と renderer implementation の drift 検証
8. Opaque renderer の Browser capability、module resolution、cache invalidation と Compiler / Browser / Font / Locale の再現性
9. DeliveryManifest Protobuf schema、capability negotiation、visual regression test

## 20. 次の設計対象

次は Surface Partition ではなく、Progression wire / Runtime contract の blocking follow-ups を順に閉じる。推奨順序は次のとおりである。

1. Snapshot / Runtime Run
2. Immutable Release
3. Surface transition / Action conflict
4. Timeline interpolation
5. Semantic Tree / Native UI binding
6. Spatial / Surface coordinate convention
7. Surface Partition
8. Texture / GPU / RAM budget

中心となる思想は次のとおりである。

> `.unframe.tsx` は Presentation の composition root、Component Manifest は公開契約、Semantic Authoring IR は GUI と Code の共通モデルとする。Local Compiler は Orchestrator、Manifest、Structure を AST から静的に lower し、Opaque renderer だけを bundle して、canonical PresentationDefinition JSON と renderer artifact へ build する。
