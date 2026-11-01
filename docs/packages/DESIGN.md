# Unframe Presentation Implementation Design

- **Status**: Draft
- **Date**: 2026-08-28
- **Scope**: Presentation authoring、compiler、renderer、publication、delivery、runtime を実装するための repository layout と ownership
- **Related**:
  - [Presentation Architecture](./ARCHITECTURE.md)
  - [Repository Architecture](../../ARCHITECTURE.md)
  - [ADR-0014: Presentation の描画方式を限定する](../decisions/0014-presentation-rendering-scope.md)
  - [M3A Structured Authoring Contract](./AUTHORING_CONTRACT.md)

[ADR-0027](../decisions/0027-presenter-recognition-and-runtime-authority.md) の Presenter 認識・入力世代・Pause・Step 開始状態復元は採用後の実装設計である。[v3 契約](./CONTRACT_PRESENTER_AUTHORITY.md) と生成物は更新したが、以下の責務追加の実行側 consumer は未移行である。

具体的な成果物・配信・Runtime のデータ契約は [Presentation v2](./DATA_MODEL.md) を正本とする。本書は実装配置と責務を説明する。

Theme と Structured composition の M3A 範囲、解決順、拒否条件は [M3A Structured Authoring Contract](./AUTHORING_CONTRACT.md) を正本とする。M3A は static `baked-web` の v2 縦断接続であり、Runtime / Delivery 接続や v1 互換出力は含めない。

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

この原則は package / directory の ownership boundary に対するものであり、package 内の責務別 module を単一ファイルへ畳み込む根拠にはしない。実装開始時点で contract-derived type、runtime schema、semantic validation、canonicalization などの変更理由が異なる場合は、public `index.ts` を export barrel とし、型・schema・validator を owning responsibility の近くへ分離する。逆に、単一の小さな value object のためだけに空階層や全 package 共通の巨大な `types.ts` は作らない。

実装前に責務をレビューする必要がある Target package は、`Proposal / Target, not implemented` と明記した `ARCHITECTURE.md` だけを先行して置ける。この directory は `package.json`、public entrypoint、workspace package を持つまでは実装済み package とみなさない。

### 2.2 Package は実行環境をまたいで implementation を共有しない

TypeScript package を Go Realtime や Unity C# から直接利用しない。複数言語間では JSON Schema、OpenAPI、Protocol Buffers、fixture などの contract artifact を共有する。

TypeScript 内では、Web、Compiler、Control Plane が pure な Presentation model と validation を共有できる。ただし React、Node.js、Browser、Cloudflare Workers の runtime object を共有 model に持ち込まない。

### 2.3 Concrete runtime から contract を逆流させない

- Local Editor の UI state を Semantic Authoring IR の正本にしない。
- Compiler の cache や Browser object を PresentationDefinition に入れない。
- Control Plane の D1 / R2 representation を Presentation contract にしない。
- Realtime の Go implementation detail を Runtime wire contract にしない。
- Unity の GameObject、Material、Texture を DeliveryManifest に入れない。

### 2.4 Public entrypoint と implementation library を分離する

CLI は compiler orchestration の利用者向け entrypoint とし、compile logic を所有しない。Nix、CI、repository script は CLI または package task を呼び出す薄い wrapper とし、Presentation domain logic を持たない。

### 2.5 Current と Target を混在させない

本書に記載する新規 directory は Target layout であり、現在すべて存在することを意味しない。既存の Control Plane Draft schema と Local Editor の canonical Definition は別の編集境界である。Current の入口は `docs/packages/`、品質ゲートは `scripts/ci/` にあり、下の `docs/presentation/` / `scripts/presentation/` は配置案である。現行 package には Style 変換の `unframe-tailwind` と共通隔離の `unframe-worker-host` もある。

### 2.6 Initial dependency baseline

最初の Presentation package chain では、外部依存の責務を次のように固定する。

