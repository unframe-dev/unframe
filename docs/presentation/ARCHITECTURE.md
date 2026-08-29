# Unframe Presentation Architecture

- **Status**: Adopted design baseline
- **Date**: 2026-08-25
- **Scope**: Presentation authoring, compilation, delivery, and runtime target architecture
- **Maturity**:
  - Architecture baseline: adopted
  - Presentation Progression semantic model: v1 baseline
  - Progression semantic wire contract: Accepted（transport protobuf schema は Draft・未実装）
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
Current Published Presentation
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
           └─ Session (references Presentation and pins PublicationFence)
                  │
                  ▼
              Assigned Runtime Core
              ├─ Cloud or Venue Edge deployment profile
              ├─ Canonical progression
              ├─ Reliable Control / Snapshot
              └─ Latest-wins State Stream
                  │
                  ▼
              Same Unity Runtime clients
```

Session path の authority は Cloud または Venue Edge に配置された割り当て済み Runtime Core である。Venue Edge profile は会場内 network、tracking / input ingress、Asset cache を追加できるが、Session の意味論的 authority を別に持たない。

### 基本原則

- TSX、JSON、Protobuf は用途ごとの表現形式とする。v1 の PresentationDefinition は canonical JSON として build するが、JSON を Authoring Source にはしない。
- `.unframe.tsx` はプレゼンテーション全体を直接描画する巨大な実装ではなく、Component の配置と接続を行う composition root とする。
- Component の公開契約と renderer 実装を分離する。
- GUI と Code は同じ Semantic Authoring IR を編集する。
- GUI が任意の TSX、CSS、JavaScript を完全に逆解析できるとはみなさない。
- Local Compiler は Presentation Orchestrator、Theme Declaration、Component Manifest、Component Structure を parse / typecheck し、検証済み AST から Declaration Graph へ静的に lower する。これらを JavaScript として実行しない。
- Opaque renderer だけが通常の TS / React / CSS を bundle して renderer artifact を生成する。renderer の実行環境は Authoring DSL の lowering から分離する。
- Control Plane と Unity Runtime は Authoring Source、React、CSS、renderer source を実行しない。
- PresentationDefinition JSON、Texture、Video、Protobuf は生成物であり、編集元の正本にはしない。
- Presentation の意味、build 成果物、配信 projection、実行中状態を別の契約として扱う。
- Presentation は公開済みの実行物を一つだけ持つ。Session は Presentation を参照し、作成時の PublicationFence を固定して実行中に Draft や後続 publish を参照しない。
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
├─ PublicationFence / PresentationDefinition / RenderBundle hash
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
type PublicationFence = {
  presentationId: PresentationId;
  publicationEpoch: number;
  publicationManifestHash: ContentHash;
};

type ProjectionProfileKey = {
  publication: PublicationFence;
  projectionContractVersion: number;
  role: SessionRole;
  capabilityProfileId: CapabilityProfileId;
};

type DeliveredRenderSurface = {
  semanticSurfaceId: SemanticSurfaceId;
  logicalBounds: LogicalBounds;
  layer: UInt32;
  rendererKind: "baked-web" | "native-ui" | "video";
  artifactContractVersion: UInt32;
  stateBindings: Record<
    SurfaceStateId,
    { kind: "empty" } | { kind: "artifact"; artifactId: RendererArtifactId }
  >;
};

type ProjectedSemanticSurface = {
  renderSurfaceIds: RenderSurfaceId[];
  semanticsByState: Record<SurfaceStateId, ProjectedSemanticTree>;
  interactionsByState: Record<SurfaceStateId, ResolvedInteractiveRegion[]>;
};

type ProjectionProfileDescriptor = {
  projectionProfileId: ProjectionProfileId;
  key: ProjectionProfileKey;
  visibleNodeIds: SpatialNodeId[];
  visibleSurfaceIds: SemanticSurfaceId[];
  visibleVariableIds: VariableId[];
  renderSurfaces: Record<RenderSurfaceId, DeliveredRenderSurface>;
  semanticSurfaces: Record<SemanticSurfaceId, ProjectedSemanticSurface>;
  localOverlays: LocalOverlayDefinition[];
};

type ProjectionInstance = {
  projectionProfileId: ProjectionProfileId;
  participantId: ParticipantId;
  assignmentEpoch: number;
};

type AssetAccessBinding = {
  assetId: AssetId;
  checksum: ContentHash;
  url: string;
  expiresAt: string;
};

type DeliveryManifest = {
  deliveryContractVersion: number;
  sessionId: SessionId;
  publication: PublicationFence;
  definitionHash: ContentHash;
  renderBundleHash: ContentHash;
  projectionProfile: ProjectionProfileDescriptor;
  projectionInstance: ProjectionInstance;
  assetAccess: AssetAccessBinding[];
};
```

各`ProjectedSemanticSurface.renderSurfaceIds`はimmutable RenderBundleの該当Semantic Surfaceに属する完全なpartition集合をlayer昇順でexactly onceに持つ。`ProjectionProfileDescriptor.renderSurfaces`のkey集合はvisible Semantic Surfaceごとのordered IDのunionと一致し、各`DeliveredRenderSurface`の`semanticSurfaceId`、`logicalBounds`、`layer`はRenderBundle metadataと完全一致しなければならない。不可視Surfaceのpartition、欠落・余分・duplicate ID、layer gap / duplicate、metadata drift、compatible artifact不在はprofile単位でatomicに拒否する。Deliveryは`rendererKind`、artifact自身の`contractVersion` / `requiredFeatures`、target capabilityから`artifactContractVersion`とbindingを選び、build時renderer identityのstring `contractVersion`とは比較しない。

Control Plane は同じ `ProjectionProfileKey` から同じ `ProjectionProfileDescriptor` を生成し、profile 単位で cache / 共有できるようにする。`projectionContractVersion` は visibility closure と renderer 選択規則を含む projection algorithm の互換性境界であり、cache namespace の一部とする。`ProjectionProfileId` は descriptor の canonical content に対応し、同じ PublicationFence、projection contract version、role、正規化済み capability profile の participant ごとに作り直さない。

Profile は `participantId`、`assignmentEpoch`、endpoint、credential、Signed URL を含まない。これらの participant / assignment 固有値と期限付き Asset access binding は DeliveryManifest の instance 側で解決する。client が申告した capability を authorization に使用せず、Control Plane が正規化・検証した `CapabilityProfileId` は renderer compatibility の選択だけに使用する。

`DeliveredRenderSurface` は Render Surface ごと、かつ到達可能な Surface State ごとに選択結果を固定する。`empty` 以外の各 state は同じ renderer contract で解釈できる artifact を一つ持たなければならず、Unity が実行時に候補から再選択しない。これにより、state A と state B が異なる artifact を必要とする場合も一つの profile で完全に配信できる。

Compiler は artifact ごとに参照する Variable ID の dependency を RenderBundle へ記録する。Control Plane は profile で選択した visible な Native UI artifact の dependency closure から `visibleVariableIds` を導出する。profile はこの集合にない Variable を Runtime View、Snapshot、Event、State Frame に含めない。`CapabilityProfileId` が指す正規化済み profile は、対応する Delivery / Runtime protocol version、renderer kind と contract version、Native UI feature / limit、Texture dimension / format / mipmap / color / alpha、Video codec / alpha / audio、GPU / RAM budget tier、Local Overlay support を持つ。Control Plane は登録済み client build、device class、認証済み bootstrap の情報から profile を決める。client の自己申告だけで profile を拡張しない。

PublishedPresentation の必須 capability と profile の共通部分から完全な renderer graph を作れない場合は、Session 開始前に型付き incompatibility として拒否する。`fallbackPolicy: "degrade"` は Compiler が事前生成し検証した代替 artifact の選択だけを許し、Unity による暗黙の renderer 置換や解像度低下は許可しない。

DeliveryManifest の wire source は `packages/contracts/proto/` に置く Protobuf とする。top-level、projection、renderer、Native UI の各 contract は独立した version を持ち、breaking change では新しい major package または明示的な contract version を使う。同じ major で許可するのは、省略時の意味が固定された optional field と、受信側が安全に無視できる非必須 feature の追加だけとする。未知の required feature、unknown enum、必須 field の欠落、hash / PublicationFence / assignment epoch の不一致は fail closed とする。Signed URL は期限付き instance data であり、canonical profile ID や PublishedPresentation hash の入力にしない。

### 3.6 Published Presentation と active-use lock

Presentation は過去の公開版を選択可能な履歴として保持せず、互いに整合する PresentationDefinition、RenderBundle、Asset Set、contract version を束ねた公開済み実行物を一つだけ持つ。公開済み実行物は一つの immutable value とし、更新時は内部 artifact を差し替えず、新しい value へ atomic に置換する。

```ts
type PublishedPresentation = PublicationFence & {
  sourceDraftRevision: number;
  buildId: PresentationBuildId;
  definitionHash: ContentHash;
  renderBundleHash: ContentHash;
  assetSetHash: ContentHash;
  contractVersions: ContractVersions;
};

type SessionPublicationBinding = PublicationFence & {
  sessionId: SessionId;
};
```

`publicationEpoch` は Presentation ごとに単調増加し、過去版を閲覧・選択するためではなく、古い Assignment、credential、DeliveryManifest、Snapshot、Reliable Event、State Frame を拒否する fence とする。`publicationManifestHash` は自身の field を除く PublishedPresentation の canonical manifest から計算し、Definition、RenderBundle、Asset Set、contract version の組み合わせを検証する。

Session は `presentationId` を参照し、公開版を選択しない。Session 作成時に Control Plane がその Presentation の現在の PublicationFence を `SessionPublicationBinding` としてコピーし、`Waiting`、`Presenting`、`Ended` の全期間で変更しない。新しい Session は常に作成時点の最新公開物を使用し、未publishのPresentationからはSessionを作成できない。

同じ Presentation を参照する期限内の `Waiting` Session または `Presenting` Session が一つでも存在する間、Control Plane は publish を拒否する。Session 作成、期限切れ `Waiting` Session の終了、publish は同じ永続化境界で直列化し、publish と同時に古い公開物を参照する Session が作られないようにする。`Ended` だけが publish lock を解放する。

`Waiting` は作成時に有限の `waitingExpiresAt` を持つ。Presentation owner または admin は、その Session の presenter でなくても `Waiting` Session を cancel して `Ended` にできる。publish の直列化処理は期限切れの `Waiting` Session を同じ永続化境界で `Ended / waitingExpired` にした後、残る active-use lock を判定する。通常の editor 操作、viewer join、接続切断だけで期限を延長せず、延長を許可する場合も認証済み presenter の明示操作と上限付き lease として定義する。`Presenting` は waiting lease では自動終了せず、通常の Session end または Runtime recovery timeout に従う。これにより editor が作成後に放置した Session が publish を無期限に妨げない。

active-use lock 中も Draft 編集と build は許可する。publish は `expectedDraftRevision`、`buildId`、build の source revision、artifact hash、Asset readiness を検証し、すべて一致する場合だけ `publicationEpoch` を増やして現在の PublishedPresentation を atomic に置換する。Draft が build 後に更新されていれば conflict とし、暗黙に最新 Draft を取り込まない。

過去の PublishedPresentation を rollback や Session ごとの選択肢として保持しない。置換前 artifact は active Session から参照されないことを確認した後、Draft、Build cache、監査保持など別の参照がなければ GC できる。監査 log に epoch と hash を残すことは、過去の実行 artifact を製品機能として保持することを意味しない。

### 3.7 Runtime State

Session 中に変化する状態であり、PresentationDefinition や RenderBundle へ書き戻さない。

| Layer                    | Authority                 | Producer                                 | 保持・復元                                         |
| ------------------------ | ------------------------- | ---------------------------------------- | -------------------------------------------------- |
| Shared Runtime State     | 割り当て済み Runtime Core | 割り当て済み Runtime Core                | Snapshot / Reliable Event。高頻度値は State Stream |
| Participant Runtime View | なし。派生 view           | Runtime Core（profile は Control Plane） | profile と Shared Runtime State から再生成         |
| Client-local State       | Unity client / device     | Unity client                             | 必要な場合だけ端末内で保持                         |

#### Shared Runtime State

Session に割り当てられた Cloud または Venue Edge の Runtime Core が唯一の authority であり、すべての participant に共通する canonical state を保持する。

```ts
type SharedRuntimeState = {
  progression: ProgressionRuntimeState;
  nodeStates: Record<NodeId, NodeRuntimeState>;
  surfaceStates: Record<SurfaceId, SurfaceRuntimeState>;
  mediaStates: Record<SurfaceId, MediaRuntimeState>;
  variables: Record<VariableId, Scalar>;
  activeRuns: RuntimeRunSnapshot[];
  presentationOrigin: PresentationOrigin;
};
```

Progression、確定した resource state、Presentation Origin は Snapshot / Reliable Event へ反映する。Connection presence、Presenter Anchor sample、tracking-derived edge memory、Timeline の frame 間補間値は Runtime Core が生成する ephemeral runtime state とし、durable restore 対象へ含めない。Presence は authenticated connection registry から、tracking state は復旧後の新しい Tracking Frame から再構築する。

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
  clock: RuntimeClockSnapshot;
  presentationOrigin: PresentationOrigin;
  enabledLogicalInputs: LogicalEventName[];
};

