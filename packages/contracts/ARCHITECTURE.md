# Contracts Architecture

- **Status**: Current boundary with Presentation contracts
- **Scope**: Application、language、runtime をまたぐ serialized artifact と wire contract
- **Related**:
  - [Presentation Architecture](../../docs/packages/ARCHITECTURE.md)
  - [Presentation Implementation Design](../../docs/packages/DESIGN.md)
  - [ADR-0006](../../docs/decisions/0006-presentation-rendering-strategy.md)
  - [ADR-0007](../../docs/decisions/0007-timeline-runtime-run-wire-contract.md)
  - [ADR-0008](../../docs/decisions/0008-runtime-transport-contract.md)
  - [ADR-0009](../../docs/decisions/0009-semantic-tree-hit-region-contract.md)
  - [ADR-0010](../../docs/decisions/0010-spatial-surface-coordinate-contract.md)
  - [ADR-0011](../../docs/decisions/0011-surface-partition-contract.md)
  - [ADR-0012](../../docs/decisions/0012-texture-budget-residency-contract.md)
  - [ADR-0014](../../docs/decisions/0014-presentation-rendering-scope.md)
  - [ADR-0015](../../docs/decisions/0015-presentation-definition-artifact-boundaries.md)

## 1. Role

`packages/contracts` は、TypeScript、Go、C# の実装が同じ意味を交換するための portable contract source と generated artifact の境界である。ここでは転送・保存される構造を定義し、構造だけでは表現できない意味検証や application policy は所有しない。

この package の source of truth は contract ごとに異なる。

- Control Plane OpenAPI は Control Plane の型付き route と runtime schema から生成する。
- Realtime / Delivery の wire contract は Protocol Buffers source を正本とする。
- PresentationDefinition / RenderBundle / AssetSetManifest は `src/presentation/` 配下の Zod 4 schema を正本とし、portable JSON Schemaを生成する。詳細な意味規則は [Presentation v2](../../docs/packages/DATA_MODEL.md) を正本とする。

## 2. Owned boundaries

### Current

- `openapi/control-plane.openapi.json`: generated OpenAPI document
- `src/control-plane.openapi.ts`: generated TypeScript OpenAPI types
- `proto/unframe/realtime/realtime.proto`: Realtime gRPC source
- source と generated artifact の drift check

現行 TypeScript runtime client は OpenAPI path type ではなく、Control Plane が公開する Hono RPC `AppType` を利用する。OpenAPI artifact は language-neutral consumer のための境界として維持する。

### Presentation

- `src/presentation/`: Definition、RenderBundle、AssetSet、Build、Publication、Capability と M3D Cue Runtime projection subset の Zod と導出型
- `presentation/`: 生成 JSON Schema、Protobuf descriptor、portable fixture
- `proto/unframe/presentation/runtime.proto`: 共通型と投影 catalog
- `proto/unframe/delivery/delivery.proto`: DeliveryManifest と capability / residency
- `proto/unframe/realtime/realtime.proto`: Command、Event、Run、Snapshot、State Stream
- `scripts/generate-presentation.ts`: JSON Schema / descriptor の生成と drift check

Presentation v1 の公開 export、schema、fixture、生成経路と Realtime v1 wire は廃止した。現行契約の名前にバージョン suffix を付けず、serialized version 値で検査する。命名と互換性の判断は [ADR-0024](../../docs/decisions/0024-canonical-presentation-contract-names.md) に従う。旧 Control Plane Presentation CRUD の groups / elements DTO は後続の移行対象として残る。

M3D の `m3dCueRuntimeSnapshotSchema`、`runtimeVisibilitySelectionSchema`、`m3dCueParticipantRuntimeViewSchema` は、現行 Cue 実行器が扱う subset を固定する。完全な構造は `canonicalRuntimeSnapshotSchema` と `participantRuntimeViewSchema` が扱い、Media / Model を含む。意味検証と role projection は Core が所有する。

v2 Proto から TypeScript の descriptor / 静的 codec / 型、Go、C# の message / service source を生成する。TypeScript の公開 wire codec は decimal string の `uint64` を使い、動的コード生成を必要としない。生成 consumer の配置と検証境界は [ADR-0023](../../docs/decisions/0023-m5-generated-consumer-boundaries.md) に従う。Realtime の通信契約は v2 に限定する。生成物と authoritative Runtime の実装・検証を区別する。

## 3. Ownership split

`packages/contracts` が所有するのは portable な構造と wire compatibility である。次は各 consumer が所有する。

- semantic invariant、reference validation、canonicalization: `unframe-core`
- HTTP route behavior、authorization、publication policy: Control Plane
- progression evaluation、actor resolution、snapshot cut: Realtime
- Unity object、renderer graph、runtime cache: Unity

