# Presentation Compiler Architecture

- **Status**: Proposal / Target, not implemented
- **Scope**: Authoring Project から canonical PresentationDefinition と RenderBundle を生成する library
- **Related**:
  - [Presentation Architecture](../../docs/presentation/ARCHITECTURE.md)
  - [Presentation Implementation Design](../../docs/presentation/DESIGN.md)
  - [Presentation Authoring Architecture](../presentation-authoring/ARCHITECTURE.md)
  - [Renderer API Architecture](../presentation-renderer-api/ARCHITECTURE.md)

## 1. Role

`presentation-compiler` は programmatic Local Compiler pipeline を所有する。Authoring Source を静的に解析し、Declaration Graph と Semantic Authoring IR を経由して、renderer-independent な canonical PresentationDefinition JSON と immutable RenderBundle を生成する。

CLI command parsing、concrete renderer implementation、publish は所有しない。Compiler は orchestration library であり、concrete renderer は host から plugin として注入する。

## 2. Pipeline

```text
Authoring Source / lock / config
        ↓ parse
Lossless Syntax Tree + Source Map
        ↓ import / symbol resolution / typecheck
validated AST
        ↓ context-specific static lowering
Declaration Graph
        ↓ normalize / validate
Semantic Authoring IR
        ↓ component / theme / layout / surface resolution
PresentationDefinition semantic model
        ↓ renderer selection and plugin orchestration
RenderBundle candidates + Asset Set
        ↓ canonicalize
presentation.definition.json + RenderBundle
```

Orchestrator、Theme、Manifest、Structure は実行せず、検証済み AST から lower する。通常の TS / React / CSS として bundle / execute できるのは Opaque renderer source に限る。

## 3. Internal boundaries

```text
src/
├─ project/          # explicit project inputs and lock verification
├─ syntax/           # parse, lossless tree, source map
├─ resolution/       # module, symbol, typecheck
├─ lowering/         # AST to Declaration Graph
├─ normalization/    # Declaration Graph to Semantic Authoring IR
├─ expansion/        # components, slots, variants, themes
├─ surfaces/         # Semantic to Render Surface lowering
├─ rendering/        # selection and plugin orchestration
├─ cache/            # content-addressed build cache
├─ diagnostics/      # stable compiler diagnostics
└─ api/              # compile / check programmatic entrypoints
```

これは ownership の提案であり、pass の完全な分割や実装順を固定しない。

## 4. Public API

- `check`: parse、type、contract、semantic validation を行い artifact を確定しない
- `compile`: explicit project input と renderer registry から immutable build result を返す
- diagnostics: stable code、severity、semantic path、source range
- build metadata: source、lock、config、Compiler、renderer environment の hash / provenance

Programmatic API は command line、stdout、process exit、global current directory に依存しない。

## 5. Invariants

- static lowering の入力は Source、locked package、Theme、Asset metadata、Compiler configuration に限定する。
- 同じ明示入力と toolchain version から同じ Declaration Graph と canonical PresentationDefinition を生成する。
- Orchestrator、Theme、Manifest、Structure を transpile、bundle、実行せず、Authoring JS を build artifact として生成しない。
- Component Action / Output を canonical Action / Trigger へ完全に lower する。
- SemanticSurface と RenderSurface の mapping、resource lifetime、projection audience、State artifact closure を検証する。
- Surface transition、Semantic Tree / Hit Region、Opaque renderer binding が全 reachable State で完全かつ整合することを検証する。
- PresentationDefinition と RenderBundle の source / definition hash を一致させる。
- Browser execution と OS codec は adapter boundary の外へ漏らさない。

## 6. Non-responsibilities

- user-facing command parsing と dev server UX
- Control Plane publish、Asset upload、durable Publication state
- concrete renderer と codec implementation
- Web Editor UI
- authoritative Runtime progression evaluation

## 7. Dependency rules

`presentation-compiler` は `presentation-core`、`presentation-authoring`、`presentation-renderer-api`、`presentation-assets` に依存する。Concrete renderer への hard dependency を禁止し、renderer registry / plugin を host から受け取る。

Compiler は CLI、Web Editor、Control Plane、Realtime、Unity に依存しない。

## 8. Validation strategy

- Explore → Red → Green で compiler pass ごとの fixture を追加する
- AST lowering と forbidden syntax の fixture
- Declaration Graph normalization の golden test
- Semantic Authoring IR / PresentationDefinition の valid / invalid fixture
- canonical JSON と cache key の determinism test
- renderer plugin fake を使った orchestration test
- package lock / source / config / toolchain drift test
- reference Authoring Project の end-to-end build

## 9. Deferred decisions

- TypeScript parse / lossless tree implementation
- plugin discovery と version negotiation
- Surface partition algorithm と author override
- cache layout と remote cache policy
- Browser process / isolate topology
- diagnostics の stability policy
