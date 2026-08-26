# Contracts Architecture

- **Status**: Current boundary with Target extensions
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
- Target の PresentationDefinition / RenderBundle は `presentation/` 配下の portable schema source を正本とする。

## 2. Owned boundaries

### Current

- `openapi/control-plane.openapi.json`: generated OpenAPI document
- `src/control-plane.openapi.ts`: generated TypeScript OpenAPI types
- `proto/unframe/realtime/v1/realtime.proto`: Realtime gRPC source
- source と generated artifact の drift check

現行 TypeScript runtime client は OpenAPI path type ではなく、Control Plane が公開する Hono RPC `AppType` を利用する。OpenAPI artifact は language-neutral consumer のための境界として維持する。

### Target

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

- PresentationDefinition と RenderBundle の serialized shape
- DeliveryManifest、Reliable Event、Snapshot envelope、State Stream の wire shape
- contract version、compatibility field、portable fixture
- TypeScript、Go、C# generated artifact の generation entrypoint

## 3. Ownership split

`packages/contracts` が所有するのは portable な構造と wire compatibility である。次は各 consumer が所有する。

- semantic invariant、reference validation、canonicalization: `presentation-core`
- HTTP route behavior、authorization、publication policy: Control Plane
- progression evaluation、actor resolution、snapshot cut: Realtime
- Unity object、renderer graph、runtime cache: Unity

Schema generator は `presentation-core` を import しない。`presentation-core` が generated TypeScript contract を利用する一方向に固定し、serialized contract と semantic implementation の循環した正本を作らない。

## 4. Generated artifact destinations

```text
contract source
├─ generate → TypeScript artifact → presentation-core / Control Plane
├─ generate → Go artifact         → app/server/realtime/internal/gen/
└─ generate → C# artifact         → packages/api-client-csharp/
```

Generated file は手編集しない。生成先には generator、source contract、version、drift check を追跡できる情報を残す。

## 5. Invariants

- PresentationDefinition、RenderBundle、DeliveryManifest、Runtime State を一つの schema に統合しない。
- Authoring Source、React、DOM、Unity object、D1 / R2 representation を portable contract に含めない。
- RenderBundle は Signed URL を持たない。取得 binding は Delivery 時に解決する。
- canonical Runtime model と connection / durable envelope を分離する。
- wire field の追加だけで semantic compatibility を保証したことにしない。
- Go、C#、TypeScript consumer は同じ portable fixture に対する conformance test を持つ。

## 6. Dependency rules

Target の Presentation schema と Protocol Buffers は、consumer が generated artifact または schema を参照する向きだけを許可する。これらの source / generator から application implementation、`presentation-core`、renderer、Compiler、Unity adapter への依存は禁止する。

現行 Control Plane OpenAPI は application の型付き route が source of truth であり、`scripts/generate-control-plane.ts` は route application を読み込んで文書と型を生成する repository adapter である。この Current generation path は Target の portable Presentation schema generator と同一視せず、Control Plane implementation を `packages/contracts` の runtime dependency として公開しない。

## 7. Validation strategy

- source と generated artifact の drift check
- schema の valid / invalid fixture
- canonical JSON と hash の cross-language fixture
- Protobuf compatibility check
- TypeScript、Go、C# consumer の conformance test
- Current contract を Target contract へ置き換える変更では、Web、Control Plane、Realtime、Unity の consumer を同じ変更単位で検証する

## 8. Current gap

PresentationDefinition / RenderBundle の portable schema source、DeliveryManifest Protobuf、Runtime contract の大部分、C# generation は未実装である。現行 `realtime.proto` は foundation であり、Target architecture 全体を表す完成契約ではない。