type ProjectedRuntimeSnapshot = {
  projectionProfileId: ProjectionProfileId;
  assignmentEpoch: number;
  reliableSequence: number;
  runtimeView: ParticipantRuntimeView;
};
```

`presentationOrigin`はcanonical Snapshot cutからparticipantへ投影し、`presentationOriginVersion`とposeを同じimmutable valueで運ぶ。Presenter Anchor poseはephemeral tracking stateでありProjected Runtime Snapshotへ保存しない。State Streamはraw pose catalogではなく、profile内でvisibleなAnchor-bound Nodeごとにfollow指定された成分だけを初回keyframe / deltaへ投影する。該当Nodeは初回keyframeまたは後続fresh sampleを受け取るまでunavailableとし、描画とinteractionを開始しない。

Control Plane は PublishedPresentation、role、正規化済み capability profile から静的な `ProjectionProfileDescriptor` を生成する。割り当て済み Runtime Core はその profile、`ProjectionInstance`、Shared Runtime State を組み合わせ、participant ごとの Runtime View、Projected Runtime Snapshot、Reliable Event、State Frame を生成する。`variables` には descriptor の `visibleVariableIds` だけを含める。`clock` は Shared Runtime State の pause-aware logical clock の sample であり、client は `running` 中だけ受信 sample を基準に local monotonic clock で Native UI の表示を補間し、`paused` と `terminating` では補間を止める。timer の完了判定は常に割り当て済み Runtime Core だけが行い、再接続時は新しい Runtime View の clock sample から表示を再開する。Unity client は受信後に unauthorized resource を非表示化する authority を持たず、配信前の projection で除外する。

Role による visibility と ResourceOwner による lifetime は別概念とする。

```ts
type ProjectionAudience = { kind: "all" } | { kind: "role"; role: "presenter" | "viewer" };

type ProjectableResourceRef =
  | { kind: "node"; id: SpatialNodeId }
  | { kind: "surface"; id: SemanticSurfaceId }
  | { kind: "asset"; id: AssetId };
```

Spatial Node は `audience` を直接持ち、Semantic Surface、Interaction、Media、Render Surface は host Spatial Node から継承する。Asset は独立した audience を持たず、visible resource からの参照 closure に含まれる場合だけ access binding を生成する。resource は同じ audience またはそれより広い audience の resource だけを参照できる。つまり、`all` は `all`、`presenter` は `all`または`presenter`、`viewer`は`all`または`viewer`を参照でき、roleをまたぐ参照はできない。この規則に反する Spatial parent、Surface、Interaction、renderer、Asset の参照と、同じ Semantic Surface 内で異なる audience を混在させる構成は build error とする。

Projection は `ProjectableResourceRef` の参照 closure を満たさなければならない。visible resource が必要とする Spatial ancestor、Semantic Surface、renderer binding、Asset descriptor を欠く profile は Delivery 前に拒否する。capability 差は renderer / resolution / local overlay の選択だけを変え、Shared Progression、認可、semantic resource identity を変更しない。

Presenter notes の内容は PublishedPresentation 内の Presenter 限定 projection resource、control の利用可否は Shared Progression から導出する Runtime View、panel の開閉や hover は Client-local State とする。Projection 自体を Action target や Variable scope にしない。

#### Client-local State

Client-local State は participant の一つの device が所有し、Runtime Core の Snapshot、Reliable Event、Shared Guard / Cue / Action に混入させない。

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
    event("presenter.next").in("intro-idle").do(instance("hero").action("show")).to("intro-shown"),

    event(instance("timer").output("completed")).in("intro-shown").to("intro-completed"),
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

Partの`overridable`は`content`、`placement`、`style`に加えて`partition`を宣言できる。`partition` permissionを持つ公開Partだけがinstance側の`{ kind: "isolate" }`を受けられ、Structure Part bindingが一つのstable subtree rootへ解決する。authorはRenderSurfaceId、bounds、layer、rendererを指定しない。完全なpartition override contractは [ADR-0011](../decisions/0011-surface-partition-contract.md) を正本とする。

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

Opaque Manifest は Action / Output lowering に必要な公開 Runtime target を `semantics` として宣言する。`semantics` は Node、Surface、Surface State、Interaction、Timeline、Variable、Media の stable local ID と renderer binding key を持つ。各公開 Surface の semantic adapter は `baseSemanticTree` と State override を宣言できるが、これは accessibility / interaction の公開意味構造であり、renderer DOM、layout hierarchy、CSS、React component を表さない。これは editable な Component Structure ではなく、Opaque renderer と canonical Presentation model を接続する semantic adapter である。

Opaque renderer は Manifest の binding key に concrete geometry や artifact を対応付けるが、宣言済み target の意味や ID を変更できない。Compiler は Opaque Action / Output template の local target を `semantics` から解決し、参照先の欠落、ID や binding key の重複、必須 binding の未結合、renderer が追加した未宣言 binding を build error とする。

Component package lock は Opaque Component の Manifest hash と renderer entry hash を固定する。renderer source または依存 lock が変わった場合は package integrity と entry hash を変更し、renderer artifact を再生成する。完全な drift 検証と renderer provenance は Rendering / Delivery follow-up で定義する。

Presentation Orchestrator、Theme Declaration、Component Manifest、Structured Component Structure は、GUI の source mapping と意味論的 round-trip を成立させるため、静的解析できる制限付き DSL とする。Local Compiler は import、symbol、型を解決した検証済み AST から Declaration Graph へ直接 lower し、これらの source を JavaScript として実行しない。

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

| Output producer      | Canonical Trigger                                             | Actor                   |
| -------------------- | ------------------------------------------------------------- | ----------------------- |
| `surfaceInteraction` | 同じ canonical Interaction ID を参照する `surfaceInteraction` | v1 は認証済み Presenter |
| `timelineCompleted`  | 同じ canonical Timeline ID を参照する `timelineCompleted`     | System                  |
| `mediaCompleted`     | 同じ canonical Surface ID を参照する `mediaCompleted`         | System                  |
| `timer`              | `afterMilliseconds` を保持する Step timer                     | System                  |

`timer` は Component の mount 時刻ではなく、Output reference を含む Cue が属する Step の entry を基準にする。Step exit で破棄し、Step reentry では新しい `stepEntryEpoch` に属する timer として開始する。Native UI の Runtime Clock はこの同じ Step timer を表示へ binding できるが、完了判定と Output 発生は割り当て済み Runtime Core が行う。Component Output から別の `semanticEvent` を producer として参照することは v1 では許可しない。これにより producer chain と event cycle を作らない。

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

| Source                         | Compiler path                              | Output                                              |
| ------------------------------ | ------------------------------------------ | --------------------------------------------------- |
| Presentation Orchestrator      | parse / typecheck 後、AST から静的に lower | Presentation Declaration Graph                      |
| Theme Declaration              | parse / typecheck 後、AST から静的に lower | Theme Declaration Graph                             |
| Component Manifest             | parse / typecheck 後、AST から静的に lower | Component Declaration Graph（contract / semantics） |
| Structured Component Structure | parse / typecheck 後、AST から静的に lower | Component Declaration Graph fragment                |
| Opaque Component renderer      | 通常の TS / React / CSS として bundle      | renderer artifact                                   |

Declaration Graph は context-specific な root を持つ同じ宣言モデルとして、Orchestrator、Theme、Manifest、Structure の参照を接続する。Opaque renderer の React tree、DOM、CSS、実行結果は Declaration Graph ではない。Opaque renderer と Component semantics は Manifest の binding key だけで接続する。

### 6.2 Static Authoring DSL

Presentation Orchestrator、Theme Declaration、Component Manifest、Structured Component Structure は TypeScript / TSX の構文を使うが、JavaScript runtime semantics を持つ汎用プログラムではない。JSX は React JSX ではなく、Compiler が認識する宣言構文とする。

v1 の DSL で許可する構文は次に限定する。

- lockfile で固定した Component Manifest、Compiler SDK、Primitive、型の静的 ESM import
- `definePresentation`、`defineTheme`、Manifest builder、Structure Primitive など Compiler が認識する宣言 API
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
type ResourceOwner = { kind: "presentation" } | { kind: "group"; groupId: GroupId };

type OwnedResource = {
  owner: ResourceOwner;
};
```

ownership の正本は各独立 resource の `owner` とし、Group に `ownedNodeIds` などの重複した一覧を保存しない。Compiler / Delivery は canonical owner から Group ごとの activation index を派生生成できるが、その index を authoring の正本にしない。各 resource kind の ID は owner ごとの namespace ではなく、PresentationDefinition 全体で一意とする。

owner を直接持つ独立 resource と、owner を継承する resource を次に固定する。

| Resource                               | owner                            |
| -------------------------------------- | -------------------------------- |
| Component Instance                     | authoring declaration で所有     |
| Spatial Node、Timeline、Variable、Zone | `owner` を直接所有               |
| Semantic Surface                       | host SurfaceNode から継承        |
| SurfaceContentNode、Interaction        | Semantic Surface から継承        |
| Media Runtime State / Run              | Semantic Surface から継承        |
| Render Surface / renderer artifact     | Semantic Surface から継承        |
| Step / Cue                             | 構造上所属する Group に固定      |
| Asset、Theme、Component package        | Runtime lifecycle scope の対象外 |

ResourceOwner は immutable な Definition contract であり、Action や Runtime State から変更しない。owner は Spatial parent、`active`、`visible`、現在の Group と別概念とする。

参照は短い lifetime から同じまたは長い lifetime への方向だけを許可する。

| 参照元                      | 参照可能な target                                    |
| --------------------------- | ---------------------------------------------------- |
| presentation-owned resource | presentation-owned resource                          |
| group G-owned resource      | presentation-owned resource / group G-owned resource |
| Group G の Step / Cue       | presentation-owned resource / group G-owned resource |

presentation-owned resource から group-owned resource、Group A から Group B の resource への参照は build error とする。この規則は Spatial parent、Timeline target、Variable、Zone、Surface、Interaction、Action、Guard、Trigger の参照に共通して適用する。

`Cue.next.groupId` は別 Group への遷移先を示すため、この resource 参照規則の対象外とする。ただし遷移元 Cue が遷移先 Group の resource を Action、Guard、Trigger から参照する権限は与えない。

Spatial ownership と Spatial parent は分離する。group-owned Node は presentation-owned Node、Stage、Anchor を parent にできるが、presentation-owned Node は group-owned Node を parent にできず、異なる Group の Node 間に parent relation を作れない。Group は単一の Root Spatial Node を所有する必要はなく、Compiler は owner と parent relation から複数の group root を導出できる。

Presentation 全体で継続する背景、共有 HUD、累積 Variable、ambient media、Timeline は presentation-owned とする。Group の Step / Cue は presentation-owned resource を変更でき、その結果は次の Group にも残る。独立した global Cue は v1 に含めず、presentation-owned Surface の Interaction も現在の Group / Step に対応する Cue がある場合だけ Progression へ影響する。

### 7.2 Stable identity と Spatial Node Graph

Authoring と PresentationDefinition の ID、Compiler が生成する ID を分離する。

| ID                     | 所有 contract                                                     | 安定性                                              |
| ---------------------- | ----------------------------------------------------------------- | --------------------------------------------------- |
| `SpatialNodeId`        | Authoring Source / PresentationDefinition                         | author-stable                                       |
| `SurfaceNodeId`        | Authoring Source / PresentationDefinition                         | author-stable、`SpatialNodeId` の kind-safe subtype |
| `SemanticSurfaceId`    | Authoring Source / PresentationDefinition                         | author-stable                                       |
| `SurfaceContentNodeId` | Authoring Source / PresentationDefinition                         | Semantic Surface 内で author-stable                 |
| `SemanticNodeId`       | Structured Component Structure / Opaque Manifest semantic adapter | Semantic Surface 内で author-stable                 |
| `RenderSurfaceId`      | RenderBundle                                                      | compiler-derived、build-local                       |
| `RendererArtifactId`   | RenderBundle                                                      | compiler-derived、build-local                       |

既存の canonical Trigger、Guard、Action、Snapshot に現れる `SurfaceId` は `SemanticSurfaceId` を意味する。`NodeId` は `SpatialNodeId` を意味し、Surface Tree 内部の `SurfaceContentNodeId` を含めない。RenderSurfaceId は authoring API と PresentationDefinition に現れない。

Semantic Authoring IR と PresentationDefinition は Spatial Node を安定 ID で管理する。

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

type SpatialNodeBase = {
  id: SpatialNodeId;
  owner: ResourceOwner;
  audience: ProjectionAudience;
  parent: SpatialParent;
  order: number;
  name?: string;
};