Schema generator は `unframe-core` を import しない。`unframe-core` が generated TypeScript contract を利用する一方向に固定し、serialized contract と semantic implementation の循環した正本を作らない。

## 4. Generated artifact destinations

```text
Zod Presentation schema
├─ infer    → TypeScript model → unframe-core / Control Plane
└─ generate → JSON Schema artifact

Protocol Buffers
├─ generate → Go artifact → app/server/realtime/internal/gen/
└─ generate → C# artifact → packages/api-client-csharp/
```

Generated file は手編集しない。生成先には generator、source contract、version、drift check を追跡できる情報を残す。

## 5. Invariants

- PresentationDefinition、RenderBundle、DeliveryManifest、Runtime State を一つの schema に統合しない。
- Authoring Source、React、DOM、Unity object、D1 / R2 representation を portable contract に含めない。
- Surface artifact の対象は `baked-web`、限定 `native-ui`、`video` とする。`embedded-web` / WebView はプロジェクト対象外であり、artifact、capability、runtime bridge の拡張口や予約 field を設けない。ビルド時の Opaque renderer の Browser 実行は配布・実行時の契約に含めない。
- 完全版 Definition の `flow.timelines` と、素材 descriptor を分離する AssetSetManifest の構造境界は ADR-0015 に従う。v2 AssetSet の schema と構造検証は実装済みである。Compiler は M3A の baked-web / font subset で AssetSet と BuildManifest を生成する。旧 `definition.assets` を使う consumer の移行と、v2 の全 artifact への対応は未完了である。
- Model animation は [ADR-0016](../../docs/decisions/0016-model-animation-scope.md) に従い Model Asset 内蔵 clip に限定し、通常一つ、crossfade 中だけ遷移元・遷移先の二つを同じ ModelNode で再生できる。部位 mask / layer / additive、root motion による Node Transform 変更は許可せず、予約 field も作らない。Clip ID binding と保持姿勢の構造は [Presentation Data Model](../../docs/packages/DATA_MODEL.md) に従う。具体的な Action / Run / wire は v2 に定義する。root motion 素材の変換と consumer 接続は未実装である。
- RenderBundle は Signed URL を持たない。取得 binding は Delivery 時に解決する。
- canonical Runtime model と connection / durable envelope を分離する。
- wire field の追加だけで semantic compatibility を保証したことにしない。
- Zod validatorと生成JSON Schemaは同じportable fixtureに対して同じ構造判定を行う。
- Go / C# consumerはPresentationDefinition全体ではなく、Protocol Buffersで定義したDelivery / Runtime projectionを利用する。

## 6. Dependency rules

Target の Presentation schema と Protocol Buffers は、consumer が generated artifact または schema を参照する向きだけを許可する。これらの source / generator から application implementation、`unframe-core`、renderer、Compiler、Unity adapter への依存は禁止する。

現行 Control Plane OpenAPI は application の型付き route が source of truth であり、`scripts/generate-control-plane.ts` は route application を読み込んで文書と型を生成する repository adapter である。この Current generation path は Target の portable Presentation schema generator と同一視せず、Control Plane implementation を `packages/contracts` の runtime dependency として公開しない。

## 7. Validation strategy

- Zod source と generated JSON Schema artifact の drift check
- schema の valid / invalid fixture
- canonical JSON と hash の cross-language fixture
- Protobuf compatibility check
- TypeScript、Go、C# consumer が利用する用途別fixtureのconformance test
- Current contract を Target contract へ置き換える変更では、Web、Control Plane、Realtime、Unity の consumer を同じ変更単位で検証する

## 8. Current gap

Presentation の Definition / RenderBundle / AssetSet / Build / Publication と Runtime snapshot は Zod source と生成 JSON Schema を持つ。Cue / Action / Timeline、State / Semantic Tree / Hit Region の意味検証は Core が所有し、wire field の存在だけで実行機能の完成を判断しない。

Compiler は Structured baked-web を自動 partition し、State 別 Hit Region を Surface 全体で解決する。v2 texture は `pixelSize`、`mipCount: 1`、`gpuBytes` を持ち、alpha は `opaque` / `straight` に限定する。Native UI / Video の Delivery admission は、対応する budget tier と consumer の採用条件に従う。schema の定義を renderer や実機 residency の実装と区別する。

Delivery projection / admission は Core、wire version / fence / checkpoint / cursor 検査は Go / Unity の純粋 adapter が扱う。Go / C# / TypeScript の generated consumer と Realtime 通信契約は v2 に限定する。authoritative evaluation、live replay / reconnect と persistence lifecycle は application が所有する。Unity の接続と実機での検証は、生成契約の同期とは別に確認する。
