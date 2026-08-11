# Contracts

Control Plane と Realtime Backend の共有境界を置きます。

## Control Plane OpenAPI

`app/server/control-plane/src/openapi.ts` とそこで参照する共有Zod schemaが生成元です。
`openapi/control-plane.openapi.json` と `src/control-plane.openapi.ts` は生成物であり、手編集しません。後者は
`@unframe/contracts/control-plane` から import できます。

```sh
pnpm --filter @unframe/contracts generate:control-plane
pnpm --filter @unframe/contracts check:control-plane
```

Control Plane の `src/openapi.ts`、Presentation / Asset schema、HTTP routeを変更した場合は型を再生成し、drift checkを通してください。

## Realtime Protocol Buffers

`proto/unframe/realtime/v1/realtime.proto` は Realtime gRPC protocol の source of truth です。Go generated code は `app/server/realtime/internal/gen/realtime/v1/` に出力します。generated files は手で編集しません。

repository root の Nix development shell で次を実行します。

```sh
scripts/contracts/generate-proto.sh
scripts/contracts/generate-proto.sh check
```

`nix run .#realtime` は生成物の drift check を含みます。C# client generation はまだ導入していません。
