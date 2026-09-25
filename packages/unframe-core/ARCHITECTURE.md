# Presentation Core Architecture

- **Status**: Presentation v2 M3C Cue validation and pure immediate-action execution
- **Scope**: Runtime-neutral な Presentation semantic model、validation、canonicalization
- **Related**:
  - [Presentation Architecture](../../docs/packages/ARCHITECTURE.md)
  - [Presentation Implementation Design](../../docs/packages/DESIGN.md)
  - [Contracts Architecture](../contracts/ARCHITECTURE.md)
  - [M3A Structured Authoring Contract](../../docs/packages/AUTHORING_CONTRACT.md)

## 1. Role

現在の公開helperには`materializeCompletedSemanticTree`を含む。rendererとCompilerの
orchestrationはこのpackageの責務外である。

`unframe-core` は Presentation の pure TypeScript semantic core である。portable contract から導出した in-memory model と、構造 schema だけでは表せない invariant を所有する。

Web、Compiler、Control Plane が同じ意味を利用できるようにするが、Browser、Node.js、Cloudflare Workers、React、filesystem、network の runtime object は持ち込まない。Go Realtime と Unity C# はこの実装を共有せず、generated contract と conformance fixture を介して意味を一致させる。

## 2. Owned model

### Current first milestone

- generated contractから導出したPresentationDefinition / RenderBundle model
- Stage、SurfaceNode、Frame / Text、Surface State、baked-web artifactのsemantic invariant
- stable diagnostic codeとsemantic path
- 配列順を保持するRFC 8785 canonical JSON、SHA-256 content hash

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
├─ index.ts            # reviewed public exports only
├─ values/             # IDs, scalar, references, transforms
├─ authoring/          # normalized Semantic Authoring IR model
├─ definition/         # PresentationDefinition semantic model
├─ render-bundle/      # build metadata model
├─ runtime/            # runtime-neutral snapshot/view values
├─ validation/         # reference and semantic invariants
├─ canonicalization/   # stable ordering, serialization, hashing
└─ migration/          # versioned pure migrations
```

`index.ts` は public export の集約だけを担う。型、contract schema boundary、semantic validation、canonicalization は変更理由の異なる責務として owning model の近くへ分離し、単一の entrypoint や package 共通の巨大な `types.ts` に集約しない。小さな value object は型と constructor を同じ module に置いてよく、実装前に空 directory を作る必要はない。

現在の実装は、Stage、SurfaceNode、Frame / Text、Surface State、Cue / Guard / 即時 Action、baked-web RenderBundle
subsetのsemantic validation、純粋な Cue 実行、Semantic Tree materialization、canonical JSON、SHA-256 hashを実装する。
canonicalizationは配列を並べ替えず、契約上の順序を保持してRFC 8785 JSONへ直列化する。

## 4. Public API

`validatePresentationDefinition`、`validateRenderBundle`、`validatePresentationArtifacts`、
`canonicalizePresentationDefinition`、`canonicalizeRenderBundle`、`hashPresentationDefinition`、
`hashRenderBundle`を公開する。入力型は`@unframe/contracts/presentation/v2`のZod schemaから
推論した型を正本とし、Core内でserialized modelを再定義しない。v1入力の受理・変換経路は持たない。

`createCueState`、`executeCueEvent`、`advanceCueClock`は検証済みDefinitionと明示的な入力・論理時刻を受ける純粋なM3C実行器である。Cueの選択、Guard、即時Action batch、Step / Group entry、消費、cooldown、timerを扱う。認証、接続、永続化、Runtime Run、projectionは呼び出し側または後続段階の責務とする。

Compiler、renderer、asset transformer の read boundary には、この生成型から導出した read-only の `SemanticSurface`、`SurfaceRenderIntent`、`SurfaceContentNode`、`CompletedSemanticTree`、`HitRegion`、`TextureArtifact` を公開する。これらは別の normalized model ではなく、構造・意味検証を通過した current serialized subset を mutation せず参照するための alias である。

上記の validation / canonicalization / hash APIは`ValidationResult<T>`を返す。失敗はthrowせず、stable diagnostic code、semantic path、必要ならrelated pathを返す。semantic pathはIDに`/`を含む場合も一つのsegmentとして保持する。低水準の`canonicalizeJsonPayload`と`hashCanonicalJsonPayload`は文字列を直接返し、不正なplain JSON入力でthrowし得るため、trust boundaryでは先にvalidation APIを通す。

公開validation APIは、descriptor-safeなplain JSON snapshotを作成した後、`packages/contracts`が正本として公開するZod 4 schemaで構造を検証する。Zodへcaller-owned objectを直接渡さないため、accessor、sparse array、symbol、cycle、非plain prototypeを実行時データへ混入させない。構造検証済みの値に対して、Coreは参照、cardinality、tree、lifetime、cross-artifact整合などのsemantic invariantだけを検証する。JSON parse、I/O、renderer、transport adapterは公開しない。

## 5. Invariants

現在の実装は、Record keyとID、Spatial / content / semantic tree、Surfaceの1:1関係、
Group ownerとSpatial parent、Stateのcontent / semantic override、click Interaction、
DefinitionとRenderBundleのsurface / state / Completed Semantic Tree対応を検証する。
Hit Regionのbounds、priority、canonical order、enabled buttonとの整合、全Stateのbindingと
texture policy予算も検証する。M3CではCueの参照・型・owner・actor・payload・Action競合を検証し、Surfaceのcut、Variable、Nodeの即時Actionだけを実行する。Timeline / Run、crossfade、Media、Modelに依存する操作は`feature.unsupported`で拒否する。

次はtarget全体でCoreが所有するinvariantである。初期schemaにまだ存在しないmodelの検証は未実装である。

- SurfaceNode と SemanticSurface は 1:1、SemanticSurface と RenderSurface は 1:N とする。
- Runtime contract の Surface ID は SemanticSurfaceId とし、RenderSurfaceId を progression に含めない。
- Resource owner は `presentation` または一つの `group` に限定する。
- reference は同じか長い lifetime の resource へだけ向ける。
- ProjectionAudience は host Spatial Node から派生 resource へ継承し、profile ごとの visibility closure が参照 closure を満たす。
- actor、subject、Anchor owner は canonical identity と resource ownership に従い、client payload から任意値として受理しない。
- Component Action / Output は Runtime model に残さず、canonical Action / Trigger へ lower 済みとする。
- v2 のJCS hashはobject insertion orderに依存せず、配列順を保持する。
- CanonicalRuntimeSnapshot は renderer、participant、connection、transport から独立させる。

## 6. Non-responsibilities

- TSX / JSX runtime、TypeScript compiler API、module resolution
- Lossless Syntax Tree と source patching
- filesystem、cache、network、process environment
- Browser capture、texture / video encoding
- Font binaryの解決、読込、subset生成。Coreは`fontAssetId`参照をAssetSet closureで検証する
- renderer plugin orchestration
- progression の authoritative evaluation
- D1、R2、HTTP、gRPC、Unity object

## 7. Dependency rules

`unframe-core` は generated TypeScript presentation contract 以外の presentation package に依存しない。runtime構造検証は`packages/contracts`のZod 4 schemaへ委譲し、Core内に同じ構造schemaを再定義しない。RFC 8785直列化には`canonicalize`、content hashには`@noble/hashes`を用いる。Authoring、Compiler、Renderer、CLI から Core へ依存する逆向きだけを許可する。

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

- Cue / Trigger / Guard / Action、Timeline、Native UI、Video、Model artifactのsemantic validation
- Spatial parent以外のResource lifetimeとProjectionAudienceの参照閉包
- data constructor、normalize、pure migration API
- migration support window
- Structured AuthoringのTheme、Props、Slots、Parts、Variants解決。Coreは解決済みv2成果物だけを検証する

## 10. v2 公開物の整合性検証

`verifyBuildIntegrityV2` は、公開前の `definition`、`renderBundle`、`assetSet`、
`buildManifest` を受け取り、`ValidationResult<BuildArtifactsV2>` を返す。
公開 epoch や `publishedPresentation` は要求せず、入力に含まれる場合は拒否する。
素材参照・descriptor・モデル参照・成果物 hash・presentation ID の検証を公開物の入口と共有する。

`verifyPublicationIntegrityV2` は、`definition`、`renderBundle`、`assetSet`、`buildManifest`、
`publishedPresentation` をまとめて受け取り、`ValidationResult<PublicationArtifactsV2>` を返す。
型は `@unframe/contracts/presentation/v2` を正本とする。

この入口は安全な plain JSON snapshot、v2 構造、素材の参照集合と descriptor、モデル・clip 参照、
成果物間の hash と公開 manifest の一致を検証する。入力を変更せず、JCS hash では配列順を保持する。

入力はデコード済みの値である。raw JSON の重複 key 検出はデコードする adapter が担当する。
成功は公開権限、epoch の更新可否、素材バイトの形式、端末への配信可否を保証しない。
この入口はhash closureを対象とし、通常validation入口が拒否する未実装の構造も受理し得る。
Scene / Flow / State の完全な意味検証やCompilerによるv2成果物生成の実装状況は、各packageで別途記述する。
