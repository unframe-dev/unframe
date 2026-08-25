# Unframe Presentation Implementation Design

- **Status**: Draft
- **Date**: 2026-08-25
- **Scope**: Presentation authoring、compiler、renderer、release、delivery、runtime を実装するための repository layout と ownership
- **Related**:
  - [Presentation Architecture](./ARCHITECTURE.md)
  - [Repository Architecture](../../ARCHITECTURE.md)
  - [ADR-0006: プレゼンテーションアーキテクチャを定義する](../decisions/0006-presentation-rendering-strategy.md)

## 1. この文書の位置付け

[Presentation Architecture](./ARCHITECTURE.md) は、Authoring Source、Semantic Authoring IR、PresentationDefinition、RenderBundle、DeliveryManifest、Runtime State の意味と境界を定義する。

本書は、そのアーキテクチャを repository 上で実装するために、次を定義する上位 implementation design である。

- 新設する package、application-owned directory、tooling directory
- 各 directory の責務と非責務
- package と application 間の依存方向
- contract、source、generated artifact の所有者
- Authoring Project と Unframe implementation repository の区別
- 各 directory に後から追加する `ARCHITECTURE.md` の境界
- 実装を開始する順序

型や wire field の完全な定義、compiler 内部アルゴリズム、renderer の詳細、UI の情報設計は本書で固定しない。それらは contract source と各 directory の `ARCHITECTURE.md` で定義する。

## 2. 設計原則

### 2.1 Directory は ownership boundary とする

新しい directory は、独立した責務、依存方向、公開 API、品質ゲートのいずれかを持つ場合に作る。単にファイル数を減らすための階層や、将来使うかもしれない空 package は作らない。

### 2.2 Package は実行環境をまたいで implementation を共有しない

TypeScript package を Go Realtime や Unity C# から直接利用しない。複数言語間では JSON Schema、OpenAPI、Protocol Buffers、fixture などの contract artifact を共有する。

TypeScript 内では、Web、Compiler、Control Plane が pure な Presentation model と validation を共有できる。ただし React、Node.js、Browser、Cloudflare Workers の runtime object を共有 model に持ち込まない。

### 2.3 Concrete runtime から contract を逆流させない

- Web Editor の UI state を Semantic Authoring IR の正本にしない。
- Compiler の cache や Browser object を PresentationDefinition に入れない。
- Control Plane の D1 / R2 representation を Presentation contract にしない。
- Realtime の Go implementation detail を Runtime wire contract にしない。
- Unity の GameObject、Material、Texture を DeliveryManifest に入れない。

### 2.4 Public entrypoint と implementation library を分離する

CLI は compiler orchestration の利用者向け entrypoint とし、compile logic を所有しない。Nix、CI、repository script は CLI または package task を呼び出す薄い wrapper とし、Presentation domain logic を持たない。

### 2.5 Current と Target を混在させない

本書に記載する新規 directory は Target layout であり、現在すべて存在することを意味しない。既存の Control Plane schema、Web Editor PoC、Unity importer、Realtime foundation は、それぞれの移行境界が設計されるまで維持する。

## 3. Target repository layout

