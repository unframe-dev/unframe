# Presentation Compiler Architecture

- **Status**: Initial implementation
- **Scope**: Authoring Project から canonical PresentationDefinition と RenderBundle を生成する library
- **Related**:
  - [Presentation Architecture](../../docs/presentation/ARCHITECTURE.md)
  - [Presentation Implementation Design](../../docs/presentation/DESIGN.md)
  - [Presentation Authoring Architecture](../presentation-authoring/ARCHITECTURE.md)
  - [Renderer API Architecture](../presentation-renderer-api/ARCHITECTURE.md)

## 1. Role

`presentation-compiler` は programmatic Local Compiler pipeline を所有する。現在は post-lowering の plain-data `PresentationDeclaration` を検査し、Static Structured Surface subset を canonical `PresentationDefinition` JSON に lower する。

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

## 4. Current implementation

`checkDeclarationProject(unknown)` は input を安全に JSON plain-data として検査し、Theme、Component manifest/structure/lock、Spatial instance、Asset reference を解決する。実装済み subset は Structured `Surface → Frame → direct Text`、静的・非対話・baked-web のみである。結果には Core canonical JSON、source hash、definition hash を含む。

`compileDeclarationProject(unknown, options)` は同じ subset を一つの全 Surface RenderSurface に展開し、全 State の完成 Semantic Tree を Core で materialize する。注入された `baked-web` Renderer の raw RGBA capture を `presentation-assets` で決定論的な PNG に encode し、Core で検証済みの canonical RenderBundle と asset bytes を返す。Renderer / encoder / malformed input の失敗は diagnostics として返す。

Renderer registry は `baked-web` ID がちょうど一つに解決されることを要求する。Bundle identity と renderer build context は source / Definition、Compiler identity、明示 build context、Renderer fingerprint、PNG encoder identity を入力に含める。Host は `baseEnvironmentHash` として Compiler host の基礎環境を渡し、Compiler は Renderer / encoder identity を結合した `environmentHash` を RenderBundle に固定する。

TS/TSX parser、AST lowering、cache、CLI は未実装である。

## 5. Public API

- `checkDeclarationProject`: post-lowering declaration の限定 subset を検査し Definition を返す。Renderer は実行しない
- `compileDeclarationProject`: 明示された build context、Renderer plugin、encoder limits から Definition、RenderBundle、PNG asset bytes を返す
- diagnostics: stable code、severity、semantic path、source range
- build metadata: source、lock、config、Compiler、renderer environment の hash / provenance

Programmatic API は command line、stdout、process exit、global current directory に依存しない。

## 6. Invariants

以下は target pipeline 全体の invariant である。現在の初期 subset は Component Action / Output、Interaction、Timeline、Opaque renderer を lower せず、入力で明示的に拒否する。

- static lowering の入力は Source、locked package、Theme、Asset metadata、Compiler configuration に限定する。
- 同じ明示入力と toolchain version から同じ Declaration Graph と canonical PresentationDefinition を生成する。
- Orchestrator、Theme、Manifest、Structure を transpile、bundle、実行せず、Authoring JS を build artifact として生成しない。
- Component Action / Output を canonical Action / Trigger へ完全に lower する。
- SemanticSurface と RenderSurface の mapping、resource lifetime、projection audience、State artifact closure を検証する。
- Surface transition、Semantic Tree / Hit Region、Opaque renderer binding が全 reachable State で完全かつ整合することを検証する。
- PresentationDefinition と RenderBundle の source / definition hash を一致させる。
- Browser execution と OS codec は adapter boundary の外へ漏らさない。

## 7. Non-responsibilities

- user-facing command parsing と dev server UX
- Control Plane publish、Asset upload、durable Publication state
- concrete renderer と codec implementation
- Web Editor UI
- authoritative Runtime progression evaluation

## 8. Dependency rules

現在の package は `presentation-core`、`presentation-authoring`、`presentation-renderer-api`、`presentation-assets` に依存する。Concrete component / renderer の実装には依存せず、Renderer は plugin として host から注入する。

Compiler は CLI、Web Editor、Control Plane、Realtime、Unity に依存しない。

## 9. Validation strategy

- Explore → Red → Green で compiler pass ごとの fixture を追加する
- AST lowering と forbidden syntax の fixture
- Declaration Graph normalization の golden test
- Semantic Authoring IR / PresentationDefinition の valid / invalid fixture
- canonical JSON と cache key の determinism test
- renderer plugin fake を使った orchestration test
- package lock / source / config / toolchain drift test
- reference Authoring Project の end-to-end build

## 10. Deferred decisions

- TypeScript parse / lossless tree implementation
- plugin discovery と version negotiation
- Surface partition algorithm と author override
- cache layout と remote cache policy
- Browser process / isolate topology
- diagnostics の stability policy
