# Presentation Compiler Architecture

- **Status**: Initial implementation
- **Scope**: Authoring Project から canonical PresentationDefinition と RenderBundle を生成する library
- **Related**:
  - [Presentation Architecture](../../docs/presentation/ARCHITECTURE.md)
  - [Presentation Implementation Design](../../docs/presentation/DESIGN.md)
  - [Presentation Authoring Architecture](../presentation-authoring/ARCHITECTURE.md)
  - [Renderer API Architecture](../presentation-renderer-api/ARCHITECTURE.md)
  - [ADR-0011](../../docs/decisions/0011-surface-partition-contract.md)
  - [ADR-0012](../../docs/decisions/0012-texture-budget-residency-contract.md)

## 1. Role

`presentation-compiler` は programmatic Local Compiler pipeline を所有する。現在はTypeScript Compiler APIによるTS/TSXの構文解析境界と、post-lowering の plain-data `PresentationDeclaration` を検査してStatic Structured Surface subsetをcanonical `PresentationDefinition` JSONへlowerする境界を持つ。

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

`checkDeclarationProject(unknown)` は accessor を実行しない descriptor-safe plain-data clone の後、Zod 4 で project envelope を検査し、Theme、Component manifest/structure/lock、Spatial instance、Asset reference を解決する。cross-reference、duplicate、initial subset の制約だけは semantic invariant として個別に検査する。実装済み subset は Structured `Surface → Frame → direct Text`、静的・非対話・baked-web のみである。結果には Core canonical JSON、source hash、definition hash を含む。

`compileDeclarationProject(unknown, options)` は同じ subset を一つの全 Surface RenderSurface に展開し、全 State の完成 Semantic Tree を Core で materialize する。注入された `baked-web` Renderer の raw RGBA capture を `presentation-assets` で決定論的な PNG に encode し、Core で検証済みの canonical RenderBundle と asset bytes を返す。Renderer / encoder / malformed input の失敗は diagnostics として返す。

Renderer registry は `baked-web` ID がちょうど一つに解決されることを要求する。Bundle identity と renderer build context は source / Definition、Compiler identity、明示 build context、Renderer fingerprint、PNG encoder identity を入力に含める。Host は `baseEnvironmentHash` として Compiler host の基礎環境を渡し、Compiler は Renderer / encoder identity を結合した `environmentHash` を RenderBundle に固定する。

Source frontend は、明示的な logical project root、root-relative TS / TSX / declaration file、locked virtual package を descriptor-safe に snapshot する。TypeScript Compiler API は virtual source だけを読み、project 内 relative import、package 内 relative import、direct locked dependency、exact package export を解決する。実 filesystem、`node_modules`、`ts.sys` へ fallback しない。

typecheck は strict ES2022、`noLib` で実行し、project root から到達しない package の ambient declaration を semantic program へ混入させない。一方、lock graph 全体の module specifier は preflight し、不正な dependency / export を owner-aware source diagnostic として拒否する。named value import は TypeChecker alias と package identity / export / declaration owner を照合し、plain-data symbol provenance を生成できる。

個別 declaration file については、M1 Static DSL の import、root builder、nested builder、JSON-like expression を fail closed で検証し、source origin 付きの plain-data Declaration Graph へ lower できる。builder signature は現行 public Authoring API の arity と基本 argument shape に固定し、Source module と builder implementation は実行しない。

単一 Declaration Graph は、builder call を実行せず null-prototype の plain declaration value へ normalize できる。normalizer は予約 field の衝突と不正 Graph を fail closed で拒否し、正規化後の JSON path と value / property key / generated field の source origin を sidecar source map に保持する。

project-owned declaration file は、entry、`*.unframe.ts`、`*.manifest.ts`、`*.structure.tsx` の role と root builder を照合し、project-relative filename 順で lower / normalize できる。補助 `.d.ts` と package-owned source は collection から除外し、未対応 suffix や role mismatch は全 file 分を canonical diagnostic として返す。

正規化済み collection は、Presentation 1件、Theme ID、Component `(componentId, version)` を検証し、Structured Manifest が所有する root-contained な `authoring.structure` entry から Structure を決定論的に対応付ける。複数versionが同じ Structure entryを共有することは許可し、Structure の `componentId` は参照元 Manifest と一致させる。pairing は source map 付き canonical diagnostic を全件集約し、失敗時に partial catalog を返さない。

`checkAuthoringProject(unknown)` は virtual Source frontend の公開 pure boundary として parse、typecheck、lower、normalize、collect、pair を接続し、成功時は TypeScript の `Program` / `TypeChecker` を含まない plain declaration catalog、失敗時は source range 付き diagnostic を返す。builder implementation、filesystem、Browser は実行しない。

`assembleDeclarationProject(unknown)` は paired catalog と、Theme ID ごとの hash、Component `(componentId, version)` ごとの完全 package lock、Asset carrier を明示的に受け取る pure boundary である。catalog の source-map wrapper を出力に持ち込まず、carrier の欠落・余分・重複・identity mismatch を fail closed で拒否する。入力順に依存せず canonical envelope を組み立て、`checkDeclarationProject` で再検証する。hash、integrity、checksum は計算も推測もしない。

post-lowering declaration の検査は Authoring package の pure type guard を利用し、definition builder を呼び出さない。Compiler の plain-data clone は `Object.prototype` と null-prototype の record を受理し、descriptor だけから null-prototype clone を作る。custom prototype、accessor、cycle、sparse array、symbol key、非 JSON 値は Zod や semantic validation に渡す前に拒否し、caller-owned getter や Proxy の `get` trap を実行しない。

M1 Static DSL は、各 declaration file の default export を、provenance 検証済みの `@unframe/presentation` root named value import に対する直接 builder call へ限定する。builder 引数は JSON-like literal と認識済み builder call だけを許可し、JSX、任意関数、control flow、dynamic import、property access、spread、template expression、local alias を stable diagnostic で拒否する。named import alias は元の package export provenance を保持する。Compiler は Authoring Source や builder implementation を実行しない。

## 5. Public API

- `checkDeclarationProject`: post-lowering declaration の限定 subset を検査し Definition を返す。Renderer は実行しない
- `checkAuthoringProject`: virtual Authoring source を実行せず検査し、source origin 付き declaration catalog を返す
- `assembleDeclarationProject`: checked catalog と明示 carrier から、source-map を含まない canonical `CompilerDeclarationProject` を返す
- `checkAuthoringProjectAssembly`: virtual source と catalog を上書きできない carrier を接続し、phase 付き失敗または Checked Definition を返す
- `compileAuthoringProject`: 同じ source-to-assembly 経路を Renderer / PNG compilation へ接続する
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

現在の package は `presentation-core`、`presentation-authoring`、`presentation-renderer-api`、`presentation-assets`、固定versionの`typescript`に依存する。構文解析はclassic TypeScript Compiler APIを直接使用し、`ts-morph`のようなwrapperを介さない。TypeScript 7の`unstable/sync` APIはvirtual filesystemと`tsgo` processを伴うproject解析向けであるため、このpureな単一source構文解析境界には採用しない。Concrete component / renderer の実装には依存せず、Renderer は plugin として host から注入する。

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

- M1 より広い Static DSL、named entry export、TSX / JSX lowering
- plugin discovery と version negotiation
- ADR-0011でAcceptedになったSurface partition / author isolate overrideのM3〜M4実装
- ADR-0012でAcceptedになったresolution / count / aggregate build budgetのM3〜M4実装
- cache layout と remote cache policy
- Browser process / isolate topology
- diagnostics の stability policy