```text
unframe/
├─ app/
│  ├─ web/
│  │  └─ src/features/editor/                 # GUI authoring integration
│  ├─ server/
│  │  ├─ control-plane/
│  │  │  └─ src/modules/
│  │  │     ├─ presentation-builds/           # build receipt and validation
│  │  │     ├─ releases/                      # immutable publish unit
│  │  │     └─ delivery/                      # runtime projection
│  │  ├─ realtime/
│  │  │  └─ internal/
│  │  │     ├─ session/                       # Go canonical progression and state
│  │  │     ├─ protocol/                      # wire to session input mapping
│  │  │     └─ runtimecore/                   # active runtime composition
│  │  └─ integration/                         # component-spanning E2E
│  └─ unity/
│     └─ Assets/Scripts/PresentationRuntime/
│        ├─ Delivery/                         # manifest verification and projection
│        ├─ Assets/                           # download, cache, preload, unload
│        ├─ Rendering/                        # runtime renderer graph
│        ├─ Interaction/                      # device input to logical event
│        ├─ Realtime/                         # control, state, reconnect
│        └─ State/                            # snapshot and event application
├─ packages/
│  ├─ contracts/
│  │  ├─ presentation/                        # portable artifact contract sources
│  │  └─ proto/unframe/                       # delivery and runtime wire sources
│  ├─ api-client-csharp/                      # generated C# contract artifacts
│  ├─ presentation-core/                      # pure semantic model
│  ├─ presentation-authoring/                 # authoring SDK and component SDK
│  ├─ presentation-components/                # built-in primitives and components
│  ├─ presentation-renderer-api/              # renderer plugin boundary
│  ├─ presentation-renderer-web/              # baked-web build implementation
│  ├─ presentation-assets/                    # deterministic asset transforms
│  ├─ presentation-compiler/                  # compiler pipeline library
│  └─ presentation-cli/                       # user-facing executable
├─ examples/
│  └─ presentation/                           # end-to-end reference Authoring Project
├─ scripts/
│  └─ presentation/                           # Nix and CI wrappers only
└─ docs/
   ├─ presentation/
   │  ├─ ARCHITECTURE.md                     # semantic and system architecture
   │  └─ DESIGN.md                           # this implementation ownership design
   └─ decisions/                              # cross-boundary decisions and rationale
```

Target directory は担当実装を開始する時点で追加する。empty placeholder、空の `package.json`、将来用の `src/` は先行して作らない。

## 4. Shared package responsibilities

### 4.1 `packages/presentation-core`

Presentation の pure TypeScript semantic core を所有する。

**Responsibilities**

- Stable ID、Scalar、Transform、typed reference などの共通 value
- Semantic Authoring IR の data model
- contractから導出したPresentationDefinitionのin-memory semantic model
- contractから導出したRenderBundleのin-memory build metadata model
- reference validation、invariant validation、diagnostics
- canonical serialization と hashing
- schema version と pure migration
- cross-package test fixture の TypeScript builder

**Non-responsibilities**

- TSX、JSX runtime、React
- TypeScript compiler API、module resolution、sandbox
- Browser capture、Texture、Video encoding
- filesystem、network、process environment
- D1、R2、HTTP、gRPC、Unity object
- Delivery 時だけ存在する Signed URL

この package は Node.js、DOM、React、Cloudflare Workers に依存しない。Web、Compiler、Control Plane から利用できるが、Go と C# には generated contract artifact を介して接続する。

### 4.2 `packages/presentation-authoring`

利用者向け import 名を `@unframe/presentation` とし、Authoring Source を Declaration Graph と Semantic Authoring IRへ接続する SDK を所有する。

**Responsibilities**

- `definePresentation`
- Presentation Orchestrator の制限付き JSX / DSL
- Component Manifest authoring API
- Props、Slots、Parts、Variants、States、Actions、Outputs の builder
- Theme、Token、Asset reference の authoring API
- Declaration Graph builder
- Stable ID、source metadata、Component Instance のauthoring operation
- Structured / Opaque Component の公開境界
- Semantic Command と source patching が共有する authoring operation

**Non-responsibilities**

- TypeScript source の bundle と sandbox execution
- renderer artifact の生成
- project filesystem と cache
- Web Editor UI
- Control Plane persistence
- Runtime progression evaluation

この package は `presentation-core` に依存する。Compiler、Web Editor、Component package が利用するが、Compiler やWeb Editorへ逆依存しない。

### 4.3 `packages/presentation-components`

Unframe が提供する標準 Primitive、Component、Theme を所有する。

**Responsibilities**

- Spatial primitive の Manifest
- Surface primitive の Manifest と structured definition
- 標準 Component と Variant
- 標準 Theme、Token、Named Style
- component preview fixture と contract test
- 対応 renderer と required capability の宣言

**Non-responsibilities**

- Presentation 全体の composition
- Compiler pipeline
- renderer plugin selection
- product-specific template と user content

この package は `presentation-authoring`と`presentation-core`に依存する。Manifestはrenderer IDとcapabilityをdataとして宣言するが、Compiler plugin用の`presentation-renderer-api`には依存しない。Componentのweb renderer implementationはReactなど自身の実装依存を持てるが、Unframe Compilerやconcrete renderer packageへ依存しない。