- portable Presentation contract は Zod 4 schema を正本とし、TypeScript 型を推論し、JSON Schema Draft 2020-12 を生成する。JSON Schema は別の手書き正本にしない。
- Presentation TypeScript packageのruntime trust boundaryは、構造、scalar、tuple、enum、local cross-field constraintをZod 4で検証する。公開型は可能な限りschemaから推論し、同じshapeを手書きtype guardとZodへ二重定義しない。Zodを使わない`typeof`、`Array.isArray`、`Object.keys`等の直接shape validationは原則禁止する。
- caller-owned object、plugin output、host callbackをZodへ直接渡さない。accessor、Proxy、sparse array、symbol、cycle、prototype、typed-array ownershipを扱うdescriptor-safe snapshot / copyを先に行い、再構築したdataだけをZodへ渡す。この安全化処理と、参照解決、重複、tree cycle、byte arithmetic、determinism、複数artifact間の一致などのalgorithmic semantic invariantは手書きで保持できるが、Zodが表現するlocal shape validationとは分離する。
- semantic canonicalization は RFC 8785 実装の `canonicalize`、content hash は `@noble/hashes` を使う。Presentation 固有の set 正規化は Core が直列化前に行う。
- Authoring TS / TSX の構文解析は固定 version の classic TypeScript Compiler API を直接使う。`ts-morph` と TypeScript 7 `unstable/sync` は初期の pure parser boundary に追加しない。
- Opaque renderer source の bundle は Rolldown の programmatic API と固定内部 plugin を使う。任意 plugin、Node API、network import、package 外参照は受け入れず、Browser execution / capture は固定 Browser と OS 別 worker-host に接続済みであり、追加の platform 別検証は ADR-0026 に従う。
- user-facing TUI は Bun runtime、`@opentui/core`、`@opentui/solid`、`@opentui/keymap`、Solid を使う。pnpm は package manager と lockfile 管理を継続し、headless API は native TUI import から分離する。
- Control Plane HTTP API は現行どおり Hono / OpenAPIHono を application boundary とする。Presentation package から Hono へ依存しない。

これらは各 package の内部責務を代替しない。依存 library へ渡す前後の trust boundary、determinism、capability allowlist、diagnostics は owning package が保持する。

## 3. Target repository layout

```text
unframe/
├─ app/
│  ├─ local-editor/
│  │  └─ src/features/editor/                 # GUI authoring integration
│  ├─ server/
│  │  ├─ control-plane/
│  │  │  └─ src/modules/
│  │  │     ├─ presentation-builds/           # build receipt and validation
│  │  │     ├─ publications/                  # current published execution and active-use lock
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
│  └─ unframe/                                # workspace packages and remaining modules
│     ├─ presentation/                       # resolved presentation model
│     ├─ artifacts/ / playback/ / delivery/  # artifact, runtime, and delivery rules
│     ├─ authoring/                          # authoring SDK and standard components
│     ├─ source/                             # fixed Source analysis and patching
│     ├─ renderer-api/                       # renderer boundary
│     ├─ renderer-web/                       # baked-web build implementation
│     ├─ assets/                             # deterministic asset transforms
│     ├─ compiler/                           # compiler pipeline library
│     ├─ worker-host/                        # isolated worker execution
│     ├─ tailwind/                           # style transforms
│     └─ cli/                                # user-facing executable
├─ scripts/
│  └─ presentation/                           # Nix and CI wrappers only
└─ docs/
   ├─ presentation/
   │  ├─ ARCHITECTURE.md                     # semantic and system architecture
   │  └─ DESIGN.md                           # this implementation ownership design
   └─ decisions/                              # cross-boundary decisions and rationale
```

Target implementation directory は担当実装を開始する時点で追加する。責務レビュー用の `ARCHITECTURE.md` を除き、empty placeholder、空の `package.json`、将来用の `src/` は先行して作らない。

## 4. Shared module responsibilities

`packages/unframe/` の Presentation、Artifacts、Playback、Delivery、Authoring、Source、Compiler は独立 workspace package として実装する。残るモジュールの分離順序は [独立パッケージ化計画](../plans/unframe-independent-packages.md) を参照する。

### 4.1 Presentation と実行時の純粋処理

`@unframe/presentation` は解決済みモデルと意味検証、`@unframe/artifacts` は成果物の整合性、`@unframe/playback` は再生状態、`@unframe/delivery` は配信計画を所有する。

### 4.2 `packages/unframe/authoring`

`@unframe/authoring` は宣言 schema、DSL、JSX と標準 Component・Theme を所有する。Source の静的解析は `@unframe/source` が担当する。

**Responsibilities**

