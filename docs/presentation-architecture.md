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
  - [ADR-0005: 空間プレゼンテーションのドメインモデルを定義する](./decisions/0005-spatial-presentation-domain-model.md)
  - [ADR-0006: プレゼンテーションアーキテクチャを定義する](./decisions/0006-presentation-rendering-strategy.md)
  - [Repository Architecture](../ARCHITECTURE.md)
  - [Server Architecture](../app/server/ARCHITECTURE.md)

## 1. この文書の位置付け

この文書は、Unframe のプレゼンテーションについて、コード、GUI、描画、配布、Runtime を一つの形式へ押し込まず、共通の意味モデルを中心に接続する目標アーキテクチャを定義する。

この文書に記載された境界と原則は設計上の基準として採用する。ただし、すべてが現在のコード、API、Unity Runtime に実装済みであることを意味しない。現行実装との差は「現行実装との関係」に明記する。

## 2. 全体構成

```text
Presentation Orchestrator
presentation.unframe.tsx
        │  restricted authoring DSL
        │
        ├─ Component Manifest / Component Structure
        ├─ Component Renderer (Local Compiler only)
        ├─ Theme / Token
        └─ Asset
        │
        ▼
Semantic Authoring IR
        │
        ├─ GUI editing
        ├─ Code editing
        ├─ Validation
        └─ Semantic commands
        │
        ▼ Local Compiler
PresentationDefinition + RenderBundle + Asset Set
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

- TSX、JSON、Protobuf は意味モデルそのものではなく、入力、保存、デバッグ、配布のための表現形式とする。
- `.unframe.tsx` はプレゼンテーション全体を直接描画する巨大な実装ではなく、Component の配置と接続を行う composition root とする。
- Component の公開契約と renderer 実装を分離する。
- GUI と Code は同じ Semantic Authoring IR を編集する。
- GUI が任意の TSX、CSS、JavaScript を完全に逆解析できるとはみなさない。
- Control Plane と Unity Runtime は TSX、React、CSS、authoring JavaScript を実行しない。
- Texture、Video、Protobuf、debug JSON は生成物であり、編集元の正本にはしない。
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

Component Action は compile 時に `surface.setState`、Node State、Timeline、Variable などの canonical Action batch へ展開する。Component Output も canonical semantic event へ展開する。どちらも Runtime wire contract に Component 固有の操作として残さない。

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

エンコード方式自体は意味モデルの一部ではない。現行 Control Plane は JSON/OpenAPI 契約を使用しているが、debug、export、interop 用の JSON と、将来の別形式を区別できる境界を保つ。

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

Unity Runtime 向けに解決した Runtime Projection である。

```text
DeliveryManifest
├─ Presentation / RenderBundle revision
├─ Runtime renderer graph
├─ Resolved Spatial Transform
├─ Selected renderer and resolution
├─ Asset bindings
├─ Texture states
├─ Hit regions
└─ Required runtime capabilities
```

配布形式は Protobuf を第一候補とするが、具体的な schema と versioning は別途決定する。

### 3.6 Immutable Release

Release は、互いに整合する PresentationDefinition、RenderBundle、Asset Set、contract version を束ねる publish 済みの immutable な実行単位である。Room と Session は Release ID を pin し、Delivery、Snapshot、Reliable Event は同じ Release を参照する。

### 3.7 Runtime State

Session 中に変化する状態であり、PresentationDefinition や RenderBundle へ書き戻さない。

```text
Shared Runtime State (Venue Edge authority)
├─ Current Group / State / Step
├─ Node Transform and visibility
├─ Surface State and active state transition
├─ Video playback / active Runtime Run
├─ Anchor / Pose の共有投影
└─ Participants / Presence

Role Projection State
├─ Presenter 用 controls / notes state
└─ role / capability ごとに可視な Shared State の projection

