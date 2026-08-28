# Presentation Core Architecture

- **Status**: Initial first-milestone implementation
- **Scope**: Runtime-neutral な Presentation semantic model、validation、canonicalization
- **Related**:
  - [Presentation Architecture](../../docs/presentation/ARCHITECTURE.md)
  - [Presentation Implementation Design](../../docs/presentation/DESIGN.md)
  - [Contracts Architecture](../contracts/ARCHITECTURE.md)

## 1. Role

現在の公開helperには`materializeCompletedSemanticTree`を含む。rendererとCompilerの
orchestrationはこのpackageの責務外である。

`presentation-core` は Presentation の pure TypeScript semantic core である。portable contract から導出した in-memory model と、構造 schema だけでは表せない invariant を所有する。

Web、Compiler、Control Plane が同じ意味を利用できるようにするが、Browser、Node.js、Cloudflare Workers、React、filesystem、network の runtime object は持ち込まない。Go Realtime と Unity C# はこの実装を共有せず、generated contract と conformance fixture を介して意味を一致させる。

## 2. Owned model

### Current first milestone

- generated contractから導出したPresentationDefinition / RenderBundle model
- Stage、SurfaceNode、Frame / Text、Surface State、baked-web artifactのsemantic invariant
- stable diagnostic codeとsemantic path
- Presentation固有の意味上のset正規化、RFC 8785 canonical JSON、SHA-256 content hash

### Target extensions

- Stable ID、Scalar、typed reference、Transform などの value
- Semantic Authoring IR の normalized data model
- Spatial Node、SurfaceNode、SemanticSurface、RenderSurface の identity と参照
- ResourceOwner、lifetime、Group activation の規則
- RuntimeActor、RuntimeSubject、TriggerActorSelector、Anchor owner
- ProjectionAudience、ProjectionProfile、ProjectionInstance、ParticipantRuntimeView
- pause-aware logical clock、StepExecutionSnapshot、RuntimeRunSnapshot、CanonicalRuntimeSnapshot
- schema version に対応する pure migration

Semantic Authoring IR と PresentationDefinition は同じものではない。前者は編集情報と Source Map 対応を保持し、後者は renderer-independent な実行意味だけを保持する。

## 3. Internal boundaries

将来の拡張では次の関心を分離する。

```text
src/
├─ values/             # IDs, scalar, references, transforms
├─ authoring/          # normalized Semantic Authoring IR model
├─ definition/         # PresentationDefinition semantic model
├─ render-bundle/      # build metadata model
├─ runtime/            # runtime-neutral snapshot/view values
├─ validation/         # reference and semantic invariants
├─ canonicalization/   # stable ordering, serialization, hashing
└─ migration/          # versioned pure migrations
```

初期実装は、Stage、SurfaceNode、Frame / Text、Surface State、baked-web RenderBundle subsetのsemantic validation、canonical JSON、SHA-256 hashだけを実装する。canonicalizationは独立moduleへ分離し、Presentation固有の意味上のset正規化後に`canonicalize`でRFC 8785 JSONへ直列化する。その他の責務も増えた段階でこの境界へ分割する。

## 4. Public API

初期実装は `validatePresentationDefinition`、`validateRenderBundle`、`validatePresentationArtifacts`、`canonicalizePresentationDefinition`、`canonicalizeRenderBundle`、`hashPresentationDefinition`、`hashRenderBundle` を公開する。入力型は`@unframe/contracts/presentation`のZod schemaから推論した型を正本とし、Core内でserialized modelを再定義しない。

Compiler、renderer、asset transformer の read boundary には、この生成型から導出した read-only の `SemanticSurface`、`SurfaceRenderIntent`、`SurfaceContentNode`、`CompletedSemanticTree`、`HitRegion`、`TextureArtifact` を公開する。これらは別の normalized model ではなく、構造・意味検証を通過した current serialized subset を mutation せず参照するための alias である。

すべてのAPIは`ValidationResult<T>`を返す。失敗はthrowせず、stable diagnostic code、semantic path、必要ならrelated pathを返す。semantic pathはIDに`/`を含む場合も一つのsegmentとして保持する。

公開validation APIは、descriptor-safeなplain JSON snapshotを作成した後、`packages/contracts`が正本として公開するZod 4 schemaで構造を検証する。Zodへcaller-owned objectを直接渡さないため、accessor、sparse array、symbol、cycle、非plain prototypeを実行時データへ混入させない。構造検証済みの値に対して、Coreは参照、cardinality、tree、lifetime、cross-artifact整合などのsemantic invariantだけを検証する。JSON parse、I/O、renderer、transport adapterは公開しない。

## 5. Invariants

初期実装は、Record keyとID、Spatial / content / semantic tree、Surfaceの1:1関係、Group ownerとSpatial parent lifetime、State / Interaction / override、DefinitionとRenderBundleのsurface / state / semantic tree / hit region対応を検証する。canonicalizationはRecord挿入順に依存せず、意味上のsetだけをsortし、semantic overrideのlayer順を保持する。

次はtarget全体でCoreが所有するinvariantである。初期schemaにまだ存在しないmodelの検証は未実装である。

- SurfaceNode と SemanticSurface は v1 で 1:1、SemanticSurface と RenderSurface は 1:N とする。
- Runtime contract の Surface ID は SemanticSurfaceId とし、RenderSurfaceId を progression に含めない。
- Resource owner は `presentation` または一つの `group` に限定する。
- reference は同じか長い lifetime の resource へだけ向ける。
- ProjectionAudience は host Spatial Node から派生 resource へ継承し、profile ごとの visibility closure が参照 closure を満たす。
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

`presentation-core` は generated TypeScript presentation contract 以外の presentation package に依存しない。runtime構造検証は`packages/contracts`のZod 4 schemaへ委譲し、Core内に同じ構造schemaを再定義しない。RFC 8785直列化には`canonicalize`、content hashには`@noble/hashes`を用いる。Authoring、Compiler、Renderer、CLI から Core へ依存する逆向きだけを許可する。

## 8. Validation strategy

- portable fixtureに対するvalid / invalid semantic test
- Zod contract schemaのissue pathとstable diagnosticの対応test
- accessorを実行しないdescriptor snapshotとstrict contract fieldの境界test
- ID、reference、lifetime、cardinality、tree、override、hit regionの境界test
- object insertion orderとdiagnostic順序の決定性test
- canonical number serializationとSHA-256のgolden test
- production sourceがNode.js専用APIへ依存しないことのtest

property test、migration fixture、Go / C# consumerとのsemantic conformanceは対象contractの実装時に追加する。

## 9. Deferred decisions

- Cue / Trigger / Guard / Action、Timeline、Native UI、Video artifactのsemantic validation
- Spatial parent以外のResource lifetimeとProjectionAudienceの参照閉包
- data constructor、normalize、pure migration API
- migration support window