- `definePresentation`
- `defineTheme`とTheme Declaration
- Presentation Orchestrator の制限付き JSX / DSL
- Component Manifest authoring API
- Props、Slots、Parts、Variants、States、Actions、Outputs の builder
- Theme、Token、Asset reference の authoring API
- Compiler が静的に認識する authoring declaration signature
- Stable ID、source metadata、Component Instance のauthoring operation
- Structured / Opaque Component の公開境界
- Semantic Command と source patching が共有する authoring operation

**Non-responsibilities**

- Authoring Source の parse、typecheck、static AST lowering
- Opaque renderer source の bundle と実行
- renderer artifact の生成
- project filesystem と cache
- Local Editor UI
- Control Plane persistence
- Runtime progression evaluation

このパッケージは `@unframe/presentation` の型と Zod に依存する。Compiler や Local Editor へ逆依存しない。

### 4.3 標準 Component

`@unframe/authoring/components` は標準 Surface の Manifest・構造と標準 Theme を公開する。

### 4.4 `packages/unframe/renderer-api`

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

Renderer API は Presentation と Zod、および Compiler が所有する描画計画・Renderer Identity の契約に依存する。concrete renderer 同士は依存しない。

### 4.5 `packages/unframe/renderer-web`

`baked-web` renderer と、固定 Browser 環境での capture を所有する。

**Responsibilities**

- Structured Component から lower された Primitive graph の generic Web rendering
- Opaque Component web renderer entry の bundle と実行
- Browser lifecycle と fixed rendering environment
- Surface State ごとの layout と capture
- Compiler が渡した partition geometry の描画
- pixel size、color space、alpha modeを持つ未encodeのSurface capture生成
- Browser、font、locale、timezone、layoutのrenderer provenance
- visual regression fixture

**Non-responsibilities**

- PresentationDefinition の意味変更
- Component Manifest からの semantic information 推測
- Structured Component 固有の React / CSS implementation
- Asset upload とSigned URL
- Unity rendering
- Native UI、Video renderer の実装

このモジュール は `unframe-core`、`unframe-renderer-api`、`unframe-worker-host` に依存する。capture 結果の encode / checksum は CLI の Build 実行が `unframe-assets` へ委譲し、指定 pixelTarget へ直接 capture して resize を行わない。Compiler は Renderer を実行しない。

Native UI と Video renderer は、実装開始時にそれぞれ独立 package として追加する。`unframe-renderer-web` に仮実装を置かない。`embedded-web`、WebView、任意の Runtime HTML / JavaScript renderer package は追加しない。

### 4.6 `packages/unframe/assets`

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

OS toolやcodec依存はこのモジュールかそのadapterに閉じ込め、`unframe-core`へ持ち込まない。

`unframe-renderer-web` は Browser 上の描画と capture 条件を所有する。Structured Frame / Text の Hit Region は Compiler が Surface 全体の layout から解決し、画像 partition から独立させる（[ADR-0021](../decisions/0021-surface-interaction-geometry.md)）。Semantic Tree の意味は Structured Component では Structure、Opaque Component では Manifest の `semantics` から Compiler が生成し、Browser DOM から抽出しない。`unframe-assets`はcapture後のbinary変換を所有する。Control Planeはupload後のownershipとR2 lifecycle、Unityはdownload後のruntime cacheを所有する。

このモジュールはartifact descriptorとdiagnosticsの型に限って`unframe-core`へ依存する。

### 4.7 Source と Compiler

`@unframe/source` は固定 Source の静的解析、宣言と位置情報、前提付き編集 patch を所有する。TypeScript の標準ライブラリを含む解析入力は呼び出し側が固定する。

`@unframe/compiler` は宣言と素材情報から Presentation を解決し、Render Plan と Media Plan を生成する。描画、素材変換、成果物の生成は呼び出し側が担当する。

### 4.8 `packages/unframe/cli`

Authoring Projectを操作する利用者向け executable と、automation 向け headless application boundary を所有する。

**Responsibilities**

- Bun / OpenTUI Solid による interactive command selection と terminal lifecycle
- native TUI に依存しない headless `check` / `build` API
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
- durable PublishedPresentation state、publicationEpoch、active-use lock

CLI は Compiler、既定 Web Renderer、Core、Contracts、Tailwind、worker-host の公開 API に依存する。CLI は project の固定 Node graph と Style 変換の準備、Tailwind は PostCSS 処理、worker-host は Style / capture 共通の隔離・資源制限・終了確認を所有する。Browser の配置と起動は Web Renderer に残す。TUI adapter は Bun と OpenTUI stack に閉じ、headless root export から Zig native core を読み込まない。CLIからpackage内部の非公開moduleをimportしない。