Client-local State
├─ Viewport
├─ Local selection
└─ Personal annotation
```

Client-local State は Shared Progression に混入させない。外部 Trigger は actor と、追跡や入力の対象となる subject を明示し、v1 の Shared Progression を変更できる actor は Presenter または System に限定する。

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

```text
components/Hero/
├─ Hero.manifest.ts
├─ Hero.web.tsx
├─ Hero.css
├─ Hero.preview.ts
└─ Hero.test.ts
```

### 5.1 Component Manifest

```ts
export const Hero = defineComponentManifest({
  componentId: "@unframe/components/Hero",
  version: 1,

  authoring: {
    mode: "structured",
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
      from: "hidden",
      to: "shown",
      timeline: "reveal",
    }),
  },

  outputs: {
    completed: output(),
  },

  renderers: {
    "baked-web": {
      entry: "./Hero.web.tsx",
    },
  },
});
```

GUI は Manifest から Inspector と編集可能範囲を構築する。renderer 実装を解析して公開契約を推測しない。

### 5.2 Structured Component

- GUI が内部構造を理解できる。
- GUI と Code の意味論的 round-trip を保証する。
- Props、Slot、Part、State、Frame Layout を宣言的モデルとして編集できる。
- GUI が変更できる構文を限定し、任意の式や制御構造を自動変換しない。
- 内部構造の正本は GUI が理解できる宣言的な Component Structure であり、`*.web.tsx` renderer ではない。Component Structure の格納先（Manifest 内か別ファイルか）は下位仕様で決める。

### 5.3 Opaque Component

- 任意の React、CSS、JavaScript を使用できる。
- GUI が編集できるのは Manifest が公開した Props、Slot、Part と Instance placement に限定する。
- 内部実装は Code が所有する。
- build 時に Web Surface として描画できる。
- 任意の `map`、条件分岐、関数計算は build 可能でも GUI 内部編集の対象にはしない。

Presentation Orchestrator と Structured Component は、静的解析できる制限付き DSL とする。任意の実行可能コードを許すのは Opaque renderer だけであり、Local Compiler の隔離された build 環境でのみ実行する。Control Plane、Venue Edge、Unity Runtime はこれを実行しない。

自由な Code と完全な GUI 編集を同時に保証せず、Component 単位で境界を明示する。

### 5.4 Component Instance と Detach

Component Instance は Component ID、package lock、Props、Variant、Slot binding、公開 Part override を持つ。

Component 内部では local ID を使用し、Compiler が Instance ID と local ID から安定した Runtime ID を生成する。Global Flow は Component 内部 Node を直接参照せず、公開 Part、Action、Output を参照する。

抽象を超えた編集が必要な場合は Detach する。

- 現在の Props、Slot、Variant、Override を適用する。
- Component を独立した authoring subtree へ展開する。
- 参照されている安定 ID を維持する。
- Package 更新から切り離す。
- Delivery artifact や Texture から Component source を復元しない。

## 6. GUI と Code

GUI は TSX 文字列を推測で書き換えない。

```text
Code
  ↓ Parse
Lossless Syntax Tree
  ↓ Project
Semantic Authoring IR
  ↑
GUI Semantic Commands
  ↓
Syntax Tree Patch
  ↓
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

保証する round-trip は正規化後の意味論的同値性であり、任意の手書きソースについて文字列単位の完全一致を保証しない。

## 7. Scene Graph

Scene Graph は Spatial Tree と Surface Tree からなる 2.5D 構造とする。

```text
Group
└─ Spatial Tree
   ├─ Container3D
   ├─ Model
   ├─ Audio
   └─ Surface
      └─ Surface Tree
         ├─ Frame
         ├─ Text
         ├─ Image
         ├─ Video
         └─ Shape
```

Surface は用途に応じて次の三層を区別する。

