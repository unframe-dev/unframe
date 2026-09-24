# Presentation Compiler Architecture

- **Status**: M3A structured authoring implementation
- **Scope**: Authoring Project から canonical PresentationDefinition と RenderBundle を生成する library
- **Related**:
  - [Presentation Architecture](../../docs/packages/ARCHITECTURE.md)
  - [Presentation Implementation Design](../../docs/packages/DESIGN.md)
  - [Presentation Authoring Architecture](../unframe-authoring/ARCHITECTURE.md)
  - [Renderer API Architecture](../unframe-renderer-api/ARCHITECTURE.md)
  - [ADR-0011](../../docs/decisions/0011-surface-partition-contract.md)
  - [ADR-0012](../../docs/decisions/0012-texture-budget-residency-contract.md)
  - [ADR-0017](../../docs/decisions/0017-m3a-structured-authoring-contract.md)

## 1. Role

`unframe-compiler` は programmatic Local Compiler pipeline を所有する。現在はTypeScript Compiler APIによるTS/TSXの構文解析境界と、post-lowering の plain-data `PresentationDeclaration` を検査してStatic Structured Surface subsetをcanonical `PresentationDefinition` JSONへlowerする境界を持つ。

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
        ↓ normalize / collect / pair
plain declaration catalog + source map
        ↓ assemble with theme hashes / component locks / asset carriers
CompilerDeclarationProject
        ↓ theme / component / layout / surface resolution + Core validation
v2 PresentationDefinition + font AssetSet
        ↓ renderer plugin + PNG encode + artifact integrity validation
v2 RenderBundle + AssetSet + BuildManifest + font / PNG bytes
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

`checkDeclarationProject(unknown)` は accessor を実行しない descriptor-safe plain-data clone の後、Zod 4 で project envelope を検査し、Theme、Component manifest/structure/lock、Spatial instance、自己完結した font Asset carrier を解決する。cross-reference、duplicate、M3A subset の制約は semantic invariant として個別に検査する。実装済み subset は型付き Theme token と同category alias、NamedStyle、scalar Props、style Variants、Parts、absolute な nested Frame / Text、明示 Slot placeholder による Frame-root Component composition を扱う。解決順は default、NamedStyle、inline、Variant、Part であり、配列は全置換する。選択済み Variant が同じ node/property を変更する場合は拒否する。

Slot の子は placeholder の children 位置で順序付きに展開する。`semanticParentId` がある場合は子 Component の Semantic Tree roots を親 Component 内の該当 node の既存 children 後へ接続し、省略時は親 Surface の roots へ追加する。どちらも sibling order を決定論的に再採番する。top-level instance は Surface root と Spatial node を必須とし、slotted instance は Frame root かつ Spatial node なしを必須とする。欠落・重複・self reference・cycle・owner mismatch を build error にする。

すべての Authoring 値は具体的な v2 Text / Frame 値へ解決してから Core validation へ渡す。省略した Prop / default 付き Variant は `CheckedDeclarationProject.warnings` に instance ID、宣言名、default 値、利用可能な source metadata を記録する。明示された空文字、`0`、`false`、または default と同じ値は warning にしない。結果には v2 Definition、Core canonical JSON、source hash、definition hash、font AssetSet と warnings を含む。

`compileDeclarationProject(unknown, options)` は同じ subset を一つの全 Surface RenderSurface に展開し、全 State の完成 Semantic Tree を Core で materialize する。注入された `baked-web` Renderer には検証済み font bytes と、logical size から ADR-0012 の長辺 2048 policy で導出した pixel target を渡す。raw RGBA capture は `unframe-assets` で決定論的な PNG に encode し、v2 Definition / RenderBundle / AssetSet / BuildManifest と font・PNG bytes を返す。Compiler は capture 前に固定 count / raster budget を検査し、capture / output / accounted peak budget と Core の artifact・build integrity を最終境界で検証する。Renderer / encoder / malformed input の失敗は diagnostics として返す。

Renderer registry は `baked-web` ID がちょうど一つに解決されることを要求する。Bundle identity と renderer build context は source / Definition、Compiler identity、明示 build context、Renderer fingerprint、PNG encoder identity を入力に含める。Host は `baseEnvironmentHash` として Compiler host の基礎環境を渡し、Compiler は Renderer / encoder identity を結合した `environmentHash` を RenderBundle に固定する。

Source frontend は、明示的な logical project root、root-relative TS / TSX / declaration file、locked virtual package を descriptor-safe に snapshot する。TypeScript Compiler API は virtual source だけを読み、project 内 relative import、package 内 relative import、direct locked dependency、exact package export を解決する。実 filesystem、`node_modules`、`ts.sys` へ fallback しない。

typecheck は strict ES2022、`noLib` で実行し、project root から到達しない package の ambient declaration を semantic program へ混入させない。一方、lock graph 全体の module specifier は preflight し、不正な dependency / export を owner-aware source diagnostic として拒否する。named value import は TypeChecker alias と package identity / export / declaration owner を照合し、plain-data symbol provenance を生成できる。

個別 declaration file については、Static DSL の import、const 参照、root / nested builder、JSON-like expression、Authoring JSX を fail closed で検証し、source origin 付きの plain-data Declaration Graph へ lower できる。builder signature と JSX tag は現行 public Authoring API に固定し、Source module、JSX runtime、builder implementation は実行しない。

単一 Declaration Graph は、builder call を実行せず null-prototype の plain declaration value へ normalize できる。normalizer は予約 field の衝突と不正 Graph を fail closed で拒否し、正規化後の JSON path と value / property key / generated field の source origin を sidecar source map に保持する。