Current implementation は headless `init` / `check` / `build` / `test` / `lock` と process `author` / `dev` / `preview` / `publish` を持ち、TUI から process command に接続する。lock の schemaVersion 1、Source patch、固定 Browser の Opaque 隔離 capture、build cache と atomic output、Local Editor と Unity Preview の Dev / Dist 経路を実装済みである。

## 5. Contract and generated artifact ownership

### 5.1 `packages/contracts`

`packages/contracts` はapplicationと言語の境界を越えるserialized artifactとwire contractのsource of truthを所有する。

```text
packages/contracts/
├─ src/presentation/          手書き Zod schema と推論型
├─ presentation/              生成 JSON Schema / descriptor / fixtures
└─ proto/unframe/
   ├─ presentation/runtime.proto
   ├─ delivery/delivery.proto
   └─ realtime/realtime.proto
```

- PresentationDefinitionとRenderBundleのserialized shapeは`packages/contracts/src/presentation/`をsource of truthとする。
- `unframe-core`はcontractから生成または導出したTypeScript modelを使用し、serialized fieldを独自に再定義しない。
- `unframe-core`は、portable structural schemaだけでは表せないreference validation、semantic invariant、canonicalizationを所有する。
- DeliveryManifest、Reliable Event、ConnectionSnapshotEnvelope、DurableCheckpointEnvelope、State Streamなどのwire sourceは`packages/contracts/proto/`に置く。CanonicalRuntimeSnapshot は renderer、participant、connection、transport、serialization format から独立した semantic model とし、用途別 envelope の内側へ encode する。
- OpenAPIはControl Plane route contractから生成する。
- generated fileは手編集しない。
- source schemaとgenerated artifactのdriftをCIで検証する。
- schemaから生成したfixtureをGo、C#、TypeScript consumerのconformance testで共有する。
- Go Protobuf は `app/server/realtime/internal/gen/`、独立 C# client artifact は `packages/api-client-csharp/` に生成する。Unity 用は同じ正本から [`generate-unity-proto.sh`](../../scripts/contracts/generate-unity-proto.sh) が `.proto` コピーと `app/unity/Assets/Scripts/PresentationRuntime/Generated/` を直接生成し、drift を検査する。

依存方向は `packages/contracts` の手書き Zod schema と推論型を `unframe-core` が利用する向きに固定する。JSON Schema / descriptor は生成物であり、Protobuf 由来の wire 型とは区別する。`packages/contracts`のgeneratorは`unframe-core`をimportしない。これによりserialized contractとsemantic implementationの循環したsource of truthを避ける。

### 5.2 `packages/api-client-csharp`

OpenAPIとProtocol Buffersから生成したC# artifactを所有する。Unity固有のGameObject adapter、renderer、cacheは含めない。Unity の Presentation wire bindings は同一 Protobuf 正本から Unity へ直接生成する。独立 client package を Unity へコピーする経路ではない。Unity-owned adapter はその外側に実装する。

## 6. Application-owned responsibilities

### 6.1 `app/web/local-editor/src/features/editor`

- Semantic Authoring IRのGUI projection
- Semantic Command、selection、history、temporary interaction state
- Inspector、Scene、Surface、Flow、Theme editing
- Source Mapを介したCode / GUI同期
- Compiler diagnosticsとpreviewの表示
- Draft保存、revision conflict、build / publish UI

Local EditorはCompiler Core、Opaque rendererのBrowser実行環境、renderer artifact generationを所有しない。Node-only Compiler を browser bundle へ取り込まず、現行 Local Editor は native CLI Author host の認証付き HTTP API と接続する。

### 6.2 `app/server/control-plane`

次の application module は実装済みである。waiting expiry / owner cancel を含む全 publication policy の目標と現在の保証は各 module の仕様・テストで区別する。

- `presentation-builds`: Compiler成果物のreceipt、schema/hash/Asset検証
- `publications`: Definition、RenderBundle、Asset Set、contract versionを束ねる単一のPublishedPresentation、publicationEpoch、非終了Session中のpublish lock
- `delivery`: projection contract version / role / capabilityごとに共有するProjectionProfileDescriptor、Surface Stateごとのrenderer選択、participant / assignment固有のProjectionInstanceとDeliveryManifest

