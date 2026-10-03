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

現行契約の構造は `src/presentation/` の Zod と `proto/unframe/{presentation,delivery,realtime}/` の Protobuf が正本です。型は `@unframe/contracts/presentation` から import できます。参照整合性・状態遷移・拒否条件は [Presentation データ契約](../../docs/packages/DATA_MODEL.md) を併読してください。旧Presentation v1の構造・fixture・exportは廃止しています。データ移行・互換adapterは提供しません。schemaVersion / contractVersion の値 `2` と通信の `"v2"` は維持します。

repository root の Nix development shell で実行します。

```sh
pnpm --filter @unframe/contracts generate:presentation
pnpm --filter @unframe/contracts check:presentation
pnpm --filter @unframe/contracts test:presentation
```

`presentation/*.schema.json` と `contract.pb` は生成物です。fixture は合成データで、モデル・動画・フォントの実バイトや実機測定値を含みません。構造の受理・拒否と生成物の一致を検証し、素材の変換・描画成功とは区別します。

## Realtime v1（既存 foundation）

`proto/unframe/realtime/v1/realtime.proto` は Realtime gRPC protocol の source of truth です。Go generated code は `app/server/realtime/internal/gen/realtime/v1/` に出力します。generated files は手で編集しません。

Presentation の `runtime.proto`、`delivery.proto`、`realtime.proto` は Unity C# bindings の source of truth でもあります。Unity 側の `.proto` copies と generated C# を同期・検証する repository task は `nix run .#unity-proto` です。

repository root の Nix development shell で次を実行します。

```sh
scripts/contracts/generate-proto.sh
scripts/contracts/generate-proto.sh check
```

`nix run .#realtime` は生成物の drift check を含みます。現行契約のC#生成物のdrift checkは `nix run .#contracts-consumers -- check` で行います。
