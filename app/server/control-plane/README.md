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

## Contract

OpenAPI contract の source of truth と生成方向はまだ確定していません。schema、validator、generator の依存関係は、最初の resource API と contract flow を実装する変更で追加します。

未処理例外は response body とログへ message を出さず、route pattern、例外名、incident ID のみを構造化ログへ記録します。response の `x-unframe-incident-id` header を使って該当ログを追跡できます。Workers Logs は全件、trace は 1% を保存する設定です。

## Not implemented

以下はまだ実装していません。

- D1 と R2 の binding、migration、adapter
- authentication と authorization
- presentation、asset、session などの business module
- OpenAPI contract と resource API endpoint