type SceneGraph = {
  nodes: Record<SpatialNodeId, SpatialNode>;
  surfaces: Record<SemanticSurfaceId, SemanticSurface>;
};
```

Code 上の入れ子表現は parse 時に `parent` へ正規化する。`node` parent は参照先の存在を必須とし、その variant が作る graph だけで循環を禁止する。`stage` と `anchor` は graph root であり、架空の Spatial Node や単一の `rootNodeId` を作らない。`order` は同じ parent を持つ sibling 間の順序であり、ID と分離する。

### 7.3 Spatial Tree

- Position は meter とする。
- 座標系は right-handed、Y-up、forward -Z とする。
- Rotation は `[x, y, z, w]` 順の正規化 Quaternion とする。
- Scale は無次元倍率とする。
- Presentation Origin、Stage、Spatial Node、Body Anchor を親座標として扱う。

基礎座標規約はADR-0005、Transformの`T * R * S`、parent-first matrix積、Hamilton Quaternionとcanonical sign、column-major matrix、Unity境界のZ reflectionは [ADR-0010](../decisions/0010-spatial-surface-coordinate-contract.md) を正本とする。Spatial treeはlocal TRSを正本とし、non-uniform scaleとrotationから生じ得るworld shearを含むderived world値はmatrixを正本としてTRSへ再分解しない。

Shared Spatial Tree の Anchor owner は v1 では Session の Presenter だけとする。`ParticipantId` は Session 実行時の identity であり、PresentationDefinition、RenderBundle、PublishedPresentation へ埋め込まない。Viewer 自身の head / hand へ配置する UI は Shared Spatial Tree の node とせず、ProjectionProfileDescriptor の Local Overlay definition と Client-local State の `self` Anchor で表現する。

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
  baseSemanticTree: SemanticTreeDefinition;
  initialStateId: SurfaceStateId;
  states: Record<SurfaceStateId, SurfaceStateDefinition>;
  renderIntent: SurfaceRenderIntent;
};
```

`baseSemanticTree` は Surface の全 State が共有する意味構造の正本である。State は `SurfaceSemanticOverride` により既存 Node の可視性とroleが許すtext / language / alt / labelだけを変更でき、Node ID、role固有の構造field、parent、order、interactionの所属を変更したり、新しいSemantic Nodeを生成したりできない。これによりState間で意味対象とHit Regionの参照先を安定させる。

Surface local planeは中心原点、+X right、+Y up、front normal +Zとする。logical-to-meter変換は`fit`に従って中央寄せし、`contain`の余白はnon-content、`cover`のplane外はclip、`stretch`だけはaspect ratioを変更する。Render Surface内のrasterは左上原点、Unity UV0は左下原点として`u = rx`、`v = 1 - ry`で一度だけflipする。raycast、fit inverse、crop、Semantic Surface normalized Hit Regionの完全な式と境界規則は [ADR-0010](../decisions/0010-spatial-surface-coordinate-contract.md) を正本とする。

Compiler は次の invariant を検証する。

- `SurfaceNode.surfaceId` と `SemanticSurface.hostNodeId` が双方向に一致する。
- 一つの SurfaceNode は一つの Semantic Surface だけを host し、一つの Semantic Surface は一つの SurfaceNode だけを参照する。
- SurfaceNode は Spatial Tree 上の leaf とし、2D 内容を Spatial child として保持しない。
- `rootFrameId` とすべての SurfaceContentNode が同じ Semantic Surface に所属し、別 Surface の Node を親または child にしない。
- `physicalSizeMeters` と `logicalSize` の各要素は有限かつ正である。
- `baseSemanticTree` と各 State override は 13.2 の stable ID、親子、property conflict 規則に従う。
- SurfaceNode または Semantic Surface の orphan、重複参照、ID kind の取り違えを build error とする。

### 7.5 Render Surface lowering と Runtime 参照

一つの Semantic Surface は一つ以上の Render Surface へ lower する。Native UI、Baked Web、Video はいずれも Render Surface の renderer artifact として扱い、Semantic Surface と並列の意味 identity を作らない。

```ts
// Target M3 portable shape. Current generated schema remains the M1 subset.
type RenderSurface = {
  id: RenderSurfaceId;
  semanticSurfaceId: SemanticSurfaceId;
  logicalBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  layer: UInt32;
  partitionStrategyVersion: 1;
  artifacts: Record<RendererArtifactId, SurfaceRendererArtifact>;
  stateBindings: Record<SurfaceStateId, RenderSurfaceStateBinding>;
};

type RenderSurfaceStateBinding =
  { kind: "empty" } | { kind: "artifacts"; artifactIds: RendererArtifactId[] };
```

`logicalBounds` は親 Semantic Surface の logical coordinate spaceで表す。RenderSurfaceIdはauthor-stable IDではなく、partition strategy、SemanticSurfaceId、renderer contract、paint順のowned Node、bounds、layerのcanonical descriptorから導出するbuild-local IDである。完全なalgorithmとprovenanceは [ADR-0011](../decisions/0011-surface-partition-contract.md) を正本とする。

lowering は次を満たさなければならない。

- 一つの Render Surface は一つの Semantic Surface だけに所属し、Semantic Surface boundary を越えて内容を統合しない。
- 複数 Surface の texture atlas や GPU batching は Asset / Runtime 最適化であり、Render Surface identity を統合しない。
- Render Surface の集合、bounds、layer はすべての Surface State に対して同じ build 内で固定する。状態ごとに内容が存在しない partition は明示的な empty binding を持てる。
- renderable content NodeはCompiler internal planの`ownedContentNodeIds`で一partitionだけが所有し、structural context Nodeは`contextNodeIds`としてrenderer planへ複製できるがownershipへ重複計上しない。どちらもportable RenderBundle / DeliveryManifestへ出さない。
- partitionはcanonical paint interval順にlayer `0..N-1`を重複なく持ち、小さい値からback-to-frontに合成する。bounds overlapとtransparent gapは許可する。
- すべての到達可能な Surface State について、各 Render Surface が選択可能な artifact、native plan、または明示的な empty binding を持つ。
- `artifacts` binding の `artifactIds` は空でなく、同じ Render Surface の `artifacts` に存在しなければならない。
- DeliveryManifest は target capability に応じ、各 Render Surface の到達可能な Surface State ごとに互換な artifact を一つ、または RenderBundle が宣言した `empty` を選択する。非 empty state の選択は同じ renderer kind / contract version で解釈できなければならない。
- compatible artifactが存在しない場合は暗黙fallbackせず、`delivery-artifact-unavailable`でDeliveryManifest全体をatomicに拒否する。

Runtime contract が参照できる ID を次に固定する。

| Contract                                              | 参照可能な target                     |
| ----------------------------------------------------- | ------------------------------------- |
| `node.patch`、Timeline track                          | SurfaceNode を含む `SpatialNodeId`    |
| `surface.setState`、Surface Interaction、media Action | `SemanticSurfaceId`                   |
| Guard、Progression、Snapshot、Reliable Event          | `SemanticSurfaceId` / `SpatialNodeId` |
| RenderBundle、Delivery renderer graph                 | `RenderSurfaceId`                     |
| Authoring 内部編集                                    | `SurfaceContentNodeId`                |

RenderSurfaceId は Trigger、Guard、Action、Timeline、Snapshot、Reliable Event に含めない。SurfaceContentNodeId も公開 Interaction や Semantic Node へ明示的に lower された場合を除き、Runtime progression から直接参照しない。

一つの Semantic Surface が複数 Render Surface へ分割されても、`surface.setState` は一回の canonical state change とする。すべての partition は同じ transition run と `runId` に従って原子的に切り替え、Render Surface ごとの独立した canonical state を作らない。Surface 全体の Transform と opacity は SurfaceNode に一度だけ適用する。

`media.play`、`media.pause`、`media.seek` と `mediaCompleted` も SemanticSurfaceId を参照し、同じ Semantic Surface の media partition を一つの canonical media run として扱う。独立した再生位置や完了判定が必要な media は別 Semantic Surface に分ける。Render Surface や renderer acknowledgement を media authority にしない。

v1はrequired renderer / compositing boundaryとManifestが許可した公開Partの`isolate`だけでcanonical paint atom列を最大runへ分割する。同じ要件のatomをtexture sizeやNode数のheuristicだけで分けず、authorはRenderSurfaceId、bounds、layer、rendererを指定しない。Compilerが全partitionのprivate regionをSemantic Surface normalized Hit Regionへaggregateし、Coreがreject-onlyで検証する。詳細は [ADR-0011](../decisions/0011-surface-partition-contract.md) を正本とする。

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
    { kind: "none" } | { kind: "regions"; events: LogicalEventName[] } | { kind: "native-input" };

  internalAnimation:
    { kind: "none" } | { kind: "precomputed"; durationSeconds: number } | { kind: "runtime" };

  rendererPreference: "auto" | "baked-web" | "native-ui" | "video";
  fallbackPolicy: "reject" | "degrade";
};
```

click `InteractionDefinition`とAuthoring `InteractionDeclaration`はrequired `hitPriority: UInt32`を持つ。これはoverlap時のhit-test winnerを決めるsemantic authorityであり、Compilerがrenderer plan / Hit Regionへcopyする。rendererやDeliveryはpriorityを生成・変更せず、未指定値へ暗黙defaultを置かない。M3のschema移行で現行declarationへbreakingに追加する。

Renderer の基本選択規則は次のとおりとする。

| Surface の特性                       | 基本 renderer                 |
| ------------------------------------ | ----------------------------- |
| 静的な Typography、Card、Table       | `baked-web`                   |
| 少数の有限状態                       | `baked-web` + state artifacts |
| 入力非依存の連続演出                 | `video`                       |
| Timer、Counter、入力値などの継続変化 | `native-ui`                   |
| Surface 全体の移動、回転、拡縮、Fade | Unity SurfaceNode             |

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

- Cloud または Venue Edge に配置された割り当て済み Runtime Core を Session Runtime の single authority とし、Trigger、Guard、Cue 選択、Action、Timeline 完了、Group / Step 遷移を canonical evaluation する。
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
  firePolicy: { kind: "oncePerStepEntry" } | { kind: "repeatable"; cooldownMilliseconds: number };
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
      causeEventId: string;
      stepEntryEpoch: number;
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

type RuntimeClockSnapshot = {
  runtimeTimeMilliseconds: number;
  lifecycle:
    | { kind: "running" }
    | { kind: "paused"; reason: PauseReason }
    | { kind: "terminating"; reason: TerminationReason };
};

type StepTimerState =
  | {
      kind: "armed";
      dueAtRuntimeTimeMilliseconds: number;
    }
  | { kind: "fired" };

type StepExecutionSnapshot = {
  stepEntryEpoch: number;
  consumedCueIds: CueId[];
  cooldownUntilRuntimeTimeMilliseconds: Record<CueId, number>;
  timerStates: Record<CueId, StepTimerState>;
};

type RuntimeRunCause = {
  cueId: CueId;
  causeEventId: string;
  groupId: GroupId;
  groupEntryEpoch: number;
  stepId: StepId;
  stepEntryEpoch: number;
};

type RuntimeRunBase = {
  runId: RuntimeRunId;
  owner: RuntimeRunOwner;
  cause: RuntimeRunCause;
  startedAtRuntimeTimeMilliseconds: number;
};

type RuntimeRunSnapshot =
  | (RuntimeRunBase & {
      kind: "surfaceTransition";
      completion: "blocking";
      surfaceId: SemanticSurfaceId;
      fromStateId: SurfaceStateId;
      toStateId: SurfaceStateId;
      durationMilliseconds: number;
      easing: Easing;
    })
  | (RuntimeRunBase & {
      kind: "timeline";
      completion: "blocking" | "nonBlocking";
      timelineId: TimelineId;
    })
  | (RuntimeRunBase & {
      kind: "media";
      completion: "nonBlocking";
      surfaceId: SemanticSurfaceId;
      playback:
        | {
            kind: "playing";
            positionAtReferenceMilliseconds: number;
            referenceRuntimeTimeMilliseconds: number;
          }
        | {
            kind: "paused";
            positionMilliseconds: number;
          };
    });
```

`RuntimeStatusChanged` は lifecycle を `running`、pause reason を持つ `paused`、termination reason を持つ `terminating` として discriminated に送る。invariant violation、atomic commit failure、microstep overflow、recovery gap は Runtime fault であり、terminating ではなく `paused` の reason として区別する。Timeline / Runtime Run の semantic policy は [ADR-0007](../decisions/0007-timeline-runtime-run-wire-contract.md)、transport / replay / recovery policy は [ADR-0008](../decisions/0008-runtime-transport-contract.md) を正本とする。

`runtimeTimeMilliseconds` は Session の pause-aware logical clock とし、`running` 中だけ割り当て済み Runtime Core の monotonic clock 差分で進め、`paused` と `terminating` では停止する。process 固有の monotonic timestamp、wall clock、`pausedAt`、累積 pause duration は Snapshot に保存しない。Runtime Resume では保存済み logical time を新しい monotonic clock の基準へ bind する。process recovery では保存時の lifecycle が `running` でも logical time を進めず、`paused / processRecovered` として復元する。

Timer、Cue 消費状態、cooldown は `stepEntryEpoch` に属する。`oncePerStepEntry` で受理した Cue だけを `consumedCueIds` に記録し、cooldown は次に受理可能な logical runtime time を保持する。Timer は Step entry 時に一度だけ arm し、deadline 到達時に一度だけ event 化する。Guard 不成立または別 Cue の選択により受理されなかった場合も `fired` とし、同じ Step entry で暗黙に再試行しない。Step exit と self transition では旧 StepExecutionSnapshot を破棄する。

