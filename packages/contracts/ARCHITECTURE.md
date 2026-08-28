# Contracts Architecture

- **Status**: Current boundary with initial Target Presentation artifact schema
- **Scope**: Application、language、runtime をまたぐ serialized artifact と wire contract
- **Related**:
  - [Presentation Architecture](../../docs/presentation/ARCHITECTURE.md)
  - [Presentation Implementation Design](../../docs/presentation/DESIGN.md)
  - [ADR-0006](../../docs/decisions/0006-presentation-rendering-strategy.md)

## 1. Role

`packages/contracts` は、TypeScript、Go、C# の実装が同じ意味を交換するための portable contract source と generated artifact の境界である。ここでは転送・保存される構造を定義し、構造だけでは表現できない意味検証や application policy は所有しない。

この package の source of truth は contract ごとに異なる。

- Control Plane OpenAPI は Control Plane の型付き route と runtime schema から生成する。
- Realtime / Delivery の wire contract は Protocol Buffers source を正本とする。
- Target の PresentationDefinition / RenderBundle は `src/presentation/` 配下の Zod 4 schema を正本とし、portable JSON Schemaを生成する。

## 2. Owned boundaries

### Current

- `openapi/control-plane.openapi.json`: generated OpenAPI document
- `src/control-plane.openapi.ts`: generated TypeScript OpenAPI types
- `proto/unframe/realtime/v1/realtime.proto`: Realtime gRPC source
- source と generated artifact の drift check

現行 TypeScript runtime client は OpenAPI path type ではなく、Control Plane が公開する Hono RPC `AppType` を利用する。OpenAPI artifact は language-neutral consumer のための境界として維持する。

### Target（Presentation artifact の初期実装）

```text
packages/contracts/
├─ src/presentation/
│  ├─ common.ts
│  ├─ definition.ts
│  ├─ render-bundle.ts
│  └─ index.ts
├─ presentation/
│  ├─ presentation-definition.schema.json  # generated
│  ├─ render-bundle.schema.json            # generated
│  └─ fixtures/
├─ scripts/generate-presentation.ts
└─ proto/unframe/
   ├─ delivery/v1/delivery.proto
   └─ realtime/v1/realtime.proto
```

- PresentationDefinition と baked-web first RenderBundle の serialized shape
- DeliveryManifest、Reliable Event、Snapshot envelope、State Stream の wire shape
- contract version、compatibility field、portable fixture
- Zodから導出したTypeScript型とJSON Schema generation entrypoint

## 3. Ownership split

`packages/contracts` が所有するのは portable な構造と wire compatibility である。次は各 consumer が所有する。

- semantic invariant、reference validation、canonicalization: `presentation-core`
- HTTP route behavior、authorization、publication policy: Control Plane
- progression evaluation、actor resolution、snapshot cut: Realtime
- Unity object、renderer graph、runtime cache: Unity

Schema generator は `presentation-core` を import しない。`presentation-core` が generated TypeScript contract を利用する一方向に固定し、serialized contract と semantic implementation の循環した正本を作らない。

## 4. Generated artifact destinations

```text
Zod Presentation schema
├─ infer    → TypeScript model → presentation-core / Control Plane
└─ generate → JSON Schema artifact

Protocol Buffers
├─ generate → Go artifact → app/server/realtime/internal/gen/
└─ generate → C# artifact → packages/api-client-csharp/
```

Generated file は手編集しない。生成先には generator、source contract、version、drift check を追跡できる情報を残す。

## 5. Invariants

- PresentationDefinition、RenderBundle、DeliveryManifest、Runtime State を一つの schema に統合しない。
- Authoring Source、React、DOM、Unity object、D1 / R2 representation を portable contract に含めない。
- RenderBundle は Signed URL を持たない。取得 binding は Delivery 時に解決する。
- canonical Runtime model と connection / durable envelope を分離する。
- wire field の追加だけで semantic compatibility を保証したことにしない。
- Zod validatorと生成JSON Schemaは同じportable fixtureに対して同じ構造判定を行う。
- Go / C# consumerはPresentationDefinition全体ではなく、Protocol Buffersで定義したDelivery / Runtime projectionを利用する。

## 6. Dependency rules

Target の Presentation schema と Protocol Buffers は、consumer が generated artifact または schema を参照する向きだけを許可する。これらの source / generator から application implementation、`presentation-core`、renderer、Compiler、Unity adapter への依存は禁止する。

現行 Control Plane OpenAPI は application の型付き route が source of truth であり、`scripts/generate-control-plane.ts` は route application を読み込んで文書と型を生成する repository adapter である。この Current generation path は Target の portable Presentation schema generator と同一視せず、Control Plane implementation を `packages/contracts` の runtime dependency として公開しない。

## 7. Validation strategy

- Zod source と generated JSON Schema artifact の drift check
- schema の valid / invalid fixture
- canonical JSON と hash の cross-language fixture
- Protobuf compatibility check
- TypeScript、Go、C# consumer が利用する用途別fixtureのconformance test
- Current contract を Target contract へ置き換える変更では、Web、Control Plane、Realtime、Unity の consumer を同じ変更単位で検証する

## 8. Current gap

PresentationDefinition / baked-web first RenderBundle のZod 4 source、最小fixture、生成JSON Schema、schema validationとdrift checkは実装済みである。初期subsetの参照整合性とcanonicalizationは`presentation-core`に実装済みである。完全版contractのsemantic validation、DeliveryManifest Protobuf、Runtime contract の大部分、Go / C# generationは未実装である。現行 `realtime.proto` は foundation であり、Target architecture 全体を表す完成契約ではない。

最初のmilestoneではCueの詳細contractをまだ固定しない。schemaは`cues`を空配列に限定し、任意のCue objectを受け入れない。Frame layoutとText placementは`absolute` subsetのみを構造契約に含める。参照整合性、所有権、tree不変条件、Quaternion正規化、Scalar値の型整合性は`presentation-core`のsemantic validationへ委譲する。
