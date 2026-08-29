# Presentation Packages Implementation Plan

- **Status**: Active
- **Date**: 2026-08-29
- **Scope**: `packages/` に存在する Presentation 関連 package、共有 contract、生成 client、repository tooling
- **Architecture source**:
  - [Presentation Architecture](../presentation/ARCHITECTURE.md)
  - [Presentation Implementation Design](../presentation/DESIGN.md)
  - [ADR-0006](../decisions/0006-presentation-rendering-strategy.md)

## 1. 目的

現在の `packages/` は、Presentation package chain の初期 subset まで実装済みである。一方で、Authoring Source から実際の build artifact を生成する一貫経路、完全版の Semantic / Runtime contract、Delivery、C# generation は未完成である。

本計画は、未実装事項を package ごとの独立した TODO として消化するのではなく、各段階で利用可能な結果を残す縦断的な milestone として整理する。

この文書は実装順と完了条件を示す計画であり、型、wire field、budget、generator などの未決定事項を新たに確定する設計文書ではない。設計上の正本は上記 Architecture、Design、ADR、および各 package の `ARCHITECTURE.md` とする。

## 2. 現在地

Presentation Implementation Design が定義する初期実装順のうち、`packages/contracts/presentation` から `presentation-cli` までの初期 subset は実装済みである。ただし、次の分断が残っている。

```text
presentation.unframe.tsx
        ↓ 未接続: module / symbol resolution、typecheck、AST lowering
post-lowering PresentationDeclaration
        ↓ 実装済み: initial static subset の検証と lowering
PresentationDefinition
        ↓ 実装済み: injected renderer による初期 build
RenderBundle + PNG
        ↓ 未接続: 実 Browser、real filesystem、cache、publish / delivery
consumer
```

### 2.1 Package inventory

| Package                              | Current                                                                                                 | 主な未実装                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts`                 | Control Plane OpenAPI、PresentationDefinition / baked-web RenderBundle 初期 schema、Realtime foundation | Cue / Trigger / Action / Timeline、DeliveryManifest、Snapshot / State Stream、完全な Runtime contract、cross-language fixture |
| `packages/api-client-csharp`         | 生成先の責務を定義した placeholder                                                                      | OpenAPI / Protobuf generator、C# artifact、compile / test、drift check、Unity 接続                                            |
| `packages/api-client-typescript`     | Hono RPC と Better Auth client                                                                          | Presentation CLI の publish adapter との接続。README の依存 version 記述の同期                                                |
| `packages/presentation-core`         | 初期 Definition / RenderBundle 検証、Semantic Tree materialization、canonical JSON / hash               | Cue / Action / Timeline、Projection、Runtime Snapshot、migration、完全な lifetime / visibility closure                        |
| `packages/presentation-authoring`    | Manifest、Structure、Theme、Presentation declaration API                                                | Static DSL の確定、Source との接続、Lossless Syntax Tree / source patch、lock / distribution                                  |
| `packages/presentation-components`   | static な標準 Surface / Frame / Text                                                                    | Props / Slots / Variants、型付き Theme、Spatial、Interaction、Action / Output、Opaque component、migration                    |
| `packages/presentation-compiler`     | TS / TSX 構文解析、post-lowering declaration の check / build                                           | project resolution、typecheck、AST lowering、normalization、cache、Source からの compile                                      |
| `packages/presentation-renderer-api` | baked-web 初期 plugin contract と conformance harness                                                   | discovery / version negotiation、cancel / timeout / resource budget、Native UI / Video capability                             |
| `packages/presentation-renderer-web` | injected Browser adapter による Frame / Text capture、Opaque bundle                                     | 実 Browser lifecycle、Opaque execution / isolation、state variation、generic Primitive、interaction geometry                  |
| `packages/presentation-assets`       | deterministic memory-only PNG encoder                                                                   | resize、mipmap、font subset、video / model adapter、temporary workspace、cache                                                |
| `packages/presentation-cli`          | injected host の headless check / build、TUI command selector                                           | filesystem / Browser host、atomic output、config / lock、watch / dev / preview / test / publish                               |
| `packages/config`                    | TypeScript 基底設定、Vite+ 設定、Git hooks                                                              | `pre-commit` と `vp staged` の接続、package check / test、共有 lint / formatter policy、CI filter 整備                        |

## 3. 実装原則

### 3.1 縦断スライスで進める

Semantic 機能は、原則として次の依存順を一つの変更系列として実装する。

```text
contracts
  → presentation-core
  → presentation-authoring
  → presentation-components
  → presentation-compiler
  → renderer / assets
  → CLI / reference project