- **SurfaceNode** は Spatial Tree 上の host であり、Transform と Timeline の対象である。
- **Semantic Surface** は PresentationDefinition 上の安定した意味、State、Interaction を持つ。
- **Render Surface** は RenderBundle 内で Compiler が生成する描画単位である。

Progression は Semantic Surface ID を参照し、partition の結果である Render Surface ID を参照しない。一つの Semantic Surface が複数の Render Surface や Native UI Node へ lower されても、この参照関係は変わらない。

### 7.1 Group

Group は物語上の進行スコープであり、Scene Graph の親子構造そのものではない。

```text
Group
├─ Root Spatial Node
├─ Initial State
├─ Flow
├─ Timelines
└─ Owned resources
```

Group scope に属する Node、Semantic Surface、Timeline、Variable は Group entry / exit 時の reset または停止対象となる。Presentation 全体で継続する背景や共有モデルなどは Group ではなく presentation scope に所属させる。

### 7.2 Stable Node Graph

Semantic Authoring IR では Node を安定 ID で管理する。

```ts
type NodeBase = {
  id: NodeId;
  parentId: NodeId | null;
  order: number;
  name?: string;
};

type SceneGraph = {
  rootNodeId: NodeId;
  nodes: Record<NodeId, SceneNode>;
};
```

Code 上の入れ子表現は parse 時にこの関係へ正規化する。`parentId` の循環を禁止し、`order`とIDを分離する。

### 7.3 Spatial Tree

- Position は meter とする。
- 座標系は right-handed、Y-up、forward -Z とする。
- Rotation は `[x, y, z, w]` 順の正規化 Quaternion とする。
- Scale は無次元倍率とする。
- Presentation Origin、Stage、Spatial Node、Body Anchor を親座標として扱う。

ここまでの座標規約は ADR-0005 で固定済みである。Transform の合成順、Quaternion の乗算順、matrix layout、Unity との変換、Surface logical coordinate と UV の完全な変換規則は下位 contract で固定する。

```ts
type SpatialParent =
  | { kind: "stage" }
  | { kind: "node"; nodeId: NodeId }
  | {
      kind: "anchor";
      target: "head" | "leftHand" | "rightHand" | "body";
      owner: { kind: "presenter" } | { kind: "participant"; participantId: ParticipantId };
      followPosition: boolean;
      followRotation: boolean;
    };
```

### 7.4 Surface Tree

- Surface は Spatial Tree と 2D UI を接続する。
- Spatial Transform は Surface に対応する SurfaceNode が所有する。
- Surface 内部は logical unit を使用する。
- 原点は左上、+X は右、+Y は下とする。
- Surface 内部の Node は Surface または Frame を親とする。

```ts
type Surface = {
  id: SurfaceId;
  physicalSize: [number, number];
  logicalSize: [number, number];
  fit: "contain" | "cover" | "stretch";
  rootFrameId: NodeId;
};
```

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
Runtime Render Node
├─ native-3d
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
- Surface 単位で Texture を生成する。
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
- Surface は描画、状態、アニメーションの境界である。
- 一つの Component が複数 Surface や Native Node へ展開されることを許す。
- 常に一緒に移動、状態変更する内容は同じ Surface にまとめられる。
- 独立して移動、状態変更、入力処理する内容は別 Surface または Native Node に分ける。

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
| Surface 全体の移動、回転、拡縮、Fade | Unity Spatial Node |

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
- v1 で Global Progression を変更できる外部 input は Presenter 由来に限定する。System の内部 completion event は許可するが、participant 固有 interaction から共有進行を変更する規則は v1 に含めない。

### 12.2 Flow definition

Group と Presentation は配列の先頭に依存せず、初期 ID を明示する。

```ts
type PresentationFlow = {
  initialGroupId: GroupId;
  groups: Record<GroupId, GroupFlow>;
  variables: Record<VariableId, VariableDefinition>;
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
```

Timer、Cue 消費状態、cooldown は `stepEntryEpoch` に属する。これにより self transition と Group reentry の後に、古い Step entry の timer や once 実行状態を復元しない。