Surface transition、Timeline、Media は共通の **Runtime Run** として追跡する。Snapshot は active Run だけを含み、completed / canceled Run は除去して最終 resource state と Reliable Event へ反映済みにする。Surface transition と Media Run は Semantic Surface、Timeline Run は Timeline Definition から owner を継承する。group-owned Run は開始時の `groupEntryEpoch` を固定し、同じ Group の再入場後に以前の completion を適用しない。

Surface transition の duration と easing は Run が正本とする。Timeline の duration と absolute track は Session が固定した PublishedPresentation の TimelineDefinition から解決し、開始時の client 描画値を保存しない。Media は logical runtime time 上の reference position、または明示的に pause した position を保持する。Global Pause は clock の停止で表現し、Run ごとの pause 補正値を持たない。

`RuntimeRunId` は assignment epoch と単調増加する run sequence から一意に生成する session / assignment scoped value である。wire は `uint64 assignment_epoch` と `uint64 run_sequence` を持つ protobuf message とし、Snapshot は allocator の最終 sequence を保持する。Run completion は `runId` と owner epoch が現在の active Run に一致する場合だけ適用し、Renderer acknowledgement と corrective keyframe を completion source にしない。Timeline Run の lifecycle、停止理由、projection、compatibility は [ADR-0007](../decisions/0007-timeline-runtime-run-wire-contract.md) を正本とする。

blocking Run は Progression Phase の `blockingRunIds` と一対一に対応する。completion ごとに active Run と blocking set から除去し、最後の blocking Run が完了した時だけ `pendingNext` を atomic に適用する。存在しない Run、完了済み Run、古い Group / Step epoch に対する completion は stale として状態を変更しない。

`transitioning` 中は、新しい Cue を一切評価しない。通常の Trigger input は無視し、Timer は deadline 到達時に `fired` として消費するが対応 Cue を評価せず、同じ Step entry で遅延発火または再試行しない。Timeline / Media / Surface transition の内部 completion は既存の active Run、resource state、`blockingRunIds` を更新するためだけに処理し、その completion に一致する Trigger から別の Cue を開始しない。最後の blocking Run が完了した場合だけ、保持済みの `pendingNext` を適用して `stable` に戻る。v1 では input queue、completion の再配送、任意 interrupt / merge を持たない。

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
  transitionRunId?: RuntimeRunId;
};

type Easing = "linear" | "cubicIn" | "cubicOut" | "cubicInOut";
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

`surface.setState` を受理した時点で Semantic Surface の canonical `stateId` は遷移先へ変更する。Crossfade 中の旧状態、開始 logical runtime time、duration、easing は `surfaceTransition` Run だけが所有し、SurfaceRuntimeState はその `runId` を参照する。Guard と canonical Semantic Tree が参照する Surface State は遷移先の `stateId` とする。

同じ Semantic Surface に属するすべての Render Surface はこの一つの transition と `runId` を投影し、個別に state や完了時刻を決定しない。一つでも必要な state binding を欠く RenderBundle は Delivery 前に拒否する。

v1 の Surface transition は `cut` または blocking な `crossfade` に限定し、`transition` の省略は `cut` と同義とする。`cut` は Runtime Run を生成せず、Surface State の変更だけを atomic に確定する。active transition がなく、現在と同じ State への `cut` は有効な no-op とし、Surface State の Reliable Event は生成しない。現在と同じ State への `crossfade` は Runtime preflight で batch reject とし、`crossfade.durationMilliseconds` は有限かつ正でなければならない。

同じ Semantic Surface に transition が active な間の新しい `surface.setState` は、遷移先が同じ場合も reject する。replace、interrupt、queue は v1 に含めない。Crossfade は開始時の logical runtime time を `startedAt` とし、`startedAt + durationMilliseconds` を完了 deadline とする。§12.8 と同じ easing 関数を `e` として、経過率 `u` に対する旧 State の weight を `1 - e(u)`、遷移先 State の weight を `e(u)` とする。Crossfade 中は Surface interaction を無効にし、完了後に遷移先 State の hit region を有効にする。

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

type TriggerActorSelector = { kind: "presenter" } | { kind: "system"; source?: SystemEventSource };

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

participant 起点の canonical event は、認証済み Realtime connection の JWT claims から割り当て済み Runtime Core が `participantId` と role を設定する。client payload に actor、role、subject を含めず、client がこれらを申告しても採用しない。System actor は割り当て済み Runtime Core 内部の tracking evaluator、timer、timeline、media、runtime lifecycle だけが生成でき、client から System event を送信する wire path は設けない。

`TriggerActorSelector` の `presenter` は `RuntimeActor.kind === "participant"` かつ `role === "presenter"` にだけ一致する。`system` は System actor に一致し、`source` が指定されていれば同じ source だけに一致する。PresentationDefinition は具体的な `participantId` を使う actor selector を持たない。Viewer input は Shared Progression の Trigger に一致させず、Projection / Client-local State に対する入力規則を定義するまでは共有 Action を発生させない。

`surfaceInteraction` は現在の canonical Surface State において対象 Interaction が存在し、有効である場合だけ成立する。client が申告した Surface State は判定に使用しない。v1 の `logicalInput` と `surfaceInteraction` は Presenter actor、Timeline / Media / Timer completion は対応する System source だけを受理する。通常の `semanticEvent` は宣言した selector を照合する。Compiler は producer と actor selector の不正な組み合わせを build error とする。

Zone と Motion は割り当て済み Runtime Core が認証済み Presenter Tracking Stream から評価し、edge 成立時に `actor = system / tracking`、`subject = Presenter またはその Anchor` の内部イベントへ変換する。subject selector は現在の Session Presenter を concrete `participantId` へ解決する。Raw Pose、現在の zone membership、hysteresis、edge detector state は process-local な tracking state とし、Reliable Event、Canonical Runtime Snapshot、durable checkpoint に含めない。process recovery後は fresh Tracking Frame の現在値から detector を seed し、復旧そのものを enter / exit / motion edge として扱わない。

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

認証、role、event kind、subject の検証に失敗した入力は canonical event にせず、`ingressSequence` も割り当てない。`eventId` は冪等適用、割り当て済み Runtime Core が受理時に割り当てる `ingressSequence` は順序決定に使用する。client の `capturedAt` は診断専用であり、イベント順序には使用しない。

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

Runtime は Action を適用前に property claim へ正規化する。

| Action                          | claim                                                                  |
| ------------------------------- | ---------------------------------------------------------------------- |
| `surface.setState`              | 対象 Surface の state と transition                                    |
| `node.patch`                    | 指定した Node field。`transform` は position、rotation、scale のすべて |
| `variable.set`                  | 対象 Variable の value                                                 |
| `timeline.play`                 | Timeline lifecycle と全 track の `target/property`                     |
| `timeline.stop`                 | Timeline lifecycle と active Run が所有する全 `target/property`        |
| `media.play` / `pause` / `seek` | 対象 Surface の media lifecycle                                        |

同じ batch 内で claim が重なる場合は、操作内容が同じでも batch 全体を reject する。active Timeline Run が所有する property への `node.patch`、同じ property を所有する別 Timeline の開始、active な同一 Timeline の再開始も reject する。`timeline.stop` は対象 Run の claim を停止処理のために引き継げるが、同じ batch にある別 Action とその claim が重なる場合は reject する。停止と値変更を順に行う場合は、別の Cue または Step として表現する。

inactive Timeline への `timeline.stop` は有効な no-op とする。Compiler が対象 Timeline が必ず inactive だと静的に証明できる場合は warning を出せるが、Runtime error にはしない。

`ActionValue` の参照は Cue を発火させた event payload と同じ pre-event Variable snapshot に対して解決する。event payload の型不一致、存在しない payload field、event から得た非有限 number は Runtime の batch validation error とする。静的な `ActionValue` と Variable 参照の存在、型、有限性は build 時に検証する。定義済み Variable の Runtime value が欠落または型不一致なら invariant fault とする。`transform`、target ID、Surface State ID のように Runtime graph の構造を決める値は v1 では静的値に限定する。

Runtime は Cue を受理する前に、event payload や Variable から解決した値、現在の Surface State、active Run の property claim を検証する。回復可能な入力不正または current-state conflict があれば batch 全体を reject し、Cue の消費、cooldown、resource state、Runtime Run、Step 遷移を変更しない。選択済み Cue の batch が reject された場合に別の Cue へ fallback しない。

event 依存値の型不一致、同じ State への不正な transition、active Run との claim conflict は batch reject とし、Runtime を継続する。PublishedPresentation で保証される target、Surface State、Timeline、Variable、静的な値の型が live Runtime で欠落または不整合なら invariant fault とする。atomic commit の失敗も Runtime fault とし、partial state を公開せず Runtime を `Paused` にする。stale completion は状態を変更せず無視する。batch reject と Runtime fault の wire 表現は Progression wire contract で定義する。

Action 同士の順序に意味を持たせない。依存した順次演出は次の Step、Timeline keyframe、または `timelineCompleted` Trigger で表現する。

v1 の Action conflict は action 配列順で解決しない。同一 Surface への複数 `surface.setState`、同一 Variable への複数書き込み、同一 Node field への複数 patch、Node patch と Timeline の同一 property 所有、同一 Timeline の play / stop、同一 media target への競合操作は batch validation で reject する。異なる field への Node patch だけは一つの patch として統合できる。`replace`、additive animation、暗黙的な last-write-wins は将来拡張とする。

### 12.8 Timeline

Timeline は連続補間可能な property の時間変化だけを所有する。

```ts
type TimelineKeyframe = {
  timeMilliseconds: number;
  value: number | Vector3 | Quaternion;
  easingToNext?: Easing;
};

type TimelineDefinition = {
  id: TimelineId;
  owner: ResourceOwner;
  durationMilliseconds: number;
  tracks: Array<{
    target: {
      nodeId: NodeId;
      property: "opacity" | "transform.position" | "transform.rotation" | "transform.scale";
    };
    keyframes: TimelineKeyframe[];
  }>;
};
```

- Surface 全体の Transform と opacity は、その Semantic Surface に対応する SurfaceNode の track として表現する。
- `SurfaceStateId`、Texture ID、renderer、CSS property、任意の Component 内部値は Timeline track にしない。
- Baked Web Render Surface 内部の個別 Node を動かす必要がある場合は、Semantic Surface 分割、有限状態 artifact、Video、Native UI のいずれかへ lower する。
- Timeline の `durationMilliseconds` は有限かつ正とし、track を一つ以上持つ。各 track は二つ以上の keyframe を持ち、すべての時刻と値は有限でなければならない。
- Timeline は absolute 値を指定する。各 track の最初の keyframe は `0 ms`、最後の keyframe は Timeline duration とし、keyframe 時刻は単調増加して同時刻を許可しない。
- `opacity` は number、`transform.position` と `transform.scale` は Vector3、`transform.rotation` は非ゼロ Quaternion だけを値に取る。Quaternion は Compiler が Delivery 前に正規化し、Runtime も補間境界で正規化する。
- 最終 keyframe 以外は `easingToNext` を必須とし、最終 keyframe では禁止する。easing はその keyframe から次の keyframe までの segment に適用する。
- 同じ `target/property` を同時に所有できる Timeline Run は一つだけとする。v1 の conflict policy は `reject` のみであり、replace と additive animation は含めない。
- group-owned Timeline は同じ Group または presentation-owned Spatial Node、presentation-owned Timeline は presentation-owned Spatial Node だけを target にできる。
- group-owned Timeline は Group exit 時に停止する。presentation-owned Timeline は明示的な `timeline.stop` または Presentation 終了まで Group をまたいで継続できる。Step 遷移だけではどちらも停止しない。
- Timeline の開始・完了は Session の pause-aware logical runtime clock で決定する。Renderer acknowledgement を完了条件にしない。
- Runtime は Delivery 済み immutable Timeline catalog と開始時刻を用い、各 client はローカル補間する。Timeline の補間結果を毎 frame Reliable Event または State Stream として送信しない。State Stream は tracking 等の非 Timeline latest-wins state に限定し、Timeline-owned property を含めない。

Pause 中は Session の logical runtime clock 自体を進めないため、Timeline、Surface transition、playing Media の基準時刻を個別に補正しない。Runtime Resume 後は同じ logical runtime time から進行を再開する。

Run の開始 logical runtime time を `startedAt`、現在の logical runtime time を `runtimeTime` とし、Timeline local time を `t = clamp(runtimeTime - startedAt, 0, durationMilliseconds)` とする。`t` が keyframe `i` と `i + 1` の間にある場合、`u = clamp((t - t_i) / (t_{i+1} - t_i), 0, 1)`、`e = easingToNext(u)` とする。easing 関数は次に固定する。

```text
linear(u)     = u
cubicIn(u)    = u^3
cubicOut(u)   = 1 - (1 - u)^3
cubicInOut(u) = u < 0.5 ? 4u^3 : 1 - (-2u + 2)^3 / 2
```

number と Vector3 は `e` を補間係数として component-wise に線形補間する。Quaternion は両端を正規化し、dot product が負なら終点 Quaternion の符号を反転して shortest path を選ぶ。dot product が `0.9995` より大きい場合は `e` を係数とする normalized lerp、それ以外は `e` を係数とする SLERP を使い、出力を再度正規化する。`t <= 0` は最初、`t >= durationMilliseconds` は最後の keyframe 値を計算誤差なしの端点として採用する。

