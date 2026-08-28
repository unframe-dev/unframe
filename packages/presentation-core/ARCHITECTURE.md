# Presentation Core Architecture

- **Status**: Proposal / Target, not implemented
- **Scope**: Runtime-neutral な Presentation semantic model、validation、canonicalization
- **Related**:
  - [Presentation Architecture](../../docs/presentation/ARCHITECTURE.md)
  - [Presentation Implementation Design](../../docs/presentation/DESIGN.md)
  - [Contracts Architecture](../contracts/ARCHITECTURE.md)

## 1. Role

`presentation-core` は Presentation の pure TypeScript semantic core である。portable contract から導出した in-memory model と、構造 schema だけでは表せない invariant を所有する。

Web、Compiler、Control Plane が同じ意味を利用できるようにするが、Browser、Node.js、Cloudflare Workers、React、filesystem、network の runtime object は持ち込まない。Go Realtime と Unity C# はこの実装を共有せず、generated contract と conformance fixture を介して意味を一致させる。

## 2. Owned model

- Stable ID、Scalar、typed reference、Transform などの value
- Semantic Authoring IR の normalized data model
- contract-derived PresentationDefinition semantic model
- contract-derived RenderBundle build metadata model
- Spatial Node、SurfaceNode、SemanticSurface、RenderSurface の identity と参照
- ResourceOwner、lifetime、Group activation の規則
- RuntimeActor、RuntimeSubject、TriggerActorSelector、Anchor owner
- ProjectionAudience、ProjectionProfile、ProjectionInstance、ParticipantRuntimeView
- pause-aware logical clock、StepExecutionSnapshot、RuntimeRunSnapshot、CanonicalRuntimeSnapshot
- schema version に対応する pure migration

Semantic Authoring IR と PresentationDefinition は同じものではない。前者は編集情報と Source Map 対応を保持し、後者は renderer-independent な実行意味だけを保持する。

## 3. Internal boundaries

実装時は少なくとも次の関心を module boundary として分離する。package の public entrypoint は `src/index.ts` に集約してよいが、これは export surface の集約であって、型、schema、validation、canonicalization の実装を一つのファイルへ集約する方針ではない。

```text
src/
├─ index.ts                  # reviewed public exports only
├─ values/                   # IDs, scalar, references, transforms
├─ authoring/                # normalized Semantic Authoring IR model
├─ definition/               # PresentationDefinition semantic model
├─ render-bundle/            # build metadata model
├─ runtime/                  # runtime-neutral snapshot/view values
├─ validation/               # reference and semantic invariants
├─ canonicalization/         # stable ordering, serialization, hashing
└─ migration/                # versioned pure migrations
```

各責務では data type、runtime schema、validator を同じ global `types.ts` に集約しない。型だけで循環を作らず独立して読める場合は責務内の `types.ts`、serialized input を parse する場合は責務内の `schema.ts`、複数 invariant を持つ場合は `validation.ts` のように分離し、対象 model の近くへ配置する。小さな value object は型と constructor を同じ module に置いてよい。

この layout は ownership の提案であり、実装前に空 directory を作ることを要求しない。一方、最初の実装時点ですでに contract-derived type、semantic invariant、canonical serialization という別責務が存在するなら、ファイル数の少なさを理由に単一 `index.ts` へ同居させない。

## 4. Public API

公開 API は data constructor、validator、canonicalizer、diagnostic、pure migration に限定する。具体的な parse、I/O、renderer、transport adapter は公開しない。

Validation は boolean だけでなく、stable diagnostic code、semantic path、必要なら source correlation key を返す。PresentationDefinition を受け取る consumer が同じ invariant を再実装しないための API とする。

## 5. Invariants

- SurfaceNode と SemanticSurface は v1 で 1:1、SemanticSurface と RenderSurface は 1:N とする。
- Runtime contract の Surface ID は SemanticSurfaceId とし、RenderSurfaceId を progression に含めない。
- Resource owner は `presentation` または一つの `group` に限定する。
- reference は同じか長い lifetime の resource へだけ向ける。
- ProjectionAudience は Spatial Node と Timeline が直接持ち、host Spatial Node から派生 resource へ継承する。Timeline target は同じ audience に限定し、profile ごとの visibility closure が参照 closure を満たす。
- Semantic Surface は canonical Surface Tree と Media timing を保持し、renderer artifact metadata を semantic authority にしない。
- actor、subject、Anchor owner は canonical identity と resource ownership に従い、client payload から任意値として受理しない。
- Component Action / Output は Runtime model に残さず、canonical Action / Trigger へ lower 済みとする。
- canonicalization は入力順、object insertion order、renderer の描画順に依存しない。
- CanonicalRuntimeSnapshot は renderer、participant、connection、transport から独立させる。

## 6. Non-responsibilities

- TSX / JSX runtime、TypeScript compiler API、module resolution
- Lossless Syntax Tree と source patching
- filesystem、cache、network、process environment
- Browser capture、texture / video encoding
- renderer plugin orchestration
- progression の authoritative evaluation
- D1、R2、HTTP、gRPC、Unity object

## 7. Dependency rules

`presentation-core` は generated TypeScript presentation contract 以外の presentation package に依存しない。Authoring、Compiler、Renderer、CLI から Core へ依存する逆向きだけを許可する。

## 8. Validation strategy

- serialized contract の構造 parse は `packages/contracts` が所有する schema source またはそこから生成した validator を正本とし、`presentation-core` に重複 schema を手書きしない。
- TypeScript の runtime schema library は trust boundary の parser 実装として利用できるが、その library 固有 schema を cross-language contract の正本にしない。採用する場合は generated contract、bundle size、Node.js / Browser / Workers 対応、diagnostic path の要件を package 実装時に検証する。
- reference closure、resource lifetime、audience、cross-field cardinality、canonical ordering など構造 schema だけでは表せない invariant は pure validator として実装する。
- ID uniqueness、reference、lifetime、cardinality の property test
- valid / invalid portable fixture
- canonical serialization と hash の golden test
- pure migration の before / after fixture
- Go / C# consumer と共有する semantic conformance fixture
- Node.js と Browser の両方で runtime-specific global に依存しないことの検証

## 9. Deferred decisions

- presentation schema source と TypeScript model の生成方式
- runtime schema library の選定と generated validator との接続方式
- diagnostic path / code の完全な形式
- canonical JSON algorithm と hash algorithm
- migration support window