Surface transition、Timeline、Media は共通の **Runtime Run** として追跡する。各 Run は `runId`、原因 Cue、開始 runtime time、完了条件、状態を持つ。blocking run は Progression Phase の `blockingRunIds` と対応し、Snapshot から復元できなければならない。

`transitioning` 中は、Timeline 完了などの内部イベントを除く通常の Trigger input を無視する。v1 では input queue や任意 interrupt を持たない。

### 12.4 Surface State

Surface State は `hidden`、`shown`、`selected`、`correct` のような意味論的状態であり、Texture ID、Material、CSS class、Unity GameObject を参照しない。

```ts
type SurfaceDefinition = {
  id: SurfaceId;
  initialStateId: SurfaceStateId;
  states: Record<SurfaceStateId, SurfaceStateDefinition>;
};

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

`surface.setState` を受理した時点で canonical `stateId` は遷移先へ変更する。Crossfade 中の旧状態、開始時刻、duration は `transition` に保持し、`runId` で対応する Runtime Run と結びつける。Guard と canonical Semantic Tree が参照する Surface State は遷移先の `stateId` とする。

v1 の Surface transition は `cut` または blocking な `crossfade` に限定する。同じ Surface に transition が active な間の新しい `surface.setState` は reject し、replace、interrupt、queue は含めない。Crossfade 中は Surface interaction を無効にし、完了後に遷移先 State の hit region を有効にする。

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
type TriggerActorSelector = { kind: "presenter" } | { kind: "system" };

type TrackedSubjectSelector =
  | { kind: "presenter" }
  | {
      kind: "anchor";
      target: "head" | "leftHand" | "rightHand" | "body";
      owner: { kind: "presenter" } | { kind: "participant"; participantId: ParticipantId };
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
      actor: { kind: "system" };
      subject: TrackedSubjectSelector;
      zoneId: ZoneId;
      edge: "enter" | "exit";
      dwellMilliseconds?: number;
      hysteresisMeters?: number;
    }
  | {
      kind: "motion";
      actor: { kind: "system" };
      subject: TrackedSubjectSelector;
      minimumDistanceMeters: number;
      windowMilliseconds: number;
    }
  | { kind: "timer"; afterMilliseconds: number }
  | { kind: "timelineCompleted"; timelineId: TimelineId }
  | { kind: "mediaCompleted"; surfaceId: SurfaceId };
```

`surfaceInteraction` は現在の canonical Surface State において対象 Interaction が存在し、有効である場合だけ成立する。client が申告した Surface State は判定に使用しない。Trigger は event の `actor` と、必要な場合は `subject` も照合し、宣言されていない participant input が Shared Progression を変更しないようにする。

Zone と Motion は Venue Edge が Tracking Stream から評価し、edge 成立時に内部イベントへ変換する。Raw Pose は Reliable Event として replay せず、現在の zone membership や hysteresis など、誤再発火を防ぐための小さな edge detector state だけを Snapshot に含める。

```ts
type RuntimeInputEvent = {
  eventId: string;
  actor: { kind: "presenter" } | { kind: "participant"; participantId: ParticipantId } | { kind: "system" };
  subject?: { kind: "participant"; participantId: ParticipantId } | { kind: "anchor"; anchorId: AnchorId };
  kind: RuntimeInputKind;
  payload: unknown;
  capturedAt?: number;
  ingressSequence: number;
};
```

`eventId` は冪等適用、Venue Edge が割り当てる `ingressSequence` は順序決定に使用する。client の `capturedAt` は診断専用であり、イベント順序には使用しない。

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
  | { kind: "eventPayload"; path: string }
  | { kind: "surfaceState"; surfaceId: SurfaceId }
  | {
      kind: "nodeField";
      nodeId: NodeId;
      field: "active" | "visible" | "opacity";
    };
