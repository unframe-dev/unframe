# Unframe Backend

Go 1.25、Huma v2、Chi で構成された API サーバーです。DB は Turso/libSQL、アセットは Cloudflare R2 に保存します。

このGo HTTPサーバーは目標アーキテクチャへの移行元である。目標構成では、Control PlaneとRealtime Backendを別のruntime、dependency、deployment単位として分離する。設計の詳細と移行方針は[`ARCHITECTURE.md`](./ARCHITECTURE.md)を参照する。

## 目標ディレクトリ構成

```text
app/server/
├── ARCHITECTURE.md
├── README.md
├── control-plane/                # Workers / TypeScript / Hono / D1 / R2
│   ├── migrations/              # D1 migrations
│   ├── src/
│   │   ├── index.ts             # Worker entrypoint
│   │   ├── app.ts               # composition root
│   │   ├── env.ts               # Workers bindings types
│   │   ├── http/                # middleware and HTTP mapping
│   │   ├── modules/             # feature use cases, models, and ports
│   │   ├── adapters/            # Better Auth, D1, R2, routing, signing
│   │   ├── jobs/                # scheduled work
│   │   └── observability/
│   └── test/
├── realtime/                     # Go / gRPC / container
│   ├── cmd/server/               # process entrypoint
│   └── internal/
│       ├── gen/realtime/v1/     # generated Go protobuf code
│       ├── transport/grpc/       # gRPC adapter
│       ├── auth/                 # JWT and service identity
│       ├── protocol/             # wire/core mapping and validation
│       ├── session/              # coordinator and transient state
│       ├── persistence/http/     # Control Plane client
│       └── observability/
└── integration/                  # cross-component end-to-end tests
```

- `control-plane/`は認証・認可、durable resource、D1/R2、session bootstrapのauthorityである。
- `realtime/`はgRPC connectionとsession中の一時状態、fan-out、backpressureを担当する。
- component間の共有境界は`packages/contracts/openapi.yaml`と`packages/contracts/proto/`であり、TypeScriptとGoの実装codeは共有しない。
- 現行Go HTTP実装は移行完了まで`app/server/`直下に残し、`control-plane/`や`realtime/`へそのまま移動しない。

## 必要な環境変数

`.env.example` を参考に、実行環境へ次を設定してください。

- `TURSO_DATABASE_URL`: `libsql://...` 形式の remote Turso URL
- `TURSO_AUTH_TOKEN`: Turso database token
- `R2_ENDPOINT`: `https://<account-id>.r2.cloudflarestorage.com`
- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`: R2 API token の S3 credentials
- `R2_BUCKET`: アセット用 bucket
- `CORS_ORIGINS`: 許可する origin のカンマ区切り。未指定時は localhost の 5173/3000
- `SERVICE_HOST` / `SERVICE_PORT`: listen address。既定値は `0.0.0.0:8080`

シェルへ読み込む例:

```sh
set -a
source app/server/.env
set +a
```

## マイグレーションと起動

リポジトリルートで Turso に migration を適用してから起動します。

```sh
nix run .#migrate
nix run .#dev
```

`nix run .#migrate` と server は同じ `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` を使用します。接続時には外部キー制約を有効化します。

## スモークテスト

別ターミナルから liveness と presentation API を確認できます。

```sh
curl --fail --silent http://localhost:8080/health

curl --fail --silent \
  --header 'Content-Type: application/json' \
  --data '{"title":"Smoke test"}' \
  http://localhost:8080/presentations
```

作成レスポンスの `id` を使い、通常 API と MR manifest を確認します。

```sh
curl --fail --silent http://localhost:8080/presentations/<id>
curl --fail --silent http://localhost:8080/presentations/<id>/manifest
```

`POST /assets/init` が返す `uploadUrl` へは、初期化時と同じ `Content-Type` と `Content-Length` で直接 PUT してください。署名は両ヘッダーを拘束します。

本番 Turso/R2 credentials がない環境では remote smoke は実施できません。その場合も CI の modernc in-memory SQLite migration、repository/service 統合テスト、R2 presigner 単体テスト、server build で wiring を自動検証します。

## コンテナ

server directory を build context にします。runtime は distroless の nonroot user です。

```sh
docker build --tag unframe-server app/server
docker run --rm --env-file app/server/.env --publish 8080:8080 unframe-server
```