active Timeline Run の補間値は、Run が所有する Node property の effective value とする。Timeline 完了時は全 track の最終値を Node Runtime State へ atomic に commit してから Run を除去し、`TimelineCompleted` を確定する。

明示的な `timeline.stop` と Group exit による cancel は、その時点の local time `t` で全 track を評価し、現在値を Node Runtime State へ atomic に commit してから Run を除去する。値を開始前へ戻したり最終 keyframe へ進めたりしない。group-owned Node の state は commit 後に Group lifecycle に従って破棄し、presentation-owned Node は停止時の値を維持する。

Presentation 終了時は active Timeline Run の値を commit せず、Run を除去して `TimelineCanceled / presentationEnded` を `runId` 順に確定した後に `PresentationEnded` を確定し、Presentation Runtime State 全体を破棄する。その他の `TimelineCanceled` reason は `explicitStop` と `groupExit` とする。

### 12.9 Cue の選択と遷移手順

一つの Runtime Input Event を次の順序で処理する。

1. Runtime が `Running` であり、session、role、PublicationFence、assignment、lease、Presentation Origin version が一致することを検証する。
2. `eventId` を bounded idempotency window で重複排除し、新規イベントへ `ingressSequence` を割り当てる。
3. 割り当て済み Runtime Core の monotonic clock 差分から Session logical runtime clock を進め、現在の logical runtime time 以前の内部 completion event を先に処理する。
4. 現在の Group / Step に属する Cue から、Trigger、Guard、fire policy、cooldown を満たす候補を作る。
5. `priority` 降順、`order` 昇順、`cueId` 辞書順で候補を並べ、先頭の一件だけを選択する。
6. 選択した Cue の Action batch と `next` を事前検証する。
7. Surface / Node / Variable の即時変更を atomic に適用し、Surface transition、Timeline、media action を開始する。
8. blocking run があれば Progression Phase を `transitioning` にし、現在の Step と `pendingNext` を保持する。
9. blocking run がすべて完了したら `next` を atomic に適用し、Progression Phase を `stable` に戻す。
10. zero-duration action から生じた内部 event を同じ event loop で処理する。build validation と runtime microstep 上限により無限遷移を防ぐ。

同じ `priority` と `order` を持つ Cue は build validation error とする。Runtime の `cueId` 比較は、不正な Delivery を受けた場合にも結果を決定的にするための fallback である。

`eventId` による transport 上の重複排除、`oncePerStepEntry` による意味論的な一回実行、`cooldownMilliseconds` による連続入力抑制は別の機能として管理する。Cooldown は leading-edge とし、window 終了後の暗黙的な trailing 発火は行わない。

同じlogical runtime timeに複数のTimer / Run completionが成立する場合は、versionedなevent kind順、stable target ID順、runId順で一意に並べてから一件ずつ処理する。Action batchから同時にRunを生成する場合もAction配列順を使わず、同じcanonical target順でrun sequenceを割り当てる。

### 12.10 Group lifecycle

Presentation 開始時は presentation-owned Node、Surface、Variable、Media、Zone の状態を Definition の初期値から一度だけ初期化し、presentation-owned Timeline を停止状態にした後で `initialGroupId` へ入場する。presentation-owned Runtime State と Run は Group 切替では reset または停止せず、明示的な Action、Presentation の再初期化、Presentation 終了によってだけ変更または破棄する。

Group exit では次を順に適用する。

1. 旧 Group の Step / Cue と、group-owned Interaction を無効化する。
2. 旧 Group 所有の non-blocking Timeline / Media Run を cancel する。v1 の Surface transition は常に blocking であり、group-owned blocking Run が残る状態では exit を開始しないため、この時点で active な group-owned Surface transition は存在しない。
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
SurfaceInteractionAccepted
SurfaceStateChanged
SurfaceTransitionStarted / SurfaceTransitionCompleted
NodeStateCommitted
TimelineStarted / TimelineCompleted / TimelineCanceled
MediaStarted / MediaPaused / MediaSeeked / MediaCompleted
VariableChanged
StepEntered
PresentationEnded
```

participant へ送る projected Reliable Event の論理 envelope は次を持つ。具体的な Protobuf field number、retention、batching、Snapshot / State keyframe、microstep 上限は [ADR-0008](../decisions/0008-runtime-transport-contract.md) を正本とし、この fence と identity を省略しない。

```ts
type ProjectedReliableEvent<TPayload> = {
  sequence: number;
  eventId: string;
  causeEventId?: string;
  occurredAtRuntimeTimeMilliseconds: number;
  sessionId: SessionId;
  publication: PublicationFence;
  assignmentEpoch: number;
  projectionProfileId: ProjectionProfileId;
  presentationOriginVersion: number;
  payload: TPayload;
};
```

`sequence` は projection 前の session-global な単調増加値、`eventId` は冪等適用、`causeEventId` は canonical event 間の因果関係に使用する。Texture variant、Hit Region geometry、Unity renderer 情報は payload に含めない。client は Session、PublicationFence、assignment epoch、projection profile、Presentation Origin のいずれかが現在の connection / DeliveryManifest と一致しない event を適用せず、Connection Resume を要求する。

Pose と Timeline 以外の連続的な Element State frame は latest-wins の State Stream とし、event log へ保存しない。Timeline の毎 frame補間値は Delivery 済み immutable catalog、active Run、logical runtime time から client が再計算する。離散的な Cue 採用、Run lifecycle、最終状態は Reliable Event と Snapshot の両方へ反映する。

#### Surface transition / interaction wire contract

Presenter client から Runtime Core へ送る Surface interaction は、renderer や hit-test 実装ではなく canonical Interaction を指定する。

```ts
type SurfaceInteractionCommand = {
  clientEventId: string;
  surfaceId: SemanticSurfaceId;
  interactionId: InteractionId;
  presentationOriginVersion: number;
  capturedAt?: number;
};

type SurfaceInteractionOutcome = {
  clientEventId: string;
  result:
    | {
        kind: "accepted";
        canonicalEventId: string;
        reliableSequence: number;
      }
    | {
        kind: "rejected";
        reason: "interactionUnavailable" | "runtimeNotAcceptingInput";
      };
};
```

`SurfaceInteractionCommand` に Surface State、Semantic Node、Hit Region、Render Surface、normalized point、renderer artifact ID、任意 payload を含めない。client は Delivery された現在 State の Hit Region で hit-test して `surfaceId` と `interactionId` を送る。command の session、participant、role、PublicationFence、assignment epoch は認証済み Control Connection が fence し、`presentationOriginVersion` は command ごとに現在値と照合する。不一致では input を canonical event にせず、Control Connection を `FAILED_PRECONDITION / presentation_origin_mismatch` で終了して新しい DeliveryManifest と Connection Snapshot による Connection Resume を要求する。`capturedAt` は診断専用であり、順序、重複判定、availability、Cue 選択に使用しない。Runtime Core は connection から Presenter actor を構成し、現在の canonical Surface State、active transition、`enabledInteractionIds`、resource owner、ProjectionAudience を自身の state で検証する。event payload は PresentationDefinition の Interaction / Trigger contract から解決し、client が申告した表示状態、hit-test 結果、payload を authority にしない。

Runtime Core は最初に Session lifecycle と Progression Phase を検証する。Paused、terminating、`transitioning` など Session が新規 input を受理しない場合は、resource の存在を検査する前に `runtimeNotAcceptingInput` とする。次に現在の canonical state で Surface を検証し、未知、不可視、無効な Interaction と active transition 中の入力を、情報を区別して漏らさない `interactionUnavailable` として connection 単位で reject する。reject は `ingressSequence`、Reliable Event、Cue consumption、cooldown、Runtime State を変更しない。認証・role・PublicationFence・protocol 違反はこの outcome へ丸めず、connection contract の error として fail closed にする。

`clientEventId` は同じ Session と participant の範囲で connection をまたぐ idempotency key とする。Runtime Core は `surfaceId`、`interactionId`、`presentationOriginVersion` の canonical request fingerprint を outcome とともに保持し、`capturedAt` は fingerprint に含めない。同じ ID と fingerprint の再送は新しい canonical input や Reliable Event を生成せず、保持期間内では最初と同じ `SurfaceInteractionOutcome` を返す。同じ ID を異なる fingerprint で再利用した場合は outcome を再利用せず、Control Connection を `INVALID_ARGUMENT / idempotency_key_reused` で fail closed にする。

accepted outcome は、認証・fence・availabilityを満たした Surface interactionをcanonical inputとして一度だけ受理したことだけを意味する。Cue が選択されたことやAction batchがcommitされたことは意味せず、それぞれ後続の `CueAccepted` とstate / fault eventで確定する。accepted outcome の `canonicalEventId` と `reliableSequence` は、対応する `SurfaceInteractionAccepted` Reliable Event を指す。`CueAccepted.causeEventId` はこの canonical event、Surface Action から生じる event の `causeEventId` は対応する `CueAccepted` を指し、input から state change までの因果鎖を renderer 非依存で保持する。

Surface に関する Reliable Event payload は次に固定する。

```ts
type SurfaceReliableEventPayload =
  | {
      kind: "surfaceInteractionAccepted";
      surfaceId: SemanticSurfaceId;
      interactionId: InteractionId;
    }
  | {
      kind: "surfaceStateChanged";
      surfaceId: SemanticSurfaceId;
      fromStateId: SurfaceStateId;
      stateId: SurfaceStateId;
      change: "cut";
    }
  | {
      kind: "surfaceTransitionStarted";
      surfaceId: SemanticSurfaceId;
      runId: RuntimeRunId;
      fromStateId: SurfaceStateId;
      stateId: SurfaceStateId;
      startedAtRuntimeTimeMilliseconds: number;
      durationMilliseconds: number;
      easing: Easing;
    }
  | {
      kind: "surfaceTransitionCompleted";
      surfaceId: SemanticSurfaceId;
      runId: RuntimeRunId;
      stateId: SurfaceStateId;
    };
```

`cut` は Runtime Run を作らず、State と enabled Interaction の切り替えを一つの canonical mutation として確定して `SurfaceStateChanged` を一件生成する。同じ State への有効な no-op cut は mutation も event も生成しない。

`crossfade` の開始は、canonical `stateId` の変更、`surfaceTransition` Run の追加、`transitionRunId` の設定、全 Interaction の無効化を一つの mutation として確定し、`SurfaceTransitionStarted` だけを生成する。同じ変更について追加の `SurfaceStateChanged` を生成しない。client は event の `fromStateId`、`stateId`、開始時刻、duration、easing から表示を補間し、crossfade weight を Reliable Event や State Stream で毎 frame 受信しない。

Runtime Core は logical runtime time が deadline に到達した時に、`runId` と owner epoch が current active Run に一致する場合だけ、Run の除去、`transitionRunId` の解除、遷移先 State の Interaction / Hit Region 有効化を一つの mutation として確定し、その後に `SurfaceTransitionCompleted` を生成する。Renderer acknowledgement や client clock を completion source にしない。stale、重複、owner epoch 不一致の completion は event を生成せず無視する。最後の blocking Run の完了によって `pendingNext` を適用する場合、`SurfaceTransitionCompleted` を、その完了から派生する `GroupEntered` / `GroupExited` / `StepEntered` より前の sequence に置く。

v1 は `SurfaceTransitionCanceled` を持たない。Surface transition は常に blocking であるため Group exit は完了前に開始せず、Presentation 終了時は `PresentationEnded` の適用で active Surface Run を含む Presentation Runtime State 全体を破棄する。将来 non-blocking / interruptible Surface transition を追加する場合は、cancel reason と終了時のInteraction状態を持つ明示的なlifecycle eventを同時に追加する。

Interaction / Hit Region の enabled 状態専用の event、State Stream field、Snapshot field は作らない。Snapshot で `transitionRunId` が存在する Surface は全 Interaction を無効とし、対応する active `surfaceTransition` Run がなければ invalid Snapshot とする。`transitionRunId` がなければ、現在の `stateId` の `enabledInteractionIds` と Delivery 済み Hit Region の積集合だけを有効にする。これにより live event、late join、replay、durable recovery が同じ規則へ収束する。

Surface event は、ProjectionProfileDescriptor で対象 Surface が可視な participant にだけ投影する。不可視な event は payload、resource ID、event kind を含まない集約 `ProjectionAdvance` の規則に従い、Surface、Interaction、State、Run の ID を漏らさない。State Stream frame が Surface transition の開始または完了後の値を前提にする場合、その `baseReliableSequence` は対応する projected Surface event 以上でなければならない。

```ts
type CanonicalRuntimeSnapshot = {
  reliableSequence: number;
  lastIngressSequence: number;
  lastAllocatedRunSequence: number;
  clock: RuntimeClockSnapshot;

  progression: ProgressionRuntimeState;
  stepExecution: StepExecutionSnapshot;
  surfaceStates: Record<SurfaceId, SurfaceRuntimeState>;
  nodeStates: Record<NodeId, NodeRuntimeState>;
  mediaStates: Record<SurfaceId, MediaRuntimeState>;
  variables: Record<VariableId, Scalar>;
  activeRuns: RuntimeRunSnapshot[];
  presentationOrigin: PresentationOrigin;
  recentEventIds: string[];
};

