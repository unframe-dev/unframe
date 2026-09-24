# C# Generated Client Architecture

- **Status**: Current placeholder / Target generation boundary
- **Scope**: OpenAPI と Protocol Buffers から生成する C# artifact
- **Related**:
  - [Contracts Architecture](../contracts/ARCHITECTURE.md)
  - [Presentation Implementation Design](../../docs/presentation/DESIGN.md)

## 1. Role

`api-client-csharp` は Unity / C# consumer が Control Plane、Delivery、Realtime contract を利用するための generated artifact boundary である。Source contract の正本でも Unity integration layer でもない。

現状は生成先の placeholder だけが存在し、C# generation と Unity consumer 接続は未実装である。

## 2. Target contents

- Control Plane OpenAPI から生成した model / client
- Delivery / Realtime Protobuf から生成した message / service artifact
- generator version と source contract version の追跡情報
- generated code を検証する compile / conformance test

Generated file は手編集しない。必要な behavior 変更は `packages/contracts` の source、Control Plane route source、generator configuration のいずれかで行い、再生成する。

## 3. Ownership split

この package は wire model と generated client surface だけを所有する。

- GameObject、Material、Texture への変換: Unity Presentation Runtime
- Asset download、cache、preload、eviction: Unity
- authentication credential の安全な保存: Unity application adapter
- retry、reconnect、snapshot application: Unity runtime layer
- portable wire compatibility policy: `packages/contracts`
- semantic invariant の定義と authoritative evaluation: `presentation-core`、Compiler、Realtime など各 ownership boundary

C# consumer は generated model が保持する contract と fence を検証に利用するが、この package や Unity adapter が canonical semantic rule の正本になることはない。

Generated partial class や手書き Unity adapter を generated source directory に混在させない。

## 4. Invariants

- generated artifact から source contract と generator version を追跡できる。
- generation は再現可能で、drift check を CI で実行できる。
- Unity-specific runtime object を wire model に追加しない。
- `packages/contracts` が定義する DeliveryManifest / Runtime message の unknown / future field policy を generated API が保持できる。
- PublicationFence、assignment、projection profile の fence を consumer が検証できる型を失わない。

## 5. Dependency rules

依存方向は `packages/contracts` の source からこの package を生成し、Unity がこの package を参照する一方向とする。この package は Unity project、Control Plane implementation、Realtime implementation に依存しない。

## 6. Validation strategy

- source と generated artifact の drift check
- standalone C# compile
- TypeScript / Go と共有する wire fixture の decode / encode test
- Unity consumer の adapter contract test
- generated API の breaking change report

## 7. Deferred decisions

- OpenAPI / Protobuf generator と version
- package distribution と Unity Package Manager 接続
- generated namespace と assembly boundary
- Unity projectへ組み込む migration path