Control PlaneはAuthoring Source、TSX、React、renderer implementationを実行しない。既存`src/presentation/`のDefinition CRUDは、Draft / Build / Publication migrationが決まるまで自動的に移動しない。

`publications`はSession作成とpublishを同じ永続化境界で直列化する。Session作成は現在のPublicationFenceをコピーし、有限の`waitingExpiresAt`とともにSessionへ保存する。同じPresentationを参照する期限内の`Waiting` Session、または`Presenting` Sessionが存在する場合はpublishを拒否する。Presentation owner / adminは`Waiting` Sessionをcancelでき、publish判定は期限切れWaiting Sessionを同じ永続化境界で`Ended`にしてからactive-use lockを確認する。`Presenting`はwaiting expiryで終了しない。publishは [ADR-0025](../decisions/0025-local-editor-unity-preview.md) に従い、表示確認済みの固定 Dist のbuild identity、artifact hash、Asset readiness、認可と期待PublicationFence（初回は未公開）を検証する。公開先の現在値との一致を同じ永続化境界で確認してpublicationEpochを増やし、現在値をatomicに置き換える。CP Draft revisionと最新ローカルSource revisionの一致は要求しない。過去のPublishedPresentationを選択可能な履歴として保持しない。

### 6.3 `app/server/realtime`

- `internal/session`: renderer-independentなGo progression、pause-aware logical clock、Step execution、Runtime Run、Shared Runtime State、入力世代と重複排除 outcome、凍結 Anchor 表示、Step 開始履歴 / 復元、Canonical Runtime Snapshot の immutable cut
- `internal/protocol`: generated wire typeからvalidated core inputへのmapping、認証済み connection identity からの actor 解決、Presenter 認識イベントの Step / 入場世代 / 入力世代の検証
- `internal/runtimecore`: assignment、transport、session、persistence adapterのcomposition、Participant Runtime View生成、ConnectionSnapshotEnvelope / DurableCheckpointEnvelope の構築

Realtime は client payload から actor、role、subject を受け取らず、認証済み connection と内部 evaluator から canonical event を構成する。System actor は Runtime 内部だけが生成し、participant identity と role の検証前に progression input として受理しない。session critical section は canonical state の更新、immutable cut、Reliable Event 購読登録だけを担い、participant projection、serialization、compression、hashing、network write、persistence callback は lock 外で immutable cut を入力に実行する。

Connection presence は ConnectionSnapshotEnvelope にだけ含める。raw Pose sample / 履歴と client の認識内部状態は durable restore 対象から除外するが、Pause 時の凍結 Anchor 表示、到達済み `(groupId, stepId)` ごとの直近開始履歴、入力世代は共有状態として保存する。participant ごとの入力 ID・fingerprint・outcome は既存の RuntimeRecoveryMetadata に保持し、canonical state と同じ cut で永続化する。Step 開始履歴は inactive Group の実行状態と分離し、Viewer へ全履歴を配布しない。DurableCheckpointEnvelope は assignment、PublicationFence、artifact hash、contract hash を fence し、CanonicalRuntimeSnapshot と RuntimeRecoveryMetadata の serialized payload をそれぞれ保存する。

Runtime は Gesture / Zone を再認識せず、認証済み Presenter の独立イベントを受理順に評価する。結果再送は現在の Step 判定より先に保存済み outcome を返し、上限前の状態同期・新世代確認・client 旧 queue 破棄を行ってから記録を整理する。Step 復元は paused で確定し、保存位置から Run を新 ID と必要な owner epoch へ rebase する。時計、配信連番、採番、重複排除、認証、校正は巻き戻さない。

既存の`internal/session`と`internal/runtimecore`を拡張し、同じ責務のために新しいtop-level `progression` packageを並立させない。Go progressionはTypeScript implementationを移植して共有したことにせず、contract fixtureとconformance testにより、Compiler validation、Realtime evaluation、Unity consumerの意味を一致させる。

### 6.4 `app/unity/Assets/Scripts/PresentationRuntime`