```

Variable は PresentationDefinition で型と初期値を宣言し、scope を `presentation` または `group` とする。任意 JavaScript、callback、時刻取得、乱数、network access、Renderer state の参照は許可しない。

### 12.7 Action

Action は renderer-independent な意味論的対象だけを変更する。

```ts
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
      patch: Partial<NodeRuntimeState>;
    }
  | {
      kind: "timeline.play";
      timelineId: TimelineId;
      completion: "blocking" | "nonBlocking";
      conflict: "reject";
    }
  | { kind: "timeline.stop"; timelineId: TimelineId }
  | { kind: "variable.set"; variableId: VariableId; value: Scalar }
  | { kind: "media.play"; surfaceId: SurfaceId }
  | { kind: "media.pause"; surfaceId: SurfaceId }
  | { kind: "media.seek"; surfaceId: SurfaceId; positionSeconds: number };
```

Runtime は Cue を受理する前に、すべての Action target、Surface State、Timeline、値の型、property conflict を検証する。一つでも不正なら batch 全体を拒否し、partial apply や Step 遷移を行わない。Delivery preflight で検出できなかった実行時 fault が発生した場合は、進行を継続せず Runtime を `Paused` にする。

Action 同士の順序に意味を持たせない。依存した順次演出は次の Step、Timeline keyframe、または `timelineCompleted` Trigger で表現する。

v1 の Action conflict は action 配列順で解決しない。同一 Surface への複数 `surface.setState`、同一 Variable への複数書き込み、同一 Node field への複数 patch、Node patch と Timeline の同一 property 所有、同一 Timeline の play / stop、同一 media target への競合操作は batch validation で reject する。異なる field への Node patch だけは一つの patch として統合できる。`replace`、additive animation、暗黙的な last-write-wins は将来拡張とする。

### 12.8 Timeline

Timeline は連続補間可能な property の時間変化だけを所有する。

```ts
type TimelineDefinition = {
  id: TimelineId;
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

- Surface 全体の Transform と opacity は、その Surface に対応する Spatial Node の track として表現する。
- `SurfaceStateId`、Texture ID、renderer、CSS property、任意の Component 内部値は Timeline track にしない。
- Baked Surface 内部の個別 Node を動かす必要がある場合は、Surface 分割、有限状態 artifact、Video、Native UI のいずれかへ lower する。
- Timeline は absolute 値を指定する。各 track の最初の keyframe は `0 ms`、最後の keyframe は Timeline duration とし、keyframe 時刻は単調増加して同時刻を許可しない。
- Rotation は正規化 Quaternion の shortest-path SLERP で補間する。
- 同じ `target/property` を同時に所有できる Timeline Run は一つだけとする。v1 の conflict policy は `reject` のみであり、replace と additive animation は含めない。
- Timeline は Group scope とし、Group exit 時に停止する。Step 遷移だけでは停止しない。
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

Group へ入場する時は次を順に適用する。

1. 旧 Group scope の Timeline と media action を停止する。
2. `groupEntryEpoch` を増加する。
3. 対象 Group の Node Runtime State を initial state へ戻す。
4. Surface を `initialStateId` へ戻す。
5. Group scope Variable を初期化する。
6. Cue consumption と cooldown を初期化する。Trigger edge detector は現在値から seed し、入場時の疑似 edge を発火しない。
7. `initialStepId` を有効にして `stepEntryEpoch` と Step entry runtime time を更新し、entry 処理後から Trigger 評価を開始する。

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
type RuntimeSnapshot = {
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

再接続 client は Snapshot を適用した後、`reliableSequence + 1` 以降の Reliable Event を順序適用する。Timeline の tick 履歴は replay せず、Runtime Run の開始時刻と elapsed から現在値を再計算する。Definition、RenderBundle、Snapshot の hash または revision が一致しない場合は実行を開始しない。

### 12.12 v1 validation requirements

Compiler、Control Plane、Delivery projection は少なくとも次を検証する。

- `initialGroupId`、`initialStepId`、Cue の `next` が存在する。
- Cue、Surface、Surface State、Timeline、Node、Variable の参照先が存在する。
- 同じ Step に `priority` と `order` が重複する Cue がない。
- Timeline keyframe の時刻、型、Quaternion、duration が正しく、各 track が `0 ms` と duration を境界に持つ。
- 同一 Timeline 内で `target/property` が競合しない。
- 同一 Cue の Action batch に v1 で許可されない property conflict がない。
- Surface State と renderer artifact、hit region の対応が完全である。
- `surfaceInteraction` が参照する Interaction が対象 Surface State で利用できる。
- Surface transition 中に interaction が有効化されない。
- Group exit をまたいで blocking run が残らない。
- Snapshot が Step entry、timer deadline、Cue state、active Runtime Run を復元できる。
- zero-duration の内部イベントだけで到達できる無限遷移がない。
- Snapshot に renderer artifact ID、Signed URL、raw Pose history が含まれない。

Conformance test では、event の重複、Cue 競合、cooldown、遷移中の追加入力、Timeline conflict、Group reentry、Pause / Resume、Snapshot + Replay 後の状態一致を検証する。

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

Hit region は Surface State ごとに解決し、UV 原点、fit/crop、overlap priority、visibility を Delivery contract で固定する。v1 は矩形 click interaction に限定する。

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

  surfaces: Record<SurfaceId, CompiledSurface>;
};
```

### 14.1 Compiled Surface

```ts
type CompiledSurface = {
  logicalSize: [number, number];
  physicalSizeMeters: [number, number];
  supportedRenderers: SurfaceRendererArtifact[];
  semanticsByState: Record<SurfaceStateId, SemanticTree>;
};
```

Semantic Tree と Hit Region は Surface State ごとに解決する。実行中は canonical `stateId` に対応する Semantic Tree を accessibility と意味的な interaction に使用し、transition 中の Hit Region は 12.4 の規則に従う。

`SurfaceRendererArtifact` は次の discriminated union とする。

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
presentation.unframe.tsx
        ↓ Parse / Typecheck
Component Manifest resolution
        ↓
Semantic Authoring IR
        ↓
Component / Slot / Variant expansion
        ↓
Theme / Token resolution
        ↓
Surface partition
        ↓
Browser capture / Native UI plan / Video generation
        ↓
PresentationDefinition + RenderBundle
        ↓ publish
Immutable Release
        ↓ Control Plane validation and role / capability projection
DeliveryManifest
        ↓
Unity Runtime
```

### Local Compiler

- Component、Slot、Variant を解決する。
- Theme、Token、Style を解決する。
- Surface boundary を決める。
- Browser 環境で Layout と capture を行う。
- Texture、Video、Native UI plan を生成する。
- Semantic Tree、hit region、source map を生成する。
- PresentationDefinition と RenderBundle の hash を対応付ける。

### Control Plane

- Authoring source や renderer implementation を実行しない。
- PresentationDefinition と RenderBundle の schema、hash、revision を検証する。
- Asset ownership、ready status、checksum を検証する。
- 認可と target capability に基づいて DeliveryManifest を投影する。
- Signed URL を生成し、永続化しない。
- Definition と RenderBundle の異なる revision を混在させない。

### Immutable Release

Release は publish された `PresentationDefinition`、`RenderBundle`、Asset Set、各 contract version を一つに束ねた immutable な実行単位である。Room と Session は一つの Release を pin し、Snapshot と Reliable Event はその Release を識別する。Draft の変更を active Room へ反映する方法、または Session 中に Release を差し替える方法は、この文書では決めない。

### Unity Runtime

- DeliveryManifest を検証する。
- Runtime renderer graph を構築する。
- Asset を download、cache、preload、unload する。
- Spatial Transform、Anchor、State、Transition、Playback を適用する。
- Device input を Logical Event へ変換する。
- TSX、CSS、React、Component implementation を解釈しない。

## 16. 想定ファイル構成

```text
presentation/
├─ presentation.unframe.tsx
├─ theme.unframe.ts
├─ components/
│  ├─ Hero/
│  │  ├─ Hero.manifest.ts
│  │  ├─ Hero.web.tsx
│  │  ├─ Hero.css
│  │  ├─ Hero.preview.ts
│  │  └─ Hero.test.ts
│  └─ Counter/
│     ├─ Counter.manifest.ts
│     └─ Counter.native-ui.ts
├─ assets/
└─ dist/
   ├─ presentation.definition.debug.json
   ├─ presentation.render-bundle.json
   ├─ presentation.delivery-manifest.pb
   └─ generated-assets/
```

JSON output は必須の Authoring source ではなく、debug、export、interop 用の生成物として扱う。

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
- GUI と Code は Semantic Authoring IR を共有する。
- Structured と Opaque Component を区別する。
- Scene Graph は Spatial Tree と Surface Tree からなる 2.5D 構造とする。
- Group は進行スコープ、Scene Graph は空間親子関係とする。
- Surface は physical size と logical size を持つ。
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

### Progression wire / Runtime contract の blocking follow-ups

1. Component Action / Output の canonical Action / semantic event への lowering 規則
2. Structured Component の Component Structure schema と、制限付き DSL の静的解析境界
3. SurfaceNode、Semantic Surface、Render Surface の参照・lowering contract
4. Group scope と presentation scope の resource ownership schema
5. actor、subject、Anchor owner の型と認可規則
6. Step entry epoch、timer deadline、step ごとの Cue 消費状態、Runtime Run の Snapshot schema
7. Action conflict matrix と Runtime fault / Pause の扱い
8. Surface transition の完了、interaction、hit region 有効化の wire 表現
9. Timeline の absolute interpolation、Quaternion、Run lifecycle の wire 表現
10. Shared Runtime State、Role Projection State、Client-local State の境界と projection schema
11. Release、Room、Session、Snapshot の参照整合性と、Draft を active Room へ反映する規則
12. Reliable Event / Snapshot / State Stream の transport schema、保持期間、runtime microstep 上限

### Rendering / Delivery の follow-ups

1. Semantic Surface の state ごとの完全 Semantic Tree と Hit Region schema
2. Native UI portable subset と Runtime Variable / Clock binding
3. Transform 合成、Quaternion 乗算、matrix layout、Unity 変換、Surface / UV 変換の完全な座標規約
4. Component から Surface への分割規則、partition の自動化範囲、author override
5. Texture state artifact 数と GPU / RAM build budget
6. Resolution、mipmap、compression、preload、eviction policy
7. Component Manifest と renderer implementation の drift 検証
8. Compiler、Browser、Font、Locale の再現性
9. DeliveryManifest Protobuf schema、capability negotiation、visual regression test

## 20. 次の設計対象

次は Surface Partition ではなく、Progression wire / Runtime contract の blocking follow-ups を順に閉じる。推奨順序は次のとおりである。

1. Component Action / Output lowering
2. Structured Component と制限付き DSL
3. SurfaceNode / Semantic Surface / Render Surface
4. Group scope と Runtime State の三層
5. actor / Anchor owner
6. Snapshot / Runtime Run
7. Immutable Release
8. Surface transition / Action conflict
9. Timeline interpolation
10. Semantic Tree / Native UI binding
11. Spatial / Surface coordinate convention
12. Surface Partition
13. Texture / GPU / RAM budget

中心となる思想は次のとおりである。

> `.unframe.tsx` は Presentation の composition root、Component Manifest は公開契約、Semantic Authoring IR は GUI と Code の共通モデル、Renderer と DeliveryManifest は build と delivery の結果とする。
