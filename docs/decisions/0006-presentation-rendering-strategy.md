# ADR-0006: プレゼンテーションアーキテクチャを定義する

- **Status**: Accepted
- **Date**: 2026-08-25
- **Deciders**: Unframe 開発チーム
- **関連**: [Presentation Architecture](../presentation/ARCHITECTURE.md), [ADR-0005: 空間プレゼンテーションのドメインモデルを定義する](./0005-spatial-presentation-domain-model.md), [Repository Architecture](../../ARCHITECTURE.md), [Server Architecture](../../app/server/ARCHITECTURE.md)

## Context

Unframe のプレゼンテーションは、コードと GUI による authoring、再利用可能な Component、2D UI と 3D 空間の合成、build、Asset 配信、Unity Runtime、Realtime の進行管理にまたがる。

これらを一つの JSON、TSX、DOM、Unity object graph にまとめると、編集用の抽象、永続化する意味、生成済み artifact、配信情報、実行中状態が混在する。特に、次の要求を同じ形式だけで満たすことは難しい。

- Code では Component と TSX に近い記述を利用する。
- GUI では Layout、配置、State、Flow を意味単位で編集する。
- 最終的な Presentation は検証可能で portable な契約として保存する。
- Web の表現力を利用しながら、Unity では任意の HTML、CSS、JavaScript を実行しない。
- Realtime Session では複数 client が同じ進行状態へ収束する。

ADR-0005 は Group、Step、Cue、Trigger、Action を中心とした空間プレゼンテーションのドメイン境界を定義した。本 ADR ではそれを拡張し、authoring から Runtime までを接続する Presentation 全体の目標アーキテクチャを決定する。

詳細な型、Scene Graph、Surface、Layout、State Machine、Timeline、RenderBundle、DeliveryManifest の仕様は [Presentation Architecture](../presentation/ARCHITECTURE.md) を正本とする。本 ADR は、そのアーキテクチャを採用する理由と主要な境界だけを記録する。

## Decision

[Presentation Architecture](../presentation/ARCHITECTURE.md) に記載する目標アーキテクチャを、Unframe の Presentation 設計の正本として採用する。

### 設計成熟度

この ADR が受理するのは上位アーキテクチャであり、すべての下位 contract を同時に固定するものではない。

| 対象                                           | 状態        |
| ---------------------------------------------- | ----------- |
| Architecture baseline                          | Accepted    |
| Presentation Progression の意味モデル          | v1 baseline |
| Progression wire / runtime schema              | Draft       |
| Authoring、Rendering、Delivery の下位 contract | Follow-up   |

### 基本原則

- Presentation の意味、authoring source、build 成果物、delivery projection、Runtime State を分離する。
- TSX、JSON、Protobuf は用途ごとの表現形式であり、単独で意味モデル全体の正本にはしない。
- PresentationDefinition を renderer-independent な Presentation の意味モデルとする。
- v1 の PresentationDefinition は canonical JSON として build する。
- GUI と Code は同じ Semantic Authoring IR を編集する。
- すべての参照可能な構成要素に安定 ID を割り当て、配列位置や描画順を識別子として使用しない。
- Component の公開契約と renderer implementation を分離する。
- Scene Graph、Presentation Progression、Renderer を独立した関心として扱う。
- Local Compiler は Presentation Orchestrator、Theme Declaration、Component Manifest、Structured Component Structure を parse / typecheck し、検証済み AST から Declaration Graph へ静的に lower する。これらを JavaScript として実行しない。
- Opaque renderer だけを通常の TS / React / CSS として bundle し、renderer artifact を生成する。renderer の Browser 実行は静的 authoring lowering と別の隔離境界とする。
- Control Plane、Venue Edge、Unity Runtime は authoring code を実行しない。
- 現行実装と目標アーキテクチャを区別し、未実装の設計を既存機能として扱わない。

### 契約の階層

Presentation を次の契約へ分離する。

| 契約                   | 責務                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Authoring Source       | Presentation の composition、Component、Theme、Asset 選択を人が記述する                                               |
| Semantic Authoring IR  | GUI と Code が共同編集する正規化モデルと authoring metadata を保持する                                                |
| PresentationDefinition | Scene、Surface、State、Interaction、進行など Presentation の意味を保持し、v1 では canonical JSON として生成する       |
| RenderBundle           | Local Compiler が生成した Texture、Video、Native UI plan、Semantic Tree などを保持する                                |
| DeliveryManifest       | target capability、認可、Asset binding、Signed URL を解決した Runtime projection を保持する                           |
| Published Presentation | 整合する PresentationDefinition、RenderBundle、Asset Set、contract version を現在の公開済み実行物として一つだけ束ねる |
| Runtime State          | Session 中の現在 Group、Step、Node、Surface State、Timeline、playback、presence を保持する                            |