type ConnectionSnapshotEnvelope = {
  connectionSnapshotSchemaVersion: number;
  sessionId: SessionId;
  connectionId: ConnectionId;
  publication: PublicationFence;
  projectionInstance: ProjectionInstance;
  presenceAtCut: ProjectedPresenceState;
  snapshot: ProjectedRuntimeSnapshot;
};

type DurableCheckpointEnvelope = {
  checkpointSchemaVersion: number;
  checkpointSequence: number;
  sessionId: SessionId;
  runtimeId: RuntimeId;
  runtimeKind: RuntimeKind;
  assignmentEpoch: number;
  publication: PublicationFence;
  definitionHash: string;
  renderBundleHash: string;
  reliableSequence: number;
  canonicalSnapshotHash: string;
  payload: SerializedCanonicalRuntimeSnapshot;
};
```

`CanonicalRuntimeSnapshot` は renderer、participant、connection、transport、serialization format から独立した Shared Runtime State の immutable value とする。`surfaceStates`、`nodeStates`、`mediaStates`、`variables`、`activeRuns` は presentation-owned resource と Snapshot の `currentGroupId` に属する resource だけを含む。group-owned Runtime Run は `groupId` と `groupEntryEpoch` が Snapshot の progression と一致しなければならない。inactive Group の状態を暗黙的な checkpoint として保持しない。

Connection Resume では session coordinator の critical section 内で次だけを行う。

1. logical runtime time `T` 以前の内部 completion を処理する。
2. Reliable sequence `S` 時点の canonical state と Connection presence を immutable value として freeze / copy する。
3. 対象 connection を `S + 1` 以降の Reliable Event subscriber として登録する。
4. critical section を解放する。

Participant projection、Projected Runtime Snapshot の構築、serialization、compression、hashing、network write は critical section 外で行う。lock 外でlive mutable mapを読むことは禁止し、lock内でfreezeしたimmutable valueまたはstructural sharingされたsnapshotだけを入力にする。projection中にbounded replay queueがoverflowした場合は生成中のConnectionSnapshotEnvelopeと購読を破棄し、新しいcutからやり直す。ただし再試行は protocol version ごとの試行回数上限と総時間 budget の両方で制限する。どちらかを超えた場合は購読とqueueを確実に解放し、部分的なSnapshotを返さず `RESOURCE_EXHAUSTED / snapshot_catch_up_exhausted` として Connection Resume を終了する。client は jitter 付き backoff 後に新しい Connection Resume として再試行する。

Durable checkpointもlock内ではCanonicalRuntimeSnapshotのimmutable cutと`checkpointSequence`の割り当てだけを行い、serialization、hashing、persistence callbackはlock外で行う。DurableCheckpointEnvelopeはassignment、PublicationFence、artifact hash、schemaをfenceする外側のcontractであり、canonical stateへparticipant / connection固有値を混入させない。

Connection presenceは`presenceAtCut`としてConnectionSnapshotEnvelopeにだけ含め、durable checkpointへ保存しない。process recovery後のconnection registryは空から再構築する。Raw Tracking Frame、Presenter Anchor sample、tracking sample window、zone membership、hysteresisを含むTrigger edge memoryもdurable restore対象にしない。復旧後はAnchorをunavailableとしてFresh Tracking Frameを待ち、現在値からedge detectorをseedして疑似enter / exit / motionを発火させない。

再接続clientはConnectionSnapshotEnvelopeのProjectedRuntimeSnapshotを適用した後、同じ`projectionProfileId`と`assignmentEpoch`を持つ`S + 1`以降のprojected Reliable Eventを順序適用する。不一致の場合はDeliveryManifestと新しいConnection Snapshotを取得する。Control側がcatch upした後、State Streamのkeyframeでsnapshot対象外のlatest-wins stateへ収束する。

Snapshot cut前にlogical runtime time `T`以下のarmed TimerとRun completionをすべて処理し、CanonicalRuntimeSnapshotに期限切れのscheduleを残さない。同一deadlineの内部eventはevent kindとstable target IDによるversioned canonical順序で処理し、goroutine、OS scheduler、map iteration順へ依存させない。restore時はactiveRunsとarmed Timerから内部scheduleを再構築する。

process recoveryではschema、session、runtime、assignment epoch、PublicationFence、Definition / RenderBundle hash、すべてのresource / Run参照を検証する。保存時に`running`でもlogical clockを保存時点で停止し、`paused / processRecovered`として復元してPresenterの明示的なRuntime Resumeを待つ。別assignment epochへのrestoreはlive migrationになるためv1では行わない。

Durable recoveryにはSnapshotの`reliableSequence = S`以降を埋めるcontiguousなReliable Event log、または後続eventをすべて含む新しいcheckpointが必要である。復元不能なgapがある場合、古いSnapshotへ黙ってrollbackして実行を再開せず、Pausedのままsession failureとして扱う。現行Control Planeのopaque checkpoint callbackとRealtimeのpause primitiveは部分実装であり、このtarget recovery contractが接続済みであるとはみなさない。

Timelineのtick履歴はreplayせず、logical runtime timeとactive Runから現在値を再計算する。Projected Runtime SnapshotはCanonicalRuntimeSnapshotから生成する派生物であり、durable recoveryの入力に使用しない。

### 12.12 v1 validation requirements

Compiler、Control Plane、Delivery projection は少なくとも次を静的に検証する。

- `initialGroupId`、`initialStepId`、Cue の `next` が存在する。
- Cue、Surface、Surface State、Timeline、Node、Variable の参照先が存在する。
- すべての group owner が存在し、resource kind ごとの ID が PresentationDefinition 全体で一意である。
- presentation-owned resource が group-owned resource を参照せず、Group G-owned resource / Cue が別 Group の resource を参照しない。
- Spatial parent、Timeline target、Component Instance から生成した resource、SurfaceNode から継承する resource の owner が lifetime 規則と一致する。
- すべての Spatial Node が明示的な `SpatialParent` を持ち、`node` parent の参照先が存在してその graph が循環せず、`stage` / `anchor` parent の情報が失われない。
- resource 間の参照が ProjectionAudience の包含規則を満たし、role 限定 resource を別 role または `all` resource の closureへ混入させない。
- PresentationDefinition と PublishedPresentation に concrete `ParticipantId` が含まれず、Shared Spatial Tree の Anchor owner が Presenter selector だけである。
- Trigger の actor / subject selector と producer の組み合わせが 12.5 の規則に一致し、Viewer input から Shared Action へ到達する経路がない。
- participant actor が認証済み connection identity から、System actor が許可された内部 event source からだけ生成される。
- 同じ PublicationFence、projection contract version、role、capability profileから同じ canonical profileを生成し、異なるprojection contract versionが同じcache namespaceを共有せず、profileにparticipant / assignment固有値やSigned URLが含まれない。
- ProjectionProfileDescriptor の visible resource set が参照 closure を満たし、capability 差が認可や Shared semantic state を変更しない。
- ProjectionProfileDescriptor の `visibleVariableIds` が visible Native UI binding の Variable closure と一致し、profile 外の Variable を Projected Snapshot / Event / State Frame に含めない。
- Projected Snapshot / Event / State Frame の `projectionProfileId` と `assignmentEpoch` が受信 participant の ProjectionInstance と一致する。
- 同じ Step に `priority` と `order` が重複する Cue がない。
- Timeline の duration が有限かつ正で、track が一つ以上あり、各 track が二つ以上の keyframe と `0 ms` / duration の境界を持つ。時刻は有限かつ単調増加し、値は property に対応する有限な型で、Quaternion は非ゼロかつ Delivery 前に正規化される。
- 最終以外の Timeline keyframe が `easingToNext` を持ち、最終 keyframe が持たない。
- 同一 Timeline 内で `target/property` が競合しない。
- 同一 Cue の Action batch で property claim が相互に重複しない。
- `crossfade` の duration が有限かつ正である。
- Surface State と renderer artifact、hit region の対応が完全で、Delivery profileが各Render Surfaceの到達可能なstateごとに一つの互換artifactまたは宣言済み`empty`を固定する。
- Semantic Tree の root、parent、到達可能性、order、interaction 参照が 13.2 に従い、State materialization 後の Tree / Hit Region が整合する。
- Native UI plan の tree closure、cycle / parent / child order、bounds、Node / depth / text / glyph / code point limit、contract version、required feature が target capability に適合する。`clip`、`ellipsis`、明示fallback fontを使用する plan がそれぞれ `clip`、`ellipsis`、`explicitFontFallback` を required feature として列挙する。
- Native UI Variable binding の source / 型 / format が一致し、timer binding が実在する timer Trigger の Cue、duration、Cue 所属 Group から導出する owner、host SurfaceNode の owner と一致する。timer表示は Surface audience projection に従い、Cue に audience を要求しない。single-line禁止 / 置換対象、single-line置換後のstring許容range、静的literal / boolean labelのlength、動的valueのtruncate規則が一致する。
- 全 reachable State の Native UI font face、fallback順、supported code point range が Asset closure に含まれる。literal、boolean label、binding range、number、timer、U+2026、U+FFFD の glyph が primary / fallback closure に存在し、implicit system fallback と synthetic face を要求しない。
- Native UI text が同じ State の完成 Semantic Tree 内の non-interactive Semantic Node を一つだけ、かつartifact内とProjectionProfileが同時選択するartifact横断でinjectiveに参照し、literal / dynamic の text 規則、crossfade時のeffective semantic valueが一致する。
- Hit Region は State の enabled Interaction だけを参照し、Baked hit region として公開する enabled Interaction が少なくとも一つの region を持つ。
- `surfaceInteraction` が参照する Interaction が対象 Surface State で利用できる。
- Surface transition 中に interaction を有効化する projection を生成しない。

Runtime は Action batch の適用前に、現在の Session state に依存する次の条件を検証する。

- 同じ State への `crossfade`、active Surface transition 中の `surface.setState`、active Timeline Run の claim と競合する Action を batch reject する。

Recovery は次の Runtime invariant を検証する。active Timeline Run の property claim が相互に重複するなど、違反した checkpoint は fail closed とし、Runtime を `Paused` にする。

- active Timeline Run の property claim が相互に重複しない。
- Group exit をまたいで blocking run が残らない。
- group-owned Runtime Run の `groupId` と `groupEntryEpoch` が現在の Group entry と一致する。
- Snapshot の clock、StepExecutionSnapshot、active Runtime Run、allocator sequence から同じ logical deadline と Run identity を復元できる。
- `ProgressionPhase.blockingRunIds`、Surface の `transitionRunId`、Media state が同じ active Runを参照し、completed / canceled RunがSnapshotに残らない。
- armed Timerとactive RunのdeadlineがSnapshot cutのlogical runtime timeより後であり、同一deadlineの処理順がcanonicalである。
- Snapshot が presentation-owned resource と current Group-owned resource だけを含む。
- CanonicalRuntimeSnapshot にparticipant、connection、Projection、renderer、Presence、tracking sample、Trigger edge memoryが含まれない。
- ConnectionSnapshotEnvelopeとDurableCheckpointEnvelopeが同じcanonical cutを用途別に包み、Durable側にconnection presenceが含まれない。
- Snapshot projection、serialization、compression、hashingがsession critical section外でimmutable cutだけを入力に実行される。
- zero-duration の内部イベントだけで到達できる無限遷移がない。
- Snapshot に renderer artifact ID、Signed URL、raw Pose history が含まれない。

Conformance test は、今回の progression 規則について次を検証する。

- Surface: 遷移中の追加入力、同じ State への cut / crossfade、crossfade easing、interaction と hit region の有効化時点、cut が一件の `SurfaceStateChanged` だけを生成すること、crossfade が重複する State event を生成しないこと、completion が派生する Group / Step event より先に並ぶこと、reject が sequence と state を変更しないこと、同じ fingerprint の `clientEventId` 再送が同じ outcome へ収束すること、異なる fingerprint の ID 再利用と Presentation Origin 不一致が fail closed になること、Snapshotから同じInteraction有効状態を導出できること。
- Action: property claim conflict、batch reject の atomicity、expected reject と Runtime fault の状態遷移。
- Timeline: exact endpoint、全 easing と number / Vector3 / Quaternion の組み合わせ、Quaternion の反対符号と near-linear 補間、Pause / Resume、明示 stop / Group exit での現在値 commit、Presentation 終了時の cancel 順序。
- Semantic Tree / Native UI: 空 Tree、root canonical order、State materialization、override の field presence / `null` 削除、enabled / disabled Interaction と Hit Region 整合、tree limit と capability reject、Variable closure、静的literal / boolean labelのreject、single-line置換後のstring許容range、動的valueのtruncate、boolean / number / timer format、Pause / 再接続時のclock表示、全 State のfont face / glyph closure、Native UI / effective Semantic Tree textのartifact内・profile横断injective一致、Unity と Web preview のformatter fixture一致。

加えて、event の重複、Cue 競合、cooldown、Timer fire済み状態、`transitioning` 中にdeadlineへ達したTimerとRun completionが新しいCueを開始しないこと、同一deadlineの順序、active Run の復元と stale completion、scope を越える不正参照、Stage / Node / Presenter Anchor parentの保持と循環拒否、ProjectionAudienceを越える参照拒否、Presenter / Viewer の role spoof、client 起点の System event、actor と subject の不正な組み合わせ、Presenter Anchor unavailable、projection contract versionごとのcache分離、profile の共有と participant 固有値の隔離、Surface Stateごとのartifact選択、unauthorized resource の配信前除外、projection profile / assignment mismatch、Client-local State が Shared State に混入しないこと、connection presence / tracking stateを除外したdurable restore、projection中のreplay queue overflowが再試行上限内では新しいcutへ収束し、上限超過時は購読を解放して型付きerrorで終了すること、process recovery後のPaused化、recovery log gapのfail closed、presentation-owned state の Group 間継続、group-owned state の exit 時破棄と reentry reset、Snapshot + Replay 後の状態一致を検証する。

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
        easing: "cubicOut",
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
type SemanticNodeBase = {
  id: SemanticNodeId;
  parentId: SemanticNodeId | null;
  order: number;
};

type SemanticNodeDefinition =
  | (SemanticNodeBase & {
      role: "heading";
      level: 1 | 2 | 3 | 4 | 5 | 6;
      text: string;
      language?: string;
    })
  | (SemanticNodeBase & { role: "paragraph"; text: string; language?: string })
  | (SemanticNodeBase & { role: "image"; alt: string; language?: string })
  | (SemanticNodeBase & {
      role: "button";
      text: string;
      language?: string;
      interactionId: InteractionId;
    })
  | (SemanticNodeBase & { role: "list"; ordered: boolean })
  | (SemanticNodeBase & { role: "listItem"; text: string; language?: string })
  | (SemanticNodeBase & { role: "table"; label?: string; language?: string })
  | (SemanticNodeBase & { role: "row" })
  | (SemanticNodeBase & {
      role: "cell" | "columnHeader" | "rowHeader";
      text: string;
      language?: string;
    });

type SemanticTreeDefinition = {
  rootNodeIds: SemanticNodeId[];
  nodes: Record<SemanticNodeId, SemanticNodeDefinition>;
};

type CompletedSemanticNode =
  | Exclude<SemanticNodeDefinition, { role: "button" }>
  | (Extract<SemanticNodeDefinition, { role: "button" }> & { stateEnabled: boolean });

type CompletedSemanticTree = {
  rootNodeIds: SemanticNodeId[];
  nodes: Record<SemanticNodeId, CompletedSemanticNode>;
};

type ProjectedSemanticNode =
  | Exclude<CompletedSemanticNode, { role: "button" }>
  | (Omit<Extract<CompletedSemanticNode, { role: "button" }>, "stateEnabled" | "interactionId"> &
      ({ enabled: true; interactionId: InteractionId } | { enabled: false }));

type ProjectedSemanticTree = {
  rootNodeIds: SemanticNodeId[];
  nodes: Record<SemanticNodeId, ProjectedSemanticNode>;
};

type SurfaceSemanticOverride = {
  nodes: Record<
    SemanticNodeId,
    {
      included?: boolean;
      text?: string;
      language?: string | null;
      alt?: string;
      label?: string | null;
    }
  >;
};
```