### 4.4 `packages/presentation-renderer-api`

Compiler と concrete renderer の間の plugin contract を所有する。

**Responsibilities**

- renderer identifier と version
- input capability と output artifact contract
- Surface Render Intent の support 判定
- renderer build context
- deterministic output、diagnostics、provenance の interface
- renderer fixture と共通 conformance harness

**Non-responsibilities**

- Browser起動
- React / CSS rendering
- concrete artifact generation
- rendererの自動選択 policy
- CLI

この package は `presentation-core` にだけ依存する。Compiler と concrete renderer の双方が依存し、concrete renderer 同士は依存しない。

### 4.5 `packages/presentation-renderer-web`

`baked-web` renderer と、固定 Browser 環境での capture を所有する。

**Responsibilities**

- Component web renderer entry の bundle と実行
- Browser lifecycle と fixed rendering environment
- Surface State ごとの layout と capture
- Semantic Tree と Hit Region の抽出
- pixel size、color space、alpha modeを持つ未encodeのSurface capture生成
- Browser、font、locale、timezone、layoutのrenderer provenance
- visual regression fixture

**Non-responsibilities**

- PresentationDefinition の意味変更
- Component Manifest からの semantic information 推測
- Asset upload とSigned URL
- Unity rendering
- Native UI、Video renderer の実装

この package は `presentation-core`、`presentation-renderer-api`、`presentation-assets`に依存する。Capture結果のresize、encode、checksumは`presentation-assets`へ委譲する。Compilerからはpluginとして注入され、Compilerへimplementationを逆流させない。

Native UI、Video、その他の renderer は、実装開始時にそれぞれ独立 package として追加する。`presentation-renderer-web` に仮実装を置かない。

### 4.6 `packages/presentation-assets`

Compiler build 中に使用する deterministic asset transformation を所有する。

**Responsibilities**

- 入力Imageとrenderer captureのresize、texture encode、checksum
- font resolution と必要な場合のsubset
- video、model変換を追加するためのadapter boundary
- content-addressed binary output
- media type、size、checksum、encoder provenance metadata
- temporary workspace とoutput cleanupのlibrary boundary

**Non-responsibilities**

- Control Plane のAsset ownership
- R2 upload、Signed URL、expiry
- Unity runtime cache
- renderer selection

OS toolやcodec依存はこのpackageかそのadapterに閉じ込め、`presentation-core`へ持ち込まない。

`presentation-renderer-web`はBrowser上の意味、layout、capture条件を所有し、`presentation-assets`はcapture後のbinary変換を所有する。Control Planeはupload後のownershipとR2 lifecycle、Unityはdownload後のruntime cacheを所有する。

このpackageはartifact descriptorとdiagnosticsの型に限って`presentation-core`へ依存する。

### 4.7 `packages/presentation-compiler`

Authoring Project から PresentationDefinition と RenderBundle を生成するprogrammatic compiler pipelineを所有する。

**Responsibilities**

- Authoring Source のparseとLossless Syntax Tree / Source Map保持
- TypeScript typecheck、transpile、bundle
- module resolution とpackage lock検証
- deterministic sandbox execution
- Declaration Graph のnormalizeとSemantic Authoring IR生成
- Component、Theme、Layout、Surface boundaryの解決
- renderer selectionとplugin orchestration
- canonical PresentationDefinition JSON とRenderBundleの生成
- build cache key、hash、diagnostics
- programmatic compile / check API

**Non-responsibilities**

- user-facing command parsing
- Control Planeへのpublish
- concrete renderer implementation
- Web Editor UI
- Runtime progression evaluation

Compiler は `presentation-core`、`presentation-authoring`、`presentation-renderer-api`、`presentation-assets`に依存する。concrete renderer はhostから注入する。

### 4.8 `packages/presentation-cli`

Authoring Projectを操作する利用者向け executable を所有する。

**Responsibilities**