- DeliveryManifestの検証とruntime renderer graph構築
- Asset download、checksum、cache、preload、eviction
- native-3d、baked-web、native-ui、videoのUnity adapter
- SnapshotとReliable Eventの適用
- Projected Runtime Snapshot / Event / State Frameのprofile・assignment fence検証
- ConnectionSnapshotEnvelopeだけを再接続入力として適用し、DurableCheckpointEnvelopeをclientへ配信しない
- Timelineのlocal interpolation
- Presenter client 内の8種類 Gesture と腰位置による2m Zone 出入りの認識、device input から成立イベントへの変換
- 認識開始時の Step / 入場世代 / server 入力世代への拘束、世代変更時の途中認識と旧 queue 破棄、Zone の無通知 seed
- 認識とは独立した latest-wins Pose 送信、Pause の凍結表示と resume 後の fresh Pose 待ち
- calibration、viewport、selection、personal annotation、Local Overlay stateのClient-local ownership
- Realtime接続、reconnect、state convergence

Gesture の閾値・時間窓・終了判定と Zone 境界の揺れ対策は client 内部の調整値に閉じる。Definition は Gesture 種類と Zone 中心を宣言し、client が Cue や共有状態を指定しない。server cooldown と同時認識 batch は持たない。詳細な座標基準・失効条件・復旧規則は ADR-0027 と [Presentation Architecture §12](./ARCHITECTURE.md#12-v1-presentation-progression-の意味論) に従う。

Unity の配信・実行は v2 consumer に統一する。旧 `PresentationImport/` と v1 JSON サンプルは廃止し、互換 importer は設けない。

### 6.5 `app/server/integration`

Control Plane、Realtime、generated contract、reference clientを接続するbackend E2Eを所有する。Browser UIやUnity visual testは所有しない。

## 7. Dependency direction

Contract generationは次の一方向とする。

```text
packages/contracts source
├─ handwritten Zod / inferred TypeScript → unframe-core / Control Plane
├─ generate → JSON Schema / descriptor / fixtures
├─ Protobuf → Go contract         → Realtime
├─ Protobuf → C# contract         → packages/api-client-csharp
└─ Protobuf → Unity C# bindings   → Unity Generated/
```

独立パッケージの依存方向と残る移行先は [独立パッケージ化計画](../plans/unframe-independent-packages.md) を参照する。Compiler は concrete renderer に依存せず、Source は固定入力を解析する。

## 8. Standard package layout

各新規TypeScript packageは、必要になった範囲で次の形を使用する。実装前は責務レビュー用の `ARCHITECTURE.md` だけが存在してよい。

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

移行済みの `packages/unframe/*` の各責務は独立 workspace package として管理する。

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
├─ .unframe/          # build cache / generations / Author state
└─ dist/
```

この`presentation/`は利用者のproject root例であり、Unframe monorepoのimplementation package rootには使用しない。実 CLI 用の検証 Project は独立パッケージ化計画の配布段階で用意する。

- `.unframe/cache/` は再生成可能な build cache である。`.unframe/authoring/` の receipt / journal は保存・回復状態であり、cache と同じ規則で削除しない。
- `dist/` は Build の成果物であり Authoring Source ではない。
- `unframe.lock` の schemaVersion は 1 であり、現行の読込と検証は CLI が所有する。
- reference projectはproduction用の隠れたdefault contractにせず、公開fixtureとして検証する。

## 10. Documentation hierarchy

```text
docs/packages/ARCHITECTURE.md
    semantic model and system-wide boundaries
        ↓
docs/packages/DESIGN.md
    repository layout, ownership, dependencies
        ↓
<ownership boundary>/ARCHITECTURE.md
    internal components, APIs, invariants, tests
        ↓
README.md
    implemented usage and commands
```

Cross-boundaryな選択理由は`docs/decisions/`のADRへ置く。`ARCHITECTURE.md`はprompt historyや実装手順ではなく、そのdirectoryを単独で理解するためのcurrent / target boundaryを記述する。

## 11. Implementation order

移行順序と受け入れ条件は [独立パッケージ化計画](../plans/unframe-independent-packages.md) を参照する。

## 12. Deferred decisions

次は各packageの`ARCHITECTURE.md`または別ADRで決める。

- Cue、Theme、Token、Named Styleを含む完全版Semantic contractのschema設計
- Component package の外部配布と更新方針
- Compiler plugin discoveryとversion negotiation
- Native UI、Video renderer packageの追加時期
- platform ごとの追加 visual baseline と実機受け入れ

これらを決める際も、本書のownershipと禁止依存を変更する場合は、先に本書と必要なADRを更新する。