Semantic Tree は検索、翻訳、読み上げ、caption、presenter notes、Agent editing、accessibility の基礎として使用する。roleごとのrequired field、Definition / Completed tree、list / table structure、accessible value、language継承は [ADR-0009](../decisions/0009-semantic-tree-hit-region-contract.md) を正本とする。

`SemanticTreeDefinition` と `CompletedSemanticTree` は空 Tree を許可する。空でない tree は tree 内で一意な stable Node ID、存在する parent、循環しない親子関係、roleごとのrequired parent / children、同じ parent 内で一意な `order` を持つ。`parentId === null` の Node は `rootNodeIds` に一度だけ含め、root以外のNodeは一つのparentを持ち、すべてのNodeはいずれかのrootから到達可能とする。materializerの戻り値自体がrootとsiblingを`Node.order`昇順に並べ、canonical serializationだけに並べ替えを委ねない。`interactionId`はbuttonだけが持ち、同じSemantic SurfaceのInteractionを参照する。text-bearing roleはnon-empty `text`を持ち、dynamic Native UI textがある場合はempty / unavailable時のaccessibility fallbackとして使う。bindingの正本は選択された`NativeUIArtifact`内でそのNodeを一意に参照するtext Nodeであり、独立したsemantic binding fieldは作らない。

`SurfaceStateDefinition.semanticOverrides` は ordered な override layers である。Compiler は `baseSemanticTree` に layers を順に適用して State ごとの完成 Tree を materializeし、buttonの`stateEnabled`をStateのenabled Interaction集合から導出して、`RenderBundle.semanticsByState`には`CompletedSemanticTree`だけを格納する。DeliveryはSession roleからprojected `enabled`を導出し、viewerのInteraction ID / Hit Regionを配信前に除外する。差分や適用処理をRuntimeへ配信しない。overrideはbase Treeに存在するNodeとroleが許すpropertyだけを参照でき、全layerを通じて同じNode/propertyを重複して変更できない。fieldが存在しない場合だけbase値を保持し、requiredなtext / altは削除できず、optionalなtable labelだけを`null`で削除できる。`included: false`は対象Nodeとすべてのdescendantを完成Treeから除外し、required list / table structureを壊したり、除外されたNodeのdescendantを個別に再includeできない。これら、またはState間のID / role / parent / order / interaction変更はbuild errorとする。

Structured Component の Semantic Tree は Component Structure の semantic Primitive から生成し、Opaque Component は Manifest の `semantics` から生成する。renderer は layout と Hit Region の concrete geometry を解決するだけで、DOM、React tree、CSS、Texture、実行結果から意味を抽出・補完しない。

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
  priority: UInt32;
};
```

Hit region は Semantic Surface State ごとに解決し、bounds は Render Surface ではなく Semantic Surface 全体の normalized coordinate space で表す。`UInt32`は`0..4_294_967_295`のintegerとし、overlapはpriority降順、Interaction / Semantic Node ID、boundsのcanonical順で解決する。eventは重複保持せずInteraction definitionから解決する。boundsの有限範囲、duplicate key、half-open hit-test、State completenessは [ADR-0009](../decisions/0009-semantic-tree-hit-region-contract.md) を正本とする。UV原点とfit/crop変換は次の座標contractで固定する。v1は矩形click interactionに限定する。

各 State の Hit Region は同じ State の完成 Semantic Tree に含まれ、かつ `SurfaceStateDefinition.enabledInteractionIds` に含まれる `interactionId` だけを参照できる。参照先 Node が除外される場合、その Node の Hit Region も存在できない。Baked hit region として公開する enabled Interaction は少なくとも一つの region を持ち、disabled Interaction の region は禁止する。存在しない Node / Interaction、または Node の `interactionId` と異なる `interactionId` を持つ region は build error とする。

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
  semanticsByState: Record<SurfaceStateId, CompletedSemanticTree>;
  interactionsByState: Record<SurfaceStateId, ResolvedInteractiveRegion[]>;
};
```

RenderBundle の `surfaces` key は PresentationDefinition の SemanticSurfaceId と一致し、RenderSurfaceId から意味対象を逆引きしない。Semantic Tree と Hit Region は Semantic Surface State ごとに解決する。実行中は canonical `stateId` に対応する Semantic Tree を accessibility と意味的な interaction に使用し、transition 中の Hit Region は 12.4 の規則に従う。State に Native UI artifact がある場合、各 State binding は完全な `NativeUIArtifact` plan を参照する。crossfade 中の旧 State / 新 State の plan は同一の `ParticipantRuntimeView.variables` と `clock` sample に対して評価し、renderer ごとに異なる Variable snapshot や時刻を選ばない。

各 Render Surface の `SurfaceRendererArtifact` は次の discriminated union とする。

- `BakedWebArtifact`
- `NativeUIArtifact`
- `VideoArtifact`

全artifact kindは次のcommon compatibility envelopeを持つ。

```ts
type SurfaceRendererArtifactCompatibility =
  | { kind: "baked-web"; contractVersion: 1; requiredFeatures: BakedWebFeature[] }
  | { kind: "native-ui"; contractVersion: 1; requiredFeatures: NativeUIFeature[] }
  | { kind: "video"; contractVersion: 1; requiredFeatures: VideoFeature[] };

type BakedWebFeature = "png" | "srgb" | "alpha-opaque" | "alpha-straight" | "alpha-premultiplied";
type VideoFeature = "h264" | "vp9" | "av1" | "alpha" | "audio";
```

各concrete artifactの`kind`、`contractVersion`、UTF-16 code-unit昇順かつduplicate-freeな`requiredFeatures`はこのenvelopeと一致し、未知version / featureをfail closedで拒否する。Baked Webは`png`、`srgb`、alpha featureのいずれか一つをexactly onceで持つ。Videoはcodec featureを一つだけ持ち、`alpha` / `audio`は実際に含むtrackだけに付ける。Deliveryはnormalized Capability Profileが許可するkind / version / feature closureと照合し、選択したartifactの`contractVersion`を`DeliveredRenderSurface.artifactContractVersion`へcopyする。build-time `RendererIdentity.contractVersion: string`はrenderer plugin APIの互換性であり、artifact compatibilityへ流用しない。

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

Native UI Artifact は v1 では `group` と一行 `text` だけからなる portable UI tree とする。`group` は hierarchy、clip、解決済み bounds を持つ。`text` は解決済み bounds、単一行のalign / color / overflow、Font Asset、文字列値を持つ。editable field、native input、scroll、rich text、progress bar、任意 animation は v1 に含めない。

```ts
type NativeTextValue =
  | { kind: "literal"; value: string }
  | {
      kind: "variable";
      variableId: VariableId;
      expectedType: "string";
      format: {
        kind: "string";
        allowedCodePointRanges: Array<[number, number]>;
      };
    }
  | {
      kind: "variable";
      variableId: VariableId;
      expectedType: "boolean";
      format: { kind: "boolean"; trueLabel: string; falseLabel: string };
    }
  | {
      kind: "variable";
      variableId: VariableId;
      expectedType: "number";
      format: NumberFormat;
    }
  | {
      kind: "stepTimerRemaining";
      groupId: GroupId;
      stepId: StepId;
      cueId: CueId;
      durationMilliseconds: number;
      whenStepInactive: "empty" | "zero";
      format: TimerFormat;
    };

type NumberFormat = { kind: "number"; fractionDigits: 0 | 1 | 2 | 3 };
type TimerFormat = "mm:ss" | "hh:mm:ss";
type NativeUIFeature = "clip" | "ellipsis" | "explicitFontFallback";

type NativeUIRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateSpace: "renderSurfaceLogical";
};

type SRGBAColor = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
};

type ResolvedFontFace = {
  assetId: AssetId;
  supportedCodePointRanges: Array<[number, number]>;
};

type ResolvedFont = {
  primary: ResolvedFontFace;
  fallbacks: ResolvedFontFace[];
};

type NativeUIArtifact = {
  kind: "native-ui";
  contractVersion: 1;
  requiredFeatures: NativeUIFeature[];
  rootNodeId: NativeUINodeId;
  nodes: Record<NativeUINodeId, NativeUINode>;
};

type NativeUINode =
  | {
      kind: "group";
      id: NativeUINodeId;
      bounds: NativeUIRect;
      clip: boolean;
      children: NativeUINodeId[];
    }
  | {
      kind: "text";
      id: NativeUINodeId;
      bounds: NativeUIRect;
      semanticNodeId: SemanticNodeId;
      value: NativeTextValue;
      font: ResolvedFont;
      color: SRGBAColor;
      fontSize: number;
      lineHeight: number;
      align: "start" | "center" | "end";
      overflow: "clip" | "ellipsis";
      maxCodePoints: number;
    };
```

`NativeUIArtifact` は State ごとの完全 plan である。`rootNodeId` と全 child reference は `nodes` 内に存在し、一つの root から全 Node が一度だけ到達可能で、cycle、複数 parent、child order の重複を許可しない。bounds は Render Surface の logical coordinate で表し、全値は有限、size は非負とする。sRGB RGBA の各 channel は `0..1` とする。text の `fontSize` と `lineHeight` は有限かつ正、`maxCodePoints` は正の整数とする。Node 数、tree depth、text数、glyph数、文字列の Unicode code point 数は artifact contract と target capability が定める上限以下でなければならない。`clip` を使う plan は `clip`、`ellipsis` を使う plan は `ellipsis`、fallback font を持つ plan は `explicitFontFallback` を必ず `requiredFeatures` に含める。未知の required feature や contract version は fail closed とする。

Runtime binding の対象は `text.value` だけである。literal、宣言済み Runtime Variable、現在 Step の timer 残時間以外の source、任意式、JSON path、style / geometry / visibility / font の Runtime 変更は build error とする。Variable binding は string、boolean、有限 number だけを受け、`null` は拒否する。single-line 禁止 / 置換対象は U+000A、U+000B、U+000C、U+000D、U+0085、U+2028、U+2029 に固定する。literal と boolean label はこの一覧を含められず、整形後の表示 code point 数が `maxCodePoints` 以下でなければ build error とする。したがって静的値は Runtime で truncate されず、literal は `CompletedSemanticNode.text` と常に一致する。dynamic string は最初にこの一覧を U+0020 に置換し、次に結果を `allowedCodePointRanges` で検査して範囲外の code point を U+FFFD に置換する。したがって置換後の U+0020 が許容範囲外ならU+FFFDになる。boolean は明示した `trueLabel` / `falseLabel`、number は grouping なしの ASCII 数字、`fractionDigits` 0〜3、half-away-from-zero の丸めに固定する。