Authoring Source と Semantic Authoring IR は編集のための情報を保持する。PresentationDefinition は実行可能な意味を保持する。RenderBundle と DeliveryManifest は再生成可能な派生物とし、PublishedPresentation はそれらの整合する組み合わせを一つの immutable value に固定する。Runtime State は実行中にだけ存在し、PresentationDefinition へ書き戻さない。

### Authoring と Component

コードによる Presentation は、Component の配置と接続を行う composition root として記述する。Component 内部の Frame、Text、装飾を Presentation 全体へ展開して記述することを標準にはしない。

Component package は Props、Slots、Parts、Variants、States、Actions、Outputs、Theme requirements、対応 renderer、Editor metadata、version を公開契約として持つ。GUI は renderer implementation を解析せず、この公開契約から編集可能範囲を構築する。

Structured Component は Manifest とは別の `*.structure.tsx` を内部構造の正本とし、Component 固有 renderer implementation を持たない。generic renderer が Structure から lower された Primitive graph を描画する。任意 React / CSS renderer が必要な Component は Opaque とし、renderer ごとに Structured / Opaque を切り替えない。Component Action は canonical Action batch、Component Output は明示された canonical event source / Trigger へ compile-time に lower し、Component 固有の実行命令や event name を Runtime contract へ残さない。

Presentation Orchestrator、Theme Declaration、Component Manifest、Structured Component Structure は静的解析可能な制限付き DSL とする。Local Compiler は Lossless Syntax Tree と Source Map を GUI / Code の往復に保持しつつ、import / symbol / 型を解決した AST から Declaration Graph へ直接 lower し、Semantic Authoring IR へ正規化する。GUI は Declaration Graph や renderer artifact を Code へ逆生成しない。

任意コードを許す Opaque renderer は通常の TS / React / CSS として bundle し、renderer artifact へ変換する。Opaque Component の意味情報は静的に lower した Component Manifest から取得し、renderer の実行結果から推測しない。artifact の Browser capability と再現性は Rendering / Delivery contract で管理する。

GUI と Code の双方向変換は、任意のソース文字列を完全に再現することではなく、正規化後の意味論的同値性を保証する。自由な実装が必要な Component と GUI が内部構造まで編集できる Component は区別する。

Component の抽象を超えた編集は Authoring 上で Detach し、Delivery artifact や Texture から編集可能な Component source を復元しない。

### Scene、Surface、Layout

Scene Graph は、空間配置を表す Spatial Tree と、Surface 内の 2D UI を表す Surface Tree から構成する。

Group は物語上の進行スコープであり、Scene Graph の親子関係とは分離する。Spatial Tree は Stage、Anchor、Container、Model、Audio、SurfaceNode などの空間関係を保持する。SurfaceNode と Semantic Surface の組が 3D 空間と 2D UI を接続し、Semantic Surface が物理 size と logical size を持つ。

Runtime resource owner は `presentation` または一つの `group` に限定し、Step scope と Group ごとの ID namespace は作らない。Spatial Node、Timeline、Variable、Zone が owner を直接持ち、Semantic Surface、Interaction、Media、Render Surface は親から継承する。Group の owned-resource list は正本にせず、Compiler / Delivery が owner から activation index を派生生成する。

presentation-owned resource は presentation-owned resource、Group G-owned resource と Group G の Cue は presentation-owned または同じ Group G-owned resource だけを参照できる。ownership は Spatial parent と分離し、group-owned Node は presentation-owned Node を parent にできる。presentation-owned Runtime State と Run は Group をまたいで継続し、group-owned state は exit で破棄して reentry で reset する。Timeline も presentation / group の両 owner を許す。

Surface 内部の Layout は absolute、stack、grid から始め、最終座標だけでなく配置意図を Authoring IR に保持する。Theme は型付き Token と Named Style を持ち、Layout、親子関係、Spatial Transform、Flow を変更しない。

Component は再利用と編集、SurfaceNode は空間配置と animation、Semantic Surface は意味状態と interaction、Render Surface は描画 partition の境界とする。一つの Component が複数 Surface や Native Node へ展開されることを許す。

Surface は、Spatial Tree 上で Transform を所有する SurfaceNode、PresentationDefinition 上で State / Interaction を所有する Semantic Surface、RenderBundle 内部の派生的な Render Surface に分ける。v1 は SurfaceNode と Semantic Surface を 1:1、Semantic Surface と Render Surface を 1:N とする。

