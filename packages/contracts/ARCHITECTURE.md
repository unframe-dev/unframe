# Contracts Architecture

- **Status**: Current boundary with Presentation v2 contracts
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
- Target の PresentationDefinition / RenderBundle / AssetSetManifest は `src/presentation/` 配下の Zod 4 schema を正本とし、portable JSON Schemaを生成する。完全版は `src/presentation/v2/` に置き、詳細な意味規則は [Presentation v2](../../docs/packages/DATA_MODEL.md) を正本とする。

## 2. Owned boundaries

### Current

- `openapi/control-plane.openapi.json`: generated OpenAPI document
- `src/control-plane.openapi.ts`: generated TypeScript OpenAPI types
- `proto/unframe/realtime/v1/realtime.proto`: Realtime gRPC source
- source と generated artifact の drift check

現行 TypeScript runtime client は OpenAPI path type ではなく、Control Plane が公開する Hono RPC `AppType` を利用する。OpenAPI artifact は language-neutral consumer のための境界として維持する。

### Presentation v2（契約定義済み、consumer 未接続）

- `src/presentation/v2/`: Definition、RenderBundle、AssetSet、Build、Publication、Capability の Zod と導出型
- `presentation/v2/`: 生成 JSON Schema、Protobuf descriptor、portable fixture
- `proto/unframe/presentation/v2/runtime.proto`: 共通型と投影 catalog
- `proto/unframe/delivery/v2/delivery.proto`: DeliveryManifest と capability / residency
- `proto/unframe/realtime/v2/realtime.proto`: Command、Event、Run、Snapshot、State Stream
- `scripts/generate-presentation-v2.ts`: JSON Schema / descriptor の生成と drift check

既存 `src/presentation/` 直下と `presentation/` 直下の v1 artifact は M1 consumer の初期 subset である。v2 の正本として参照しない。

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

PresentationDefinition / baked-web first RenderBundle のZod 4 source、最小fixture、生成JSON Schema、schema validationとdrift checkは実装済みである。M3BのState / Semantic Tree / click Interaction / Hit Regionの意味検証は`unframe-core`に実装済みである。Timeline catalog / Runtime Run wire の accepted semantics は [ADR-0007](../../docs/decisions/0007-timeline-runtime-run-wire-contract.md)、Reliable Event / Snapshot / State Stream の exact envelope、retention、microstep上限は [ADR-0008](../../docs/decisions/0008-runtime-transport-contract.md)、role別Semantic Tree / Hit Regionのtarget schemaは [ADR-0009](../../docs/decisions/0009-semantic-tree-hit-region-contract.md)、Spatial / Surface / Unity座標変換は [ADR-0010](../../docs/decisions/0010-spatial-surface-coordinate-contract.md)、Surface Partition / Part isolate overrideは [ADR-0011](../../docs/decisions/0011-surface-partition-contract.md)、Texture metadata / budget / residencyは [ADR-0012](../../docs/decisions/0012-texture-budget-residency-contract.md) に定義した。旧 v1 texture schema は `pixelSize` を持つが、`mipCount` / `gpuBytes` は持たず、`premultiplied` を許可する。現行 Compiler / Core が使う v2 baked-web texture schema は `pixelSize`、`mipCount: 1`、`gpuBytes` を持ち、alpha は `opaque` / `straight` だけを許可する。現行 Compiler は一 Surface 一 partitionで、State別のclick Hit Regionを生成する。Core は Quaternion の単位長に加え、canonical sign と負のゼロも検証する。Unity sample importer は旧 contract のままであり、残る fixture と実装の接続は後続とする。v2 は完全版の構造と意味規則を定義し、JSON Schema / Protobuf descriptor と fixture を生成・検証する。Delivery projection、version negotiation、v2 Go / C# consumer generation と実行処理は未実装である。`realtime/v1/realtime.proto` は既存 foundation として残る。

最初のmilestoneではCueの詳細contractをまだ固定しない。schemaは`cues`を空配列に限定し、任意のCue objectを受け入れない。Frame layoutとText placementは`absolute` subsetのみを構造契約に含める。参照整合性、所有権、tree不変条件、Quaternion正規化、Scalar値の型整合性は`unframe-core`のsemantic validationへ委譲する。
