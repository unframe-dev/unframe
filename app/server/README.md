# Unframe Backend

`app/server/` は、異なる実行環境を持つ二つの backend component を置く親ディレクトリです。設計の正本は [ARCHITECTURE.md](./ARCHITECTURE.md) を参照してください。

```text
app/server/
├── ARCHITECTURE.md
├── README.md
├── control-plane/  # Cloudflare Workers / TypeScript / Hono / D1 / R2
├── realtime/       # Go / gRPC / container
└── integration/    # component 間 E2E テスト
```

- `control-plane/` は認証・認可、durable resource、D1/R2、session bootstrap の authority です。
- `realtime/` は gRPC 接続、session 中の一時状態、fan-out、backpressure を担当します。
- 共有境界は `packages/contracts/` の contract です。TypeScript と Go の実装コードは直接共有しません。

旧 Go/Huma/Turso/R2 HTTP API は削除済みです。Control Plane と Realtime の実装・各 component 固有の開発/デプロイ手順は、それぞれの component を追加する変更で定義します。この親ディレクトリには旧 API の環境変数、migration、起動手順を残しません。

## Control Plane

`control-plane/` は独立した pnpm package として Worker entrypoint、Hono application、HTTP error boundary、Workers runtime test を所有します。現在公開する endpoint は `GET /health` のみです。

```sh
nix run .#control-plane
pnpm --filter @unframe/control-plane run dev
```

`nix run .#control-plane` は binding 型の drift、TypeScript、lint、Workers runtime test、deploy dry-run を検証します。Cloudflare resource ID や secret は repository へ記録せず、binding を追加した際は `wrangler types` で型を再生成します。