canonical Runtime contract の SurfaceId は SemanticSurfaceId を意味する。Node Action と Timeline は SurfaceNode を含む SpatialNodeId、Surface State、Interaction、media Action、Progression は SemanticSurfaceId を参照する。RenderSurfaceId は compiler-derived な build-local ID とし、Trigger、Guard、Action、Snapshot、Reliable Event に含めない。

### Rendering

Semantic Scene Graph を優先し、renderer を Local Compiler と Delivery の出力戦略とする。

3D Model、Shape、Spatial Audio、Transform、Anchor tracking は Unity native で描画する。静的 UI と少数の有限状態 UI は Web で描画して Render Surface 単位に Texture 化する。継続的に変化する限定 UI は portable な Native UI とし、入力非依存の複雑な連続演出は Video とする。

Semantic Surface は具体 renderer ではなく Render Intent を持つ。Concrete renderer と解像度は build 結果と target capability に基づいて RenderBundle と DeliveryManifest で確定する。

Surface State は意味論的な状態として保持し、Texture ID や Unity object を参照しない。Renderer artifact は RenderBundle が Surface State に対応付け、DeliveryManifestはtarget capabilityに応じてRender Surfaceの各到達可能stateへartifactまたは明示的なempty bindingを固定する。

Embedded Browser は v1 の標準 renderer に含めない。Control Plane と Unity Runtime は Authoring Source、React、HTML、CSS、renderer source を実行しない。

### Presentation Progression

Group を State Machine のスコープ、Step を進行状態、Cue を Trigger で発火する遷移候補として扱う。

State Machine は離散的な進行と Surface State を管理し、Timeline は連続値の時間変化を管理する。Action は renderer-independent な意味論的対象を変更し、Texture や Unity API を直接操作しない。

Cloud または Venue Edge に配置された割り当て済み Runtime Core を canonical authority とし、Trigger、Guard、Cue 選択、Action、Timeline 完了、Group / Step 遷移を一意に評価する。Unity は device input を Logical Event へ変換し、確定した Runtime State と Timeline を描画へ反映する。

Reliable Event、State Stream、Snapshot、Replay を分離し、再接続した client が同じ Presentation 進行と Surface State へ収束できるようにする。

Runtime State は、割り当て済み Runtime Core が authority を持つ Shared Runtime State、profile と Shared Runtime State から生成する authority を持たない Participant Runtime View、各 client が authority を持つ Client-local State に分離する。Spatial NodeがProjectionAudienceを宣言し、Semantic Surfaceなどの派生resourceはhostから継承する。ProjectionProfileDescriptorはPublicationFence、projection contract version、role、capability profileごとに共有し、participant / assignment固有のProjectionInstanceと分離する。Client-local State は Shared Progression を直接変更しない。

Presentation は過去の公開版を選択できる履歴を持たず、公開済み実行物を一つだけ保持する。Session は Presentation を参照し、作成時の PublicationFence を固定する。期限内の `Waiting` Session または `Presenting` Session が存在する間は publish を拒否し、Draft 編集と build を実行中 Session へ反映しない。Presentation owner / admin は放置された `Waiting` Session を cancel でき、bounded waiting expiryもpublish判定と同じ永続化境界でlockを解放する。Session 終了後の明示的な publish で現在の PublishedPresentation を atomic に置き換え、次の Session は常にその最新版を使用する。