```

ある package だけに将来用の field や仮実装を追加しない。現在対応しない入力は stable diagnostic で明示的に拒否する。

### 3.2 Contract と application の責務を混在させない

次は package の実装計画には含めず、package contract 完成後の application-owned work とする。

- Control Plane の Build / Publication / Delivery persistence
- Realtime の authoritative progression evaluator
- Unity の renderer graph、asset cache、reconnect lifecycle
- Web Editor の GUI authoring integration

### 3.3 Current と Target を区別する

初期 subset の成功を Target architecture 全体の完成として扱わない。README は利用可能な Current behavior を記載し、Target / Deferred は `ARCHITECTURE.md` と本計画に残す。

### 3.4 TDD と品質ゲート

各スライスは Explore → Red → Green → Refactor で進める。作業途中では対象 package の check を実行し、予定した変更をすべて終えた後に repository-wide gate を実行する。

## 4. Milestone 0: 品質基盤の補修

### 目的

以降の package 変更に対し、drift、生成漏れ、hook の未接続、CI path filter 漏れを確実に検出できる状態を作る。

### 実装項目

1. Git hook の ownership を Vite+ dispatcher または repository-owned hooks のどちらかへ一本化する。
2. `pre-commit` から対象を限定した `vp staged` を実行する。
3. `packages/config` に hook fixture、設定解決 test、`check` script を追加する。
4. 共有 oxc lint / formatter policy と runtime 別 TypeScript config の必要性を確定する。
5. `packages/contracts` の typecheck / lint 対象を実在 source と全 generator に合わせる。
6. `packages/api-client-csharp/**`、共有 scripts、Presentation Autofix の CI path filter を追加する。
7. Git LFS hook が要求する toolchain を Nix environment と一致させる。

### 完了条件

- `packages/config` の単独 check が成功する。
- staged file に対して formatter / lint が実際に起動することを fixture で検証できる。
- Contracts source、generator、generated artifact の drift を CI が検出する。
- package または共有 script のみを変更した場合も、必要な CI job が起動する。

### 完了記録（2026-08-29）

- repository-owned `pre-commit` から実共有設定の `vp staged` を起動し、staged TypeScriptを整形するfixtureを追加した。
- 共有TypeScript baseをES-onlyにし、DOMを必要とするconsumerだけが`lib`を明示する境界へ変更した。これに伴い、Coreのambient runtime global依存をpure implementationへ置換した。
- Contractsの全source / generator / testをtypecheck・lint対象にし、既存のOpenAPI / Presentation drift checkを維持した。
- `packages/config`、共有script、Presentation Autofix、C# client、Git LFS toolchainのCI / Nix到達性を補修した。
- `pnpm --filter @unframe/config check`、`pnpm --filter @unframe/contracts check`、`nix run .#presentation`、Control Plane / Webの対象typecheck、`nix flake check`が成功した。
- 独立再レビューでcorrectness、security、data loss、contract drift、Architectureに関する確認済みの未対応blockerがないことを確認した。

## 5. Milestone 1: Local Compiler の最初の完成形

### 目的

`.unframe.tsx` から deterministic な PresentationDefinition、RenderBundle、PNG Asset Set を生成する最初の実用可能な縦断経路を完成させる。

### 5.1 Reference Authoring Project

- `examples/presentation/` に最小の `presentation.unframe.tsx`、Theme、Component、config、lock fixture を置く。
- reference project を production の暗黙 default にせず、公開された acceptance fixture として扱う。
- Source、Definition、RenderBundle、PNG の golden expectation を分離する。

### 5.2 Compiler source frontend

- 明示的な project root と virtual filesystem input を定義する。
- module / symbol resolution と TypeScript typecheck を実装する。
- Static Authoring DSL の許可構文を検証する。
- AST から Declaration Graph へ context-specific lowering する。
- Source Map と stable source diagnostic を保持する。
- Declaration Graph を現行の post-lowering `PresentationDeclaration` 相当へ normalize する。
- Orchestrator、Theme、Manifest、Structure を実行しないことを回帰テストで保証する。

### 5.3 Fixed Browser build

- Browser binary と version の provisioning 方針を決定する。
- process lifecycle、fixed locale / timezone / font / viewport / color space を adapter に固定する。
- network、filesystem、clock、randomness を既定 deny にする。
- 現行 Frame / Text subset を実 Browser で capture する。
- Browser identity と environment を renderer fingerprint、cache key、RenderBundle provenance に結合する。

### 5.4 CLI filesystem boundary

- project discovery、`unframe.config.ts`、`unframe.lock` の読取り境界を実装する。
- `check` は Browser を起動せず Source frontend まで検証する。
- `build` は一時 staging directory へ完全な artifact set を生成し、成功時だけ atomic に置き換える。
- signal、Browser cleanup、失敗時の partial output 非公開を検証する。

### 5.5 実装進捗と未決定事項

2026-08-29 時点で、Compiler source frontend のうち次を実装済みである。

- logical project root と root-relative TS / TSX / declaration file の safe snapshot、syntax diagnostic
- locked virtual package の identity、file、exact export、direct dependency 検証
- project / package owner ごとの relative import と direct locked package resolution
- virtual-only strict ES2022 typecheck と owner-aware stable diagnostic
- TypeChecker alias、package identity、exact export、declaration owner に基づく named value symbol provenance
- provenance 検証済み builder import、direct default root、JSON-like expression の Static DSL validation
- builder 実装を実行しない、UTF-16 source origin 付き個別 declaration file の plain Declaration Graph lowering
- builder call を実行しない単一 Declaration Graph の plain declaration value normalization
- normalized JSON path と value / property key / generated field origin を対応させる deterministic sidecar source map
- entry、Theme、Manifest、Structure の file role と root builder を照合する project-wide declaration collection
- package-owned source と補助 `.d.ts` を分離し、全 project file の失敗を集約する canonical diagnostic
- Authoring builder と共有する pure declaration guard による post-lowering validation（builder implementation 非実行）
- Object.prototype / null-prototype の plain data を descriptor-only で snapshot し、inherited getter と Proxy `get` trap を実行しない Compiler input boundary
- Manifest の `authoring.structure` entry を正本に、Presentation、Theme、Component `(componentId, version)`、Structure を source map 付きで決定論的に対応付ける declaration catalog
- parse、typecheck、lower、normalize、collect、pair を接続し、TypeScript内部状態を漏らさず plain catalog または source diagnostic を返す公開 `checkAuthoringProject`

Theme / Component hash、package lock、Asset を含む `CompilerDeclarationProject` assembly は引き続き未実装である。

次は Architecture の deferred decision であり、暫定形式や暗黙 fallback では埋めない。

- serialized `unframe.lock` と Component package distribution / integrity algorithm
- Fixed Browser の process / isolate、binary provisioning、font baseline
- real filesystem の project discovery、config loader、staging / atomic replacement strategy

Static DSL は 2026-08-29 に次の M1 contract で確定した。

- 各 declaration file は対応する public definition builder の直接呼出しを default export する。
- builder 引数は JSON-like literal と provenance 検証済み named builder call だけを許可する。
- JSX、任意関数、loop / branch、dynamic import、property access、spread、template expression、local builder alias は stable diagnostic で拒否する。
- named import alias は元の locked package export provenance を保持する場合に限り許可する。
- JSX-first authoring とより広い static expression は M1 より後へ延期する。

これらに依存しない trust boundary、diagnostic、documentation、review は継続する。Milestone 1 の checklist は、Source から実 Browser artifact までの完了条件を満たすまで未完了のままとする。

### 完了条件

- reference `.unframe.tsx` から CLI で Definition、RenderBundle、PNG を生成できる。
- 同一 toolchain と同一入力を二回 build した artifact hash が一致する。
- Authoring declaration codeを実行せずに buildできる。
- syntax、type、semantic、renderer、I/O の失敗が区別された stable diagnostic になる。
- `nix run .#presentation` と repository-wide `nix run .#check` が成功する。

## 6. Milestone 2: Blocking contract の確定

実装前に、Presentation Architecture が指定する順序で次の contract を一つずつ確定する。

1. [x] Timeline の補間、停止理由、Runtime Run lifecycle の semantic wire contract（[ADR-0007](../decisions/0007-timeline-runtime-run-wire-contract.md)、transport protobuf schema は Draft・未実装）
2. [x] Reliable Event / Snapshot / State Stream の transport schema、保持期間、runtime microstep 上限（[ADR-0008](../decisions/0008-runtime-transport-contract.md)）
3. role 別 Semantic Tree / Hit Region schema
4. Transform、Quaternion、matrix、Unity、Surface / UV の座標規約
5. Surface Partition と author override
6. Texture state artifact 数、GPU / RAM build budget

各項目では、意味、authority、source of truth、wire field、failure、compatibility、consumer の責務まで決める。判断を必要とする次項目へ進む前に、対応する Architecture / ADR を更新する。

### 6.1 Timeline / Runtime Run contract 監査

2026-08-29 時点で、Timeline の補間式、easing、number / Vector3 / Quaternion、Pause / Resume、完了時 commit、`explicitStop` / `groupExit` / `presentationEnded` の停止規則、Runtime Core authority は Architecture に定義済みである。一方、現行 Presentation contract は Timeline catalog を持たず、Realtime Protobuf は Handshake / PageChange foundation だけであるため、wire contract は未実装である。

Timeline catalog、local interpolation、State Stream の非 Timeline 限定、`RuntimeRunId`、lifecycle payload、reason、projection、capability policyは [ADR-0007](../decisions/0007-timeline-runtime-run-wire-contract.md) で semantic wire contract として Accepted とした。transport protobuf schema は Draft・未実装であり、現行 `realtime.proto` は foundation のままである。互換 downgrade fallback は追加しない。

Reliable Event / Snapshot / State Stream の envelope、field number、replay / catch-up / idempotency window、State keyframe、runtime microstep 上限は [ADR-0008](../decisions/0008-runtime-transport-contract.md) で Accepted とした。M2 では設計だけを固定し、現行 foundation proto の置換、Go / C# generation、cross-language fixture は semantic payload が揃う M5 で一括実装する。

次は item 3 の role 別 Semantic Tree / Hit Region schema を確定する。

### 完了条件

- PresentationDefinition、RenderBundle、DeliveryManifest、Runtime State の境界が混在していない。
- TypeScript、Go、C#、Unity のどの consumer が何を検証するかが明記されている。
- unknown field、unknown enum、unsupported version の compatibility policy が定義されている。

## 7. Milestone 3: Semantic contract の拡張

次の順で縦断スライスを追加する。各スライスは Contractsからreference projectまでを同じ変更系列で接続する。

### Slice A: Theme と Structured composition

- Token category、Named Style property schema
- Props / Slots / Parts / Variants の値注入
- nested Structured Primitive
- component package lock、integrity、migration metadata
- generic rendererによるstyle解決

### Slice B: State、Interaction、Hit Region

- State visual variation
- Interaction declaration と enabled interaction
- role別完成Semantic Tree
- normalized Hit Regionとresolved geometry
- renderer captureとsemantic bindingのcompleteness検証

### Slice C: Action、Output、Trigger、Cue

- Component Action / Output からcanonical Action / Triggerへのlowering
- flat Scalar payloadとactor / subject resolution
- Guard、Cue consumption、Step entry rule
- transition-only Cueと空Action列

### Slice D: Timeline とRuntime projection

- Timeline / Runtime Run model
- transition conflict、completion、stop reason
- ProjectionAudience、ProjectionProfile、ParticipantRuntimeView
- CanonicalRuntimeSnapshotのportable fixture

### 完了条件

- 各sliceにvalid / invalid portable fixtureがある。
- ContractsのZod/JSON Schema、Core invariant、Compiler loweringが同じ意味を検証する。
- unsupported featureを拒否する暫定分岐が、そのsliceでは削除されている。
- reference projectで新しい機能をbuildし、deterministic artifactを生成できる。

## 8. Milestone 4: Renderer とAsset pipeline の拡張

### Renderer

- generic Structured Primitive graph
- Opaque React / CSS bundleとisolated Browser executionの接続
- module / capability allowlist
- timeout、cancel、CPU / memory budget
- plugin discovery、version negotiation、cache invalidation
- visual regression baseline

### Assets

- resizeとresolution policy
- mipmap、texture compression、color / alpha conversion
- font resolution、subset、glyph coverage
- temporary workspaceと成功・失敗・cancel時cleanup
- content-addressed cache
- 必要なconsumerが確定した後のvideo / model adapter

### 完了条件

- renderer / font / locale / config変更がcache identityへ反映される。
- Opaque codeがallowlist外のnetwork、filesystem、moduleへアクセスできない。
- raw capture、encoded artifact、descriptor checksumが一致する。
- fixed baselineでvisual regressionを検出できる。

## 9. Milestone 5: Delivery / Runtime contract とC# generation

### 9.1 Protocol Buffers

- `proto/unframe/delivery/v1/delivery.proto`
- DeliveryManifest、ProjectionProfile、ProjectionInstance、AssetAccessBinding
- PublicationFence、assignment、origin version
- Reliable Event、ConnectionSnapshotEnvelope、DurableCheckpointEnvelope
- State Stream / State Frame、Snapshot / Replay / Resume
- capability negotiation

### 9.2 Generated consumers

- Go generated artifactとdrift check
- OpenAPI / Protobuf C# generatorとversion固定
- source contract / generator provenance
- generated namespace / assembly boundary
- standalone C# compile / test
- TypeScript / Go / C# encode / decode conformance fixture
- breaking-change report

### 9.3 Unity handoff

- Unity Package Managerまたはgenerated source配置方式を決定する。
- generated clientをUnity-owned adapterから利用する。
- 既存 `PresentationImport/` はtransitional implementationとして維持し、一括置換しない。

### 完了条件

- Contract sourceからGo/C# artifactを再現可能に生成できる。
- generated artifactの手編集とdriftをCIが検出する。
- shared fixtureをTypeScript、Go、C#で相互運用できる。
- Unity consumerが必要とするfence、projection、asset descriptorの型を失わない。

## 10. Milestone 6: CLI UX とapplication integrationへの接続

### CLI

- `init`、`dev`、`test`、`preview`
- watch / incremental build
- local build cache
- plugin discoveryと`unframe.lock`
- credentialを保持しないControl Plane publish adapter
- TUI command selectionとheadless commandの接続

### Application handoff

- Control Plane Build / Publication / Delivery
- Realtime Progression / Runtime protocol
- Unity Presentation Runtime
- Web EditorからLocal Compilerを呼ぶexecution topology

`publish` commandはControl Plane側のPublication contractとactive-use lockが実装されるまで仮APIを作らない。Web Editor、Realtime、Unityのapplication実装は、それぞれのowning directoryの計画と品質ゲートで進める。

### 完了条件

- local authoring、check、build、previewが同じproject/config/lockを使用する。
- local buildとpublish対象artifactのhashが一致する。
- application integrationがpackage内部moduleへdeep importしない。

## 11. 横断的な検証戦略

| 境界                               | 必須検証                                                         |
| ---------------------------------- | ---------------------------------------------------------------- |
| Contract source → generated schema | drift check、valid / invalid fixture、compatibility check        |
| Contract → Core                    | reference、tree、lifetime、canonicalization、diagnostic ordering |
| Source → Compiler                  | syntax、symbol、type、forbidden DSL、source map、非実行保証      |
| Compiler → Renderer                | capability、provenance、input immutability、state completeness   |
| Renderer → Assets                  | RGBA ownership、geometry、checksum、determinism                  |
| CLI → filesystem / Browser         | atomic output、cleanup、signal、partial failure                  |
| TypeScript → Go / C#               | shared fixture encode / decode、unknown field、version mismatch  |

作業中は変更対象のpackage checkを実行する。全変更終了後に次を実行する。

```sh
nix run .#presentation
nix run .#control-plane   # Control Plane contractを変更した場合
nix run .#realtime        # Protobuf / Realtime contractを変更した場合
nix flake check           # Nix設定を変更した場合
nix run .#check
```

Unity behaviorを変更した場合は、repositoryのstatic checkとは別にUnity EditorのEditMode / PlayMode testを実行する。

## 12. Review / Fix loop

各MilestoneとSemantic sliceは、最初の実装とtest成功だけで完了にしない。変更範囲ごとに次のloopを実行し、確認済みの指摘が収束するまで繰り返す。

```text
Explore / Red / Green / Refactor
        ↓
対象限定check
        ↓
実装者によるdiff、contract、境界のself-review
        ↓
独立したreview
        ↓
指摘をcode、invariant、regression testに照らして検証
        ↓
確認できた問題を修正し、必要なtestを追加
        ↓
対象限定checkと変更箇所の再review
        └──────── 未解決の確認済み指摘があれば繰り返す
```

### 12.1 Reviewの観点

- Architecture、ownership、依存方向に違反していないか。
- Contract source、generated artifact、consumerが同期しているか。
- Currentで未対応の機能を暗黙fallbackや任意objectで受理していないか。
- trust boundaryでaccessor、Proxy、mutation、host callback、untrusted bytesを安全に扱っているか。
- canonicalization、hash、diagnostic順序、artifact生成が決定的か。
- failure、cleanup、cancel、partial output、resource budgetのtestがあるか。
- public API、README、ArchitectureのCurrent記述が実装と一致しているか。
- task外のrefactoringや将来用抽象化が混入していないか。

可能な場合、実装担当とは別のreviewerまたは調査sub-agentにreviewを依頼する。同じfileを複数担当が同時編集せず、reviewerは指摘と根拠の提示に限定し、修正担当を一つに保つ。

### 12.2 指摘への対応

Reviewコメントはそのまま採用せず、現在のcode、contract、invariant、再現testに対して妥当性を確認する。

1. 再現可能な問題には、原則として先に失敗するregression testを追加する。
2. Contractの曖昧さが原因なら、実装上の推測で埋めずArchitectureまたはADRの判断へ戻す。
3. 確認できなかった指摘は、検証内容と不採用理由をreview記録に残す。
4. 修正によって新しく触れた範囲も再review対象に含める。
5. testのskip、lint抑制、互換fallbackだけで指摘を閉じない。

### 12.3 Loopの終了条件

次をすべて満たした時点で、そのMilestoneまたはsliceのreview loopを終了する。

- correctness、security、data loss、contract drift、architecture違反に関する確認済みの未対応指摘がない。
- 追加・変更したbehaviorをregression testが固定している。
- 対象packageのtypecheck、lint、test、generation / drift checkが成功している。
- generated artifact、fixture、README、Architectureの必要な更新が同期している。
- 残る論点は、理由、影響、後続Milestoneを明記して明示的にdeferされている。

Review / Fix loop中は対象限定checkを使用する。loopが収束し、予定した変更をすべて終えた後に一度だけrepository-wide `nix run .#check`を実行する。requested commitがある場合は、この最終checkと最終diff reviewの成功後にcommitする。

GoalでMilestoneを実行する場合も、この終了条件をGoalの完了条件に含める。設計判断待ちを暫定実装で回避せず、判断が必要な時点で進捗、選択肢、影響範囲を提示して停止する。

## 13. 実行順チェックリスト

- [x] Milestone 0: 品質基盤の補修
- [ ] Milestone 1: `.unframe.tsx`からartifactまでのLocal Compiler縦断経路
- [ ] Milestone 2: Blocking contractの確定
- [ ] Milestone 3A: ThemeとStructured composition
- [ ] Milestone 3B: State、Interaction、Hit Region
- [ ] Milestone 3C: Action、Output、Trigger、Cue
- [ ] Milestone 3D: TimelineとRuntime projection
- [ ] Milestone 4: RendererとAsset pipeline
- [ ] Milestone 5: Delivery / Runtime contractとC# generation
- [ ] Milestone 6: CLI UXとapplication integrationへの接続

各milestoneを開始する前に、前段の成果物、未解決判断、品質ゲートを再確認する。後段でしか必要にならない抽象化、互換層、仮のconsumerは先行実装しない。
