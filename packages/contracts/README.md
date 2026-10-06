# Contracts

Control Plane と Realtime Backend の共有境界を置きます。

## Control Plane OpenAPI

`app/server/control-plane/src/openapi.ts` の route 定義と、それを実ハンドラへ登録する型付き
`OpenAPIHono` application が生成元です。実行時検証と文書生成は同じ Zod schema を使います。
`openapi/control-plane.openapi.json` と `src/control-plane.openapi.ts` は生成物であり、手編集しません。後者は
`@unframe/contracts/control-plane` から import できます。

```sh
pnpm --filter @unframe/contracts generate:control-plane
pnpm --filter @unframe/contracts check:control-plane
```

Control Plane の `src/openapi.ts`、共有 schema、HTTP routeを変更した場合は型を再生成し、drift checkを通してください。TypeScript runtime client は生成 path 型ではなく Hono RPC の `AppType` を使います。生成物は Unity / C# など言語非依存の契約境界として維持します。

## Presentation

完成版の構造は `src/presentation/` の Zod と `proto/unframe/{presentation,delivery,realtime}/` の Protobuf が正本です。型は `@unframe/contracts/presentation` から import できます。参照整合性・状態遷移・拒否条件は [Presentation データ契約](../../docs/packages/DATA_MODEL.md) を併読してください。実機対応の検証は含みません。

repository root の Nix development shell で実行します。

```sh
pnpm --filter @unframe/contracts generate:presentation
pnpm --filter @unframe/contracts check:presentation
pnpm --filter @unframe/contracts test:presentation
```

`presentation/*.schema.json` と `contract.pb` は生成物です。fixture は合成データで、モデル・動画・フォントの実バイトや実機測定値を含みません。構造の受理・拒否と生成物の一致を検証し、素材の変換・描画成功とは区別します。

## Realtime / Delivery v2 consumers

`proto/unframe/{presentation,delivery,realtime}/` が wire の正本です。Realtime v1 と Presentation v1 の公開 schema、fixture、生成経路は廃止しています。旧 Control Plane Presentation CRUD の DTO は独立した未移行の境界です。

repository root の Nix development shell で実行します。

```sh
scripts/contracts/generate-proto.sh
scripts/contracts/generate-proto.sh check
scripts/contracts/generate-consumers.sh
scripts/contracts/generate-consumers.sh check
scripts/contracts/generate-unity-proto.sh
scripts/contracts/generate-unity-proto.sh check
```

Go は `app/server/realtime/internal/gen/`、C# は `packages/api-client-csharp/Generated/` に生成します。Unity の `.proto` copies と C# bindings も生成元から同期します。`nix run .#realtime` と `nix run .#unity-proto` は各生成物の drift を検出します。生成 consumer と authoritative Runtime の実装・実機検証は区別します。