project-owned declaration file は、entry、`*.unframe.ts`、`*.manifest.ts`、`*.structure.tsx` の role と root builder を照合し、project-relative filename 順で lower / normalize できる。補助 `.d.ts` と package-owned source は collection から除外する。ほかの `.ts` / `.tsx` は helper module として root 数を増やさないが、未使用 const を含む全 top-level statement を同じ静的安全規則で検査する。

正規化済み collection は、Presentation 1件、Theme ID、Component `(componentId, version)` を検証し、Structured Manifest が所有する root-contained な `authoring.structure` entry から Structure を決定論的に対応付ける。複数versionが同じ Structure entryを共有することは許可し、Structure の `componentId` は参照元 Manifest と一致させる。pairing は source map 付き canonical diagnostic を全件集約し、失敗時に partial catalog を返さない。

`checkAuthoringProject(unknown)` は virtual Source frontend の公開 pure boundary として parse、typecheck、lower、normalize、collect、pair を接続し、成功時は TypeScript の `Program` / `TypeChecker` を含まない plain declaration catalog、失敗時は source range 付き diagnostic を返す。builder implementation、filesystem、Browser は実行しない。

`assembleDeclarationProject(unknown)` は paired catalog と、Theme ID ごとの hash、Component `(componentId, version)` ごとの完全 package lock、Asset carrier を明示的に受け取る pure boundary である。catalog の source-map wrapper を出力に持ち込まず、carrier の欠落・余分・重複・identity mismatch を fail closed で拒否する。Theme、Manifest、Structure はそれぞれの declaration semantic payload を Core の canonical JSON SHA-256 で再計算し、lock hash mismatch を stable diagnostic として拒否する。declaration node、Slot placeholder、Surface-root と Frame-root の Semantic Tree node の `source` metadata は hash から除き、Theme token / NamedStyle と Prop reference を含む意味値は保持する。入力順に依存せず canonical envelope を組み立て、`checkDeclarationProject` で再検証する。package integrity と asset checksum は計算も推測もしない。

post-lowering declaration の検査は Authoring package の pure type guard を利用し、definition builder を呼び出さない。Compiler の plain-data clone は `Object.prototype` と null-prototype の record を受理し、descriptor だけから null-prototype clone を作る。custom prototype、accessor、cycle、sparse array、symbol key、非 JSON 値は Zod や semantic validation に渡す前に拒否し、caller-owned getter や Proxy の `get` trap を実行しない。

Static DSL は top-level `const`、型注釈、`as const`、`satisfies`、project-relative named / default import、静的 property access、shorthand、object / array spread を解決する。object spread は左から右へ適用し後の値を採用し、raw な重複 explicit key と `__proto__` は拒否する。参照先の値は definition origin、解決不能は use-site origin を保持する。循環参照に加え、展開深さ 128 または Declaration Graph 50,000 node を超える入力を stable diagnostic で停止する。

TSX は `jsxImportSource = "@unframe/unframe-authoring"` で型検査し、provenance 検証済みの `Surface`、`Frame`、`Text`、`Slot`、`ComponentInstance` を builder と同じ Graph へ lower する。Frame children は静的配列を再帰的に flatten して順序を保つ。custom component、Fragment、`key` / `ref`、lowercase tag、children の競合を拒否する。任意関数、可変 binding、代入、getter / method、control flow、dynamic import は拒否し、Compiler は Authoring Source、JSX runtime、SDK 関数を実行しない。

## 5. Public API

- `checkDeclarationProject`: post-lowering declaration の限定 subset を検査し Definition を返す。Renderer は実行しない
- `checkAuthoringProject`: virtual Authoring source を実行せず検査し、source origin 付き declaration catalog を返す
- `assembleDeclarationProject`: checked catalog と明示 carrier から、source-map を含まない canonical `CompilerDeclarationProject` を返す
- `checkAuthoringProjectAssembly`: virtual source と catalog を上書きできない carrier を接続し、phase 付き失敗または Checked Definition を返す
- `compileAuthoringProject`: 同じ source-to-assembly 経路を Renderer / PNG compilation へ接続する
- `compileDeclarationProject`: 明示された build context、Renderer plugin、encoder limits から v2 の Definition、RenderBundle、AssetSet、BuildManifest と font / PNG asset bytes を返す
- diagnostics: stable code、severity、semantic path、source range
- build metadata: source、lock、config、Compiler、renderer environment の hash / provenance

Programmatic API は command line、stdout、process exit、global current directory に依存しない。

M1 filesystem hostとprocess entryは`unframe-cli`が所有する。CLIはreference Authoring Projectのconfig / lockをvirtual inputへ変換し、この公開APIへ渡す。`nix run .#presentation`は同じ入力をFixed Browserで2回buildし、Definition、RenderBundle、PNG asset setの全bytesが一致することを検証する。

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

現在の package は `unframe-core`、`unframe-authoring`、`unframe-renderer-api`、`unframe-assets`、固定versionの`typescript`に依存する。構文解析はclassic TypeScript Compiler APIを直接使用し、`ts-morph`のようなwrapperを介さない。TypeScript 7の`unstable/sync` APIはvirtual filesystemと`tsgo` processを伴うproject解析向けであるため、このpureな単一source構文解析境界には採用しない。Concrete component / renderer の実装には依存せず、Renderer は plugin として host から注入する。

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

- named entry export
- plugin discovery と version negotiation
- ADR-0011でAcceptedになったSurface partition / author isolate overrideのM3〜M4実装
- cache layout と remote cache policy
- M1後のBrowser pooling / multi-project isolate topology
- release間のdiagnostic compatibility policy
