# Unframe Backend

`app/server/` は、異なる実行環境を持つ二つの backend component を置く親ディレクトリです。設計の正本は [ARCHITECTURE.md](./ARCHITECTURE.md) を参照してください。

```text
app/server/
├── ARCHITECTURE.md
├── README.md
├── control-plane/  # Cloudflare Workers / TypeScript / Hono / D1 / R2
├── realtime/       # Go / gRPC / container
└── integration/    # planned: component 間 E2E テスト
```

- `control-plane/` の目標責務は認証・認可、durable resource、D1/R2、session bootstrap のauthorityです。
- `realtime/` の目標責務はgRPC接続、session中の一時状態、fan-out、backpressureです。
- 共有境界は `packages/contracts/` の contract です。TypeScript と Go の実装コードは直接共有しません。

旧 Go/Huma/Turso/R2 HTTP API は削除済みです。Control Planeは認証とPresentation / Asset APIまで実装済みで、session bootstrapは未実装です。Realtimeは独立したGo module、gRPC process、lint設定、Docker build context、品質taskを所有しますが、Protobuf service、認証、session logic、persistence bridgeは未実装です。

## Control Plane

`control-plane/` は独立した pnpm package として Worker entrypoint、Hono application、Better Auth、Presentation / Asset API、D1 migration、R2 adapter、OpenAPI、Workers runtime test を所有します。

```sh
nix run .#control-plane
pnpm --filter @unframe/control-plane run dev
```

`nix run .#control-plane` は binding 型、TypeScript、lint、Workers runtime test、OpenAPI / TypeScript client drift、deploy dry-runを検証します。実環境の resource ID と secret を設定する手順は [`control-plane/README.md`](./control-plane/README.md) を参照してください。