- `init`、`dev`、`check`、`build`、`test`、`preview`、`publish` command
- project config、lockfile、cache、output directoryの解決
- Compilerとrenderer pluginのcomposition
- diagnostics表示とexit code
- local watch、dev server、preview host
- 公開Control Plane contractに従うpublish client adapterの呼び出し

**Non-responsibilities**

- semantic validation ruleの実装
- compiler passの実装
- renderer artifact generation
- durable Release state

CLIは`presentation-compiler`と、既定で有効にするconcrete rendererに依存する。CLIからpackage内部の非公開moduleをimportしない。

## 5. Contract and generated artifact ownership

### 5.1 `packages/contracts`

`packages/contracts` はapplicationと言語の境界を越えるserialized artifactとwire contractのsource of truthを所有する。

```text
packages/contracts/
├─ presentation/
│  ├─ presentation-definition.<schema-source>
│  ├─ render-bundle.<schema-source>
│  └─ fixtures/
└─ proto/unframe/
   ├─ delivery/v1/delivery.proto
   └─ realtime/v1/realtime.proto
```

- PresentationDefinitionとRenderBundleのserialized shapeは`packages/contracts/presentation/`をsource of truthとする。
- `presentation-core`はcontractから生成または導出したTypeScript modelを使用し、serialized fieldを独自に再定義しない。
- `presentation-core`は、portable structural schemaだけでは表せないreference validation、semantic invariant、canonicalizationを所有する。
- DeliveryManifest、Reliable Event、Snapshot、State Streamなどのwire sourceは`packages/contracts/proto/`に置く。
- OpenAPIはControl Plane route contractから生成する。
- generated fileは手編集しない。
- source schemaとgenerated artifactのdriftをCIで検証する。
- schemaから生成したfixtureをGo、C#、TypeScript consumerのconformance testで共有する。
- Go Protobufは`app/server/realtime/internal/gen/`、C# artifactは`packages/api-client-csharp/`へ生成する。

依存方向は`packages/contracts`から生成されたTypeScript contractを`presentation-core`が利用する向きに固定する。`packages/contracts`のgeneratorは`presentation-core`をimportしない。これによりserialized contractとsemantic implementationの循環したsource of truthを避ける。

### 5.2 `packages/api-client-csharp`

OpenAPIとProtocol Buffersから生成したC# artifactを所有する。Unity固有のGameObject adapter、renderer、cacheは含めない。Unityはgenerated model / clientを参照し、その外側にUnity-owned adapterを実装する。

## 6. Application-owned responsibilities

### 6.1 `app/web/src/features/editor`

- Semantic Authoring IRのGUI projection
- Semantic Command、selection、history、temporary interaction state
- Inspector、Scene、Surface、Flow、Theme editing
- Source Mapを介したCode / GUI同期
- Compiler diagnosticsとpreviewの表示
- Draft保存、revision conflict、build / publish UI

Web EditorはCompiler Core、Browser sandbox、renderer artifact generationを所有しない。Node-only Compilerをbrowser bundleへ直接取り込まず、worker、local process、またはserviceとの接続方式をWeb architectureで決める。

### 6.2 `app/server/control-plane`

Targetとして次のapplication moduleを追加する。

- `presentation-builds`: Compiler成果物のreceipt、schema/hash/Asset検証
- `releases`: Definition、RenderBundle、Asset Set、contract versionを束ねるimmutable Release
- `delivery`: role、capability、assignmentに基づくDeliveryManifest projection

Control PlaneはAuthoring Source、TSX、React、renderer implementation、Authoring JavaScriptを実行しない。既存`src/presentation/`のDefinition CRUDは、Draft / Build / Release migrationが決まるまで自動的に移動しない。

### 6.3 `app/server/realtime`

- `internal/session`: renderer-independentなGo progression、Runtime State、Snapshot
- `internal/protocol`: generated wire typeからvalidated core inputへのmapping
- `internal/runtimecore`: assignment、transport、session、persistence adapterのcomposition

既存の`internal/session`と`internal/runtimecore`を拡張し、同じ責務のために新しいtop-level `progression` packageを並立させない。Go progressionはTypeScript implementationを移植して共有したことにせず、contract fixtureとconformance testにより、Compiler validation、Realtime evaluation、Unity consumerの意味を一致させる。

