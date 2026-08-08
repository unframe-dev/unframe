# Unframe Control Plane

Cloudflare Workers と Hono で実行する Unframe の Control Plane です。現在は HTTP 境界だけを実装しており、`GET /health` が JSON の liveness response を返します。未知の path は JSON 形式の 404、未処理例外は詳細を含めない JSON 形式の 500 として応答します。

## Commands

```sh
pnpm check
pnpm types
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`pnpm types` は Wrangler の設定から `src/worker-configuration.d.ts` を生成します。Worker binding の型はこの生成物を使用し、手書きの `Env` は定義しません。

## Contract dependencies

`zod`、`@hono/zod-validator`、`@hono/zod-openapi` は contract の入力検証と OpenAPI 生成に採用しています。現時点の HTTP 境界は Hono のままであり、contract の source of truth を設計する時点で接続します。

## Not implemented

以下はまだ実装していません。

- D1 と R2 の binding、migration、adapter
- authentication と authorization
- presentation、asset、session などの business module
- OpenAPI contract と API endpoint
