# Unframe Backend

Go 1.25、Huma v2、Chi で構成された API サーバーです。DB は Turso/libSQL、アセットは Cloudflare R2 に保存します。

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
source app/backend/.env
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

backend directory を build context にします。runtime は distroless の nonroot user です。

```sh
docker build --tag unframe-backend app/backend
docker run --rm --env-file app/backend/.env --publish 8080:8080 unframe-backend
```