timer の `durationMilliseconds` は有限かつ正とし、現在 Group / Step が binding の `groupId` / `stepId` と一致するときは armed / fired、Cue の Guard 成否を問わず、`remaining = max(0, durationMilliseconds - (clock.runtimeTimeMilliseconds - progression.stepEnteredAtRuntimeTimeMilliseconds))` を表示値に使う。Group または Step が不一致のときだけ `whenStepInactive` に従い、空文字列またはゼロを表示する。残時間は秒へ切り上げて 0 で clamp する。`mm:ss` は分が二桁を超えても必要桁まで増やして秒を二桁で表示し、`hh:mm:ss` は時間を必要桁まで増やして分・秒を二桁で表示する。`whenStepInactive: "zero"` は同じ timer format でゼロを表示する。Compiler は `stepTimerRemaining` が実在する `groupId` / `stepId` / `cueId` の timer Trigger を参照し、`durationMilliseconds` が一致することを検証する。timer owner は Cue の所属 Group から導出し、binding は host SurfaceNode が同じ Group-owned の場合だけ許可する。presentation-owned Surface は group-owned timer を参照できない。Cue 自体は ProjectionAudience を持たないため、timer表示は visible Surface の audience projection に従う。client は `ParticipantRuntimeView.clock` と `progression.stepEnteredAtRuntimeTimeMilliseconds` から表示だけを計算し、timer state を別途投影しない。完了判定と Cue 発火は常に割り当て済み Runtime Core だけが行う。共通 truncation は動的 string / number / timer の format 結果だけに `maxCodePoints` を適用する。超過時は `overflow: "clip"` なら先頭 `maxCodePoints` code point、`overflow: "ellipsis"` なら先頭 `maxCodePoints - 1` code point と U+2026 を使い、`maxCodePoints === 1` では U+2026 だけを使う。Unity と Web preview は同じ fixture に対して同じ pure formatter 結果を返さなければならない。

Authoring では各 text と各 Surface State が Font Asset または Theme Font Token を自由に指定できる。Compiler は State ごとの Native UI artifact に concrete Font Asset と、authoring で明示した fallback Font Asset 列を解決する。`supportedCodePointRanges` は各 delivered font face が実際に描画可能な code point を表す。text は `primary`、`fallbacks` の順に、対象 glyph を最初に持つ face を使う。system font への暗黙 fallback と synthetic bold / italic は許可しない。literal、boolean label、string binding の `allowedCodePointRanges` と formatterで生成し得る U+0020 / U+FFFD、number の ASCII digit / `-` / `.`, timer の ASCII digit / `:`, U+2026 は font closure に含まれなければならない。全 reachable State の plan が参照する primary / fallback font face、supported code point range、required Native UI feature は Asset / capability closure に含まれなければならない。解決できない font / fallback / glyph coverage、または target capability が必要な font を満たさない場合は Delivery 前に reject する。font の選択は artifact の State 切替でだけ変わり、Runtime Variable / Clock binding から変更できない。

各 Native UI text はその State の完成 Semantic Tree に含まれる `semanticNodeId` を一つだけ参照しなければならない。resolved State の一つの Native UI plan 内では、この対応は injective とし、複数 Text Node が同じ `semanticNodeId` を参照できない。さらに、同じ Semantic Surface / State に対して一つの ProjectionProfile が同時選択する全 Native UI artifact を横断しても injective とする。Compiler は artifact ごとの制約を、Control Plane は profile selection 後のartifact組合せを検証する。異なる ProjectionProfile は別々に検証する。literal は対応する `CompletedSemanticNode.text` と同じ値を持つ。dynamic valueでは`CompletedSemanticNode.text`をnon-empty accessibility fallbackとして保持し、clientが同じnon-empty formatted valueをvisual textとParticipant Runtime Viewから派生するeffective Semantic Tree textへ適用する。formatted valueがemptyまたは利用不能ならvisual textはその結果に従い、effective semantic textだけをfallbackへ戻す。canonical Semantic Treeの構造とIDは変えず、rendererが意味を推測しない。effective textはSnapshotのVariable / clock / progressionから再現できる。Native UI v1はnon-interactiveなので、参照するSemantic Nodeは`interactionId`を持てない。crossfade中のeffective semantic valueは12.4のcanonical Surface State規則に従い、遷移先Stateを有効な意味状態として使用し、旧 / 新plan間で別のVariable / clock snapshotを使わない。

### 14.4 Video Artifact

Video Artifact は Asset ID、checksum、duration、loop、alpha、audio、codec capability を保持する。

## 15. コンパイルと配信

```text
Orchestrator / Theme Declaration / Manifest / Structured Component Structure
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
Current Published Presentation
        ↓ Control Plane validation and role / capability projection
DeliveryManifest
        ↓
Unity Runtime
```

### Local Compiler

- Authoring Source を parse し、Lossless Syntax Tree、Source Map、Stable ID の対応を保持する。
- Presentation Orchestrator、Theme Declaration、Component Manifest、Structured Component Structure の import、symbol、型、DSL signature を解決し、検証済み AST から Declaration Graph へ静的に lower する。
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
- 現在の PublishedPresentation、認可済み role、正規化済み capability profile から共有可能な ProjectionProfileDescriptor を生成する。
- profile を participant / assignment 固有の ProjectionInstance と Asset access binding へ結合して DeliveryManifest を生成する。
- Signed URL を生成し、永続化しない。
- Definition と RenderBundle の異なる revision を混在させない。

### Published Presentation

Control Plane は Presentation ごとに現在の PublishedPresentation を一つだけ保持する。Session は Presentation を参照し、作成時に現在の PublicationFence を固定する。期限内の `Waiting` Session または `Presenting` Session が存在する間は publish できず、Draft 編集と build の結果も既存 Session へ反映しない。Presentation owner / admin による Waiting Session の cancel と bounded waiting expiry を提供し、期限切れ Waiting Session を終了させた後の明示的な publish でだけ、公開済み実行物を atomic に置き換える。

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

`.unframe-cache/renderers/` は Local Compiler が Opaque renderer source から再生成できる中間 bundle を保持できるが、version control や publish には含めない。PublishedPresentation に含める renderer artifact は RenderBundle の一部として hash と provenance を固定する。

`dist/presentation.definition.json` は v1 の最終的な PresentationDefinition artifact である。ただし、GUI / Code 編集を JSON だけで継続することは保証せず、Authoring Source と Semantic Authoring IR の対応情報は別に保持する。

## 17. 現行実装との関係

この文書は目標アーキテクチャである。2026-08-29 時点の現行実装について、次を区別する。

### Current

- Control Plane の `PresentationDefinition` は JSON/OpenAPI 契約である。
- 現行 Definition は metadata、stage、asset references、Group、Element、Anchored Element Group、Step、Cue、Trigger、Action、Transition を持つ。
- Control Plane は Definition 全体を revision 条件付きで原子的に保存する。
- 現行 Session は `presentationId` を持つが PublicationFence を保存せず、RuntimeAssignment は mutable な Presentation revision を fence に使用している。
- 現行 Session は有限の waiting expiry と Presentation owner による第三者作成 Waiting Session の cancel を持たない。
- Asset URL や object key は Definition に保存せず、Asset IDで参照する。
- 現行 Web Editor は Slide ベースの PoC model を使用しており、target PresentationDefinitionへ未接続である。
- Unity の手書き importer は target PresentationDefinition の完成 consumer ではない。

### Target（初期contract subsetのみ実装済み）

- Semantic Authoring IR
- `.unframe.tsx` Orchestrator
- Orchestrator / Manifest / Structure AST の static lowering、Declaration Graph normalization、Opaque renderer bundling の build pipeline
- Canonical `presentation.definition.json` の deterministic serialization（Core APIとpost-lowering declarationからのCompiler artifact生成は実装済み、Authoring Sourceからの接続は未実装）
- Component Manifest と package format
- Structured / Opaque authoring mode
- Spatial Tree / Surface Tree のcanonical schema（Stage、SurfaceNode、Frame / Text、State、baked-web Render Intentの初期subsetはJSON Schema Draft 2020-12として実装済み）
- Frame Layout、Theme、Token、Named Style
- Surface Render Intent
- RenderBundle（baked-web artifactの初期subsetは実装済み）
- 単一の PublishedPresentation、PublicationFence、Waiting Session の owner cancel / bounded expiry、非終了 Session と直列化した publish lock
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
- Local Compiler は Orchestrator、Theme Declaration、Manifest、Structure を実行せず、検証済み AST から Declaration Graph へ静的に lower する。
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
- Cloud または Venue Edge に配置された割り当て済み Runtime Core が Trigger、Guard、Cue、Action、Timeline 完了を canonical evaluationする。
- 一イベントにつき一 Cue を選択し、Cue 内の Action batch を事前検証後に atomic 適用する。
- Surface State は意味論的 ID とし、renderer artifact から分離する。
- blocking run の完了後に次の Step へ進み、遷移中は通常 input と新しい Cue 評価を抑止する。
- Group 再入場は reset とし、Snapshot と Reliable Event から同じ進行状態へ収束できるようにする。
- Presentation は公開済み実行物を一つだけ持ち、期限内の Waiting Session または Presenting Session が存在する間の publish を禁止する。Session は Presentation を参照し、作成時の PublicationFence を固定して Draft と実行中の状態を混在させない。放置された Waiting Session は owner cancel と bounded expiry で解放する。

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
- [x] pause-aware logical runtime clock、Step entry / Timer / Cue consumption、Runtime Run、Canonical Runtime Snapshot、Connection / Durable envelope と recovery 規則を 12.3、12.9、12.11〜12.12 で定義した。
- [x] 単一の PublishedPresentation、PublicationFence、Waiting Session の owner cancel / bounded expiry、非終了 Session 中の publish lock、Draft / Build / Session の反映規則を 3.6 と 15 で定義した。
- [x] Surface transition、Action batch、active Timeline Run の conflict policy と Timeline の補間・停止規則を 12.4、12.7、12.8、12.12 で定義した。
- [x] State ごとの完成 Semantic Tree、Hit Region 整合、Native UI v1 subset、text binding、font asset、projection Variable / Clock 規則を 3.5、3.7、7.4、13.2〜13.3、14.3 で定義した。
- [x] Surface transition の開始・完了、Surface interaction input / outcome、Interaction / Hit Region 有効化の wire contract を 12.11 で定義した。
- [x] Spatial TRS / matrix / Quaternion、Unity handedness、Surface logical / physical / raster / UV変換を [ADR-0010](../decisions/0010-spatial-surface-coordinate-contract.md) で定義した。
- [x] Surface Partitionのautomatic boundary、Part isolate override、derived ID / layer / region aggregateを [ADR-0011](../decisions/0011-surface-partition-contract.md) で定義した。

### Progression wire / Runtime contract の blocking follow-ups

1. [x] Timeline の補間結果、停止理由、Run lifecycle の semantic wire contract は [ADR-0007](../decisions/0007-timeline-runtime-run-wire-contract.md) で Accepted とした（transport protobuf schema は Draft・未実装）。
2. [x] Reliable Event / Snapshot / State Stream の transport schema、保持期間、runtime microstep 上限は [ADR-0008](../decisions/0008-runtime-transport-contract.md) で Accepted とした（proto / generated consumer は M5 で実装する）。

### Rendering / Delivery の follow-ups

1. [x] role 別 Semantic schema と Hit Region の完全 schemaは [ADR-0009](../decisions/0009-semantic-tree-hit-region-contract.md) でAcceptedとした（current flat schemaの実装置換はM3 Slice B）。
2. [x] Transform / Quaternion / matrix / Unity / Surface / UV座標規約は [ADR-0010](../decisions/0010-spatial-surface-coordinate-contract.md) でAcceptedとした（fixtureとconsumer実装はM3〜M5）。
3. [x] ComponentからSurfaceへのpartition規則とauthor overrideは [ADR-0011](../decisions/0011-surface-partition-contract.md) でAcceptedとした（実装はM3〜M4）。
4. Texture state artifact 数と GPU / RAM build budget
5. Resolution、mipmap、compression、preload、eviction policy
6. Component Manifest と renderer implementation の drift 検証
7. Opaque renderer の Browser capability、module resolution、cache invalidation と Compiler / Browser / Font / Locale の再現性
8. DeliveryManifest Protobuf schema、capability negotiation、visual regression test

## 20. 次の設計対象

blockingなTimeline / transport / Semantic / coordinate contractはAcceptedになった。次のRendering / Delivery設計は次の順で閉じる。

1. Texture / GPU / RAM budget

中心となる思想は次のとおりである。

> `.unframe.tsx` は Presentation の composition root、Theme Declaration と Component Manifest は宣言的な公開契約、Semantic Authoring IR は GUI と Code の共通モデルとする。Local Compiler は Orchestrator、Theme、Manifest、Structure を AST から静的に lower し、Opaque renderer だけを bundle して、canonical PresentationDefinition JSON と renderer artifact へ build する。