### 6.4 `app/unity/Assets/Scripts/PresentationRuntime`

- DeliveryManifestの検証とruntime renderer graph構築
- Asset download、checksum、cache、preload、eviction
- native-3d、baked-web、native-ui、videoのUnity adapter
- SnapshotとReliable Eventの適用
- Timelineのlocal interpolation
- device inputからLogical Eventへの変換
- Realtime接続、reconnect、state convergence

既存`PresentationImport/`はCurrent schema向けのtransitional implementationとして扱う。Target Runtimeへの移行方法をUnity architectureで決めるまで、名前変更や一括移動を前提にしない。

### 6.5 `app/server/integration`

Control Plane、Realtime、generated contract、reference clientを接続するbackend E2Eを所有する。Browser UIやUnity visual testは所有しない。

## 7. Dependency direction

Contract generationは次の一方向とする。

```text
packages/contracts source
├─ generate → TypeScript contract → presentation-core / Control Plane
├─ generate → Go contract         → Realtime
└─ generate → C# contract         → packages/api-client-csharp → Unity
```

TypeScript packageのruntime / build dependencyは次のとおりとする。

```text
presentation-core ──────────────→ generated TypeScript presentation contract
presentation-authoring ────────→ presentation-core
presentation-components ───────→ presentation-authoring
presentation-components ───────→ presentation-core
presentation-renderer-api ─────→ presentation-core
presentation-assets ────────────→ presentation-core
presentation-renderer-web ──────→ presentation-renderer-api
presentation-renderer-web ──────→ presentation-assets
presentation-renderer-web ──────→ presentation-core

presentation-compiler ──────────→ presentation-core
presentation-compiler ──────────→ presentation-authoring
presentation-compiler ──────────→ presentation-renderer-api
presentation-compiler ──────────→ presentation-assets

presentation-cli ───────────────→ presentation-compiler
presentation-cli ───────────────→ presentation-renderer-web
presentation-cli ───────────────→ Control Plane API client adapter

Web Editor ─────────────────────→ presentation-core / presentation-authoring
Control Plane ──────────────────→ presentation-core / generated contracts
Realtime ───────────────────────→ generated Go contracts
Unity ──────────────────────────→ generated C# contracts
```

`A → B`は`A`が`B`に依存することを表す。次を禁止する。

- `presentation-core`からAuthoring、Compiler、Renderer、CLIへの依存
- `packages/contracts`のgeneratorから`presentation-core`への依存
- `presentation-authoring`からCompiler、Web Editorへの依存
- `presentation-compiler`からconcrete rendererへのhard dependency
- concrete renderer間の依存
- Web EditorからCompiler内部moduleへの依存
- Control PlaneからCompiler、Authoring SDK、rendererへの依存
- RealtimeからTypeScript packageへの依存
- UnityからAuthoring Source、React、CSSへの依存
- `scripts/`にdomain logicを置くこと

## 8. Standard package layout

各新規TypeScript packageは、必要になった範囲で次の形を使用する。

```text
packages/<name>/
├─ package.json
├─ src/
├─ test/
├─ fixtures/          # package外consumerと共有する場合だけ作る
├─ README.md          # 利用方法とcommand
└─ ARCHITECTURE.md    # 内部責務と依存境界。実装開始時に作る
```

- sourceとtestを同じdirectoryへ混在させない。
- generated artifactは`src/`へ手書きsourceと混在させず、契約generation先であることを明示する。
- package内部のsubdirectoryは、そのpackageの`ARCHITECTURE.md`で決める。
- package間でtest helperを相対path importしない。共有fixtureは所有packageのpublic test exportまたは`packages/contracts`のportable fixtureに置く。

既存のpnpm workspaceが`packages/*`を対象としているため、新しいpackageも`packages/`直下にflatに置く。`packages/presentation/*`のような新しいnestを導入しない。

## 9. Authoring Project layout

Unframe implementation repositoryのpackage layoutと、利用者が作るAuthoring Projectを区別する。