v1 の具体的な選択規則、Group lifecycle、Surface State、Timeline、Snapshot は [Presentation Progression の意味論](../presentation/ARCHITECTURE.md#12-v1-presentation-progression-の意味論) に従う。

### Component ごとの責務

- **Local Compiler**: Orchestrator、Theme Declaration、Manifest、Structure を parse / typecheck し、検証済み AST から Declaration Graph へ静的に lower して Semantic Authoring IR へ正規化する。Opaque renderer だけを bundle し、Component、Layout、Theme、Surface boundary、canonical PresentationDefinition JSON、renderer artifact を解決する。
- **Control Plane**: PresentationDefinition、RenderBundle、Asset の schema、ownership、hash、revision を検証し、DeliveryManifest を生成する。
- **割り当て済み Runtime Core**: Cloud または Venue Edge に配置され、Session の進行、順序、Trigger、Guard、Action、Timeline、Reliable Event、Snapshot を管理する。
- **Unity Runtime**: DeliveryManifest を検証し、renderer graph、Asset lifecycle、Spatial rendering、local interpolation、input adapter を担当する。
- **Web Editor**: Semantic Authoring IR を semantic command で編集し、保存 revision や Runtime authority と分離した UI state を管理する。

## Alternatives Considered

### Option A: 最終 JSON を Authoring の唯一の正本にする

Runtime には単純だが、Component、Layout intent、Theme、Source mapping、GUI と Code の往復に必要な情報を失う。編集抽象と実行契約を混在させるため採用しない。

### Option B: TSX または React tree を PresentationDefinition として保存する

Web authoring には自然だが、任意コードの実行、安全性、決定性、Unity portability、GUI reverse conversion の境界が成立しないため採用しない。

### Option C: Web、Server、Unity がそれぞれ独自の Presentation model を持つ

各 application は局所的に実装しやすいが、意味、ID、State、Action、Asset の contract drift が発生するため採用しない。共有するのは実装ではなく、明示的な契約と生成 artifact とする。

### Option D: Component、Surface、Scene Node を一つの概念に統合する

再利用、編集、描画、空間 Transform、Runtime resource の lifecycle が結合し、Component の一部だけを別 renderer や別 Surface にすることが難しくなるため採用しない。

### Option E: 各 client が Presentation Progression を個別評価する

Tracking、input、clock、renderer の差によって Cue と State が分岐する。Snapshot と Replay だけでは決定結果を一致させられないため、Cloud または Venue Edge に配置された割り当て済み Runtime Core を唯一の authority とする。

## Consequences

- **Positive**: Code、GUI、build、delivery、runtime を同じ意味モデルの周囲へ整理できる。
- **Positive**: Component の再利用性と Web の表現力を保ちながら、Unity で任意の authoring code を実行せずに済む。
- **Positive**: PresentationDefinition を保ったまま renderer、解像度、配信方法を変更できる。
- **Positive**: Stable ID と Semantic Authoring IR により、GUI と Code の意味論的な往復と semantic command を設計できる。
- **Positive**: TS / TSX の module resolution と type system を利用しながら、authoring declaration を portable な canonical JSON へ固定できる。
- **Positive**: Cloud または Venue Edge に配置された割り当て済み Runtime Core の single authority と Snapshot / Replay により、複数 client の進行状態を収束させられる。
- **Negative**: Authoring Source、IR、PresentationDefinition、RenderBundle、DeliveryManifest の対応と versioning を管理する必要がある。
- **Negative**: Compiler、Component package、Surface partition、Native UI、Delivery、Realtime の複数契約を実装する必要がある。
- **Negative**: 自由な TSX と完全な GUI 内部編集を同時には保証できず、Structured / Opaque / Detach の境界が必要になる。
- **Negative**: Static Authoring DSL は通常の TypeScript より表現力を制限し、Compiler が許可構文、symbol resolution、AST lowering、source patching を contract として管理する必要がある。
- **Negative**: Opaque renderer は任意コードを含められるため、Browser capability、module resolution、cache invalidation、決定性を renderer contract として管理する必要がある。
- **Negative**: Baked Surface は内容や locale の変更で再 build が必要になり、Texture memory と Asset lifecycle の管理も必要になる。
- **Neutral**: 詳細な schema、transport、build budget、capability negotiation は下位仕様として段階的に決定する。

## Implementation Status

この ADR は目標アーキテクチャを採用するものであり、すべてが現行コードへ実装済みであることを意味しない。

2026-08-28 時点では、現行 Control Plane の PresentationDefinition は ADR-0005 の Group、Step、Cue、Element を中心とした JSON / OpenAPI 契約である。Target の Spatial Tree / Surface Tree と baked-web RenderBundle は、Zod 4 source、生成 JSON Schema、初期 semantic Core、Authoring / Component / Renderer API / Assets、post-lowering Compiler、Structured renderer、Opaque source の Rolldown bundle、headless CLI と Bun / OpenTUI shell まで実装済みである。一方、Authoring TS / TSX は構文解析まで、Opaque renderer は bundle まで、TUI は command selection までであり、実 Browser execution / capture とは未接続である。完全版contract、DeliveryManifest、hybrid renderer、v1 Presentation Progression の wire / runtime schema は target design であり、完成した production contract ではない。

この ADR だけで既存 schema を置き換えたとはみなさない。実装時は契約変更、migration、OpenAPI / Protobuf artifact、Web / Unity / Realtime consumer、contract test を同期する。

## Follow-ups

- [x] Component Action / Output の canonical Action / event source への lowering contract を [Presentation Architecture](../presentation/ARCHITECTURE.md#55-component-action--output-lowering) で定義する。
- [x] Structured Component の宣言的な内部構造と renderer implementation の source boundary を [Presentation Architecture](../presentation/ARCHITECTURE.md#52-structured-component-source-boundary) で定義する。
- [x] Static Authoring DSL、AST lowering、Declaration Graph normalization、semantic round-trip、source mapping を [Presentation Architecture](../presentation/ARCHITECTURE.md#6-authoring-compiler-と-gui--code-round-trip)、Detach を [Component Instance と Detach](../presentation/ARCHITECTURE.md#54-component-instance-と-detach) で定義する。
- [x] SurfaceNode、Semantic Surface、Render Surface の canonical identity、cardinality、lowering、Runtime 参照規則を [Presentation Architecture](../presentation/ARCHITECTURE.md#75-render-surface-lowering-と-runtime-参照) で定義する。
- [x] Group scope / presentation scope の resource owner、参照方向、lifecycle、Runtime State 保持規則を [Presentation Architecture](../presentation/ARCHITECTURE.md#71-group) で定義する。
- [x] Presenter / System / participant の actor、subject、Anchor owner と認可規則を [Presentation Architecture](../presentation/ARCHITECTURE.md#125-runtime-input-event-と-trigger) で定義する。
- [x] Shared Runtime State、Participant Runtime View、Client-local State の authority、producer、profile / instance、projection schema を [Presentation Architecture](../presentation/ARCHITECTURE.md#37-runtime-state) で定義する。
- [x] Step entry、Timer、Cue consumption、Surface transition、Timeline、Media を復元できる Runtime Run、pause-aware logical clock、Canonical Runtime Snapshot、Connection / Durable envelope contract を [Presentation Architecture](../presentation/ARCHITECTURE.md#123-runtime-progression-state) と [Snapshot contract](../presentation/ARCHITECTURE.md#1211-reliable-eventstate-streamsnapshot) で定義する。
- [x] 単一の PublishedPresentation、PublicationFence、PresentationDefinition / RenderBundle / Asset Set / contract version の原子的な整合性、Session と PublicationFence の参照、Waiting Session の owner cancel / bounded expiry、非終了 Session 中の publish lock、置換後artifactのGCを [Presentation Architecture](../presentation/ARCHITECTURE.md#36-published-presentation-と-active-use-lock) で定義する。
- [x] Surface transition、Action batch、active Timeline Run の conflict policy と Timeline の補間・停止規則を [Surface State](../presentation/ARCHITECTURE.md#124-surface-state)、[Action](../presentation/ARCHITECTURE.md#127-action)、[Timeline](../presentation/ARCHITECTURE.md#128-timeline) で定義する。
- [x] Surface State ごとの完成 Semantic Tree、Hit Region 整合、Native UI v1 subset、text binding、font asset、projection Variable / Clock 規則を [Presentation Architecture](../presentation/ARCHITECTURE.md#132-semantic-tree)、[Native UI Artifact](../presentation/ARCHITECTURE.md#143-native-ui-artifact)、[DeliveryManifest](../presentation/ARCHITECTURE.md#35-deliverymanifest) で定義する。
- [x] Surface transition の開始・完了、Surface interaction input / outcome、Interaction / Hit Region 有効化の wire contract を [Presentation Architecture](../presentation/ARCHITECTURE.md#surface-transition--interaction-wire-contract) で定義する。
- [x] ComponentからRender Surfaceへのpartition規則、自動化範囲、author overrideを [ADR-0011](0011-surface-partition-contract.md) で定義する。
- [x] ADR-0005の基礎座標系を前提に、Transform / matrix / Quaternion / Unity / Surface / UVの完全な規約を [ADR-0010](0010-spatial-surface-coordinate-contract.md) で定義する。
- [ ] SurfaceRenderIntent、Surface State、RenderBundle、DeliveryManifest の schema と versioning を定義する。
- [x] Texture build budget、resolution、mipmap、compression、preload、eviction policyを [ADR-0012](0012-texture-budget-residency-contract.md) で定義する。
- [x] role 別 Semantic schema と Hit Region の完全なschemaを [ADR-0009](0009-semantic-tree-hit-region-contract.md) で定義する。
- [ ] Opaque renderer の Browser capability、module resolution、cache invalidation と Component / renderer drift 検証を設計する。
- [ ] DeliveryManifest Protobuf schema と capability negotiation を定義する。
- [ ] v1 Presentation Progression の意味論を Progression wire / Runtime contract、Realtime protocol、Snapshot、consumer へ落とし込む。
- [ ] Web、Compiler、Unity、Realtime の contract test と visual regression test を設計する。
