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

## Realtime Protocol Buffers

`proto/unframe/realtime/v1/realtime.proto` は Realtime gRPC protocol の source of truth です。Go generated code は `app/server/realtime/internal/gen/realtime/v1/` に出力します。generated files は手で編集しません。

repository root の Nix development shell で次を実行します。

```sh
scripts/contracts/generate-proto.sh
scripts/contracts/generate-proto.sh check
```

`nix run .#realtime` は生成物の drift check を含みます。C# client generation はまだ導入していません。