```text
presentation/
├─ presentation.unframe.tsx
├─ theme.unframe.ts
├─ components/
├─ assets/
├─ unframe.config.ts
├─ unframe.lock
├─ .unframe-cache/
└─ dist/
```

この`presentation/`は利用者のproject root例であり、Unframe monorepoのimplementation package rootには使用しない。Repository内のreference projectは`examples/presentation/`に置く。

- `.unframe-cache/`は再生成可能でversion control対象外とする。
- `dist/`はCompiler outputでありAuthoring Sourceではない。
- `unframe.lock`の正確な形式とpackage manager連携はAuthoring architectureで決める。
- reference projectはproduction用の隠れたdefault contractにせず、公開fixtureとして検証する。

## 10. Documentation hierarchy

```text
docs/presentation/ARCHITECTURE.md
    semantic model and system-wide boundaries
        ↓
docs/presentation/DESIGN.md
    repository layout, ownership, dependencies
        ↓
<ownership boundary>/ARCHITECTURE.md
    internal components, APIs, invariants, tests
        ↓
README.md
    implemented usage and commands
```

Cross-boundaryな選択理由は`docs/decisions/`のADRへ置く。`ARCHITECTURE.md`はprompt historyや実装手順ではなく、そのdirectoryを単独で理解するためのcurrent / target boundaryを記述する。

### 10.1 Planned `ARCHITECTURE.md`

実装開始時に次の境界へ追加または既存文書を更新する。

```text
packages/contracts/ARCHITECTURE.md
packages/presentation-core/ARCHITECTURE.md
packages/presentation-authoring/ARCHITECTURE.md
packages/presentation-components/ARCHITECTURE.md
packages/presentation-renderer-api/ARCHITECTURE.md
packages/presentation-renderer-web/ARCHITECTURE.md
packages/presentation-assets/ARCHITECTURE.md
packages/presentation-compiler/ARCHITECTURE.md
packages/presentation-cli/ARCHITECTURE.md
app/web/ARCHITECTURE.md
app/server/control-plane/ARCHITECTURE.md
app/server/realtime/ARCHITECTURE.md
app/server/integration/ARCHITECTURE.md
app/unity/ARCHITECTURE.md
```

`src/validation/`や`src/cache/`など、同じpackageの内部directoryすべてに`ARCHITECTURE.md`を置かない。独立した公開境界、別runtime、別言語、別品質ゲートへ分割された場合にだけ追加する。

## 11. Implementation order

Directoryとpackageは次の順序で実装を開始する。

1. `packages/contracts/presentation`の最小serialized contract
2. `presentation-core`
3. `presentation-authoring`
4. `presentation-renderer-api`
5. `presentation-components`の最小Primitive
6. `presentation-assets`のTextureに必要な最小処理
7. `presentation-compiler`
8. `presentation-renderer-web`
9. `presentation-cli`
10. `examples/presentation`
11. `packages/contracts`のDelivery / Runtime拡張
12. Control Plane Build / Release / Delivery
13. Realtime Progression / Runtime protocol
14. Unity Presentation Runtime
15. Web Editor integration

最初のmilestoneは、手書きのreference Authoring Projectから、CLIを通じてcanonical PresentationDefinition JSONと一つのbaked-web Surfaceを含むRenderBundleをdeterministicに生成することとする。Publish、Realtime、Unity、GUI editingはこのmilestoneの完了条件に含めない。

## 12. Deferred decisions

次は各packageの`ARCHITECTURE.md`または別ADRで決める。

- Semantic contract sourceに使用するschema libraryとJSON Schema generation方法
- Lossless Syntax Treeとsource patchingの実装
- Authoring sandboxのprocess / isolate方式
- Component package distributionと`unframe.lock`の形式
- Compiler plugin discoveryとversion negotiation
- Browser capture processの分離方法
- Native UI、Video renderer packageの追加時期
- CLIのlocal preview runtime
- Web EditorからLocal Compilerを呼ぶexecution topology
- Release、Delivery、Runtime Protobufの具体schema
- generated C# artifactをUnityへ組み込む方法

これらを決める際も、本書のownershipと禁止依存を変更する場合は、先に本書と必要なADRを更新する。
