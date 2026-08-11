# Unframe Realtime Backend

Go 1.25.7 と gRPC を使う、Control Plane から独立した Realtime Backend の最小実行基盤です。`RealtimeService.Connect` は protocol-version handshake 後、presenter の page-change command を session 単位で採番し、接続中の participant へ順序付きで in-memory fan-out します。replay と resume は未実装です。

## 起動

```sh
cd app/server/realtime
set -a
source .env.example
set +a
go run ./cmd/server
```

`REALTIME_LISTEN_ADDR` で listen address を指定できます。既定値は `:9090` です。`SIGINT` または `SIGTERM` を受け取ると、10 秒を上限に graceful shutdown します。

## 構成

- `cmd/server`: listener と signal handling を組み立てる composition root
- `internal/transport/grpc`: gRPC の起動・停止、service registration、stream lifecycle
- `internal/auth`: caller と service identity の検証境界
- `internal/protocol`: generated wire type と内部入力の変換・検証境界
- `internal/session`: session 中だけ存在する状態の調整境界
- `internal/persistence/http`: Control Plane HTTP client 境界
- `internal/observability`: metrics、traces、structured logging の境界

`internal/gen/realtime/v1` は protobuf generator の出力先です。`.proto` の source of truth は `packages/contracts/proto/` で、generated Go files は手で編集しません。repository root の Nix development shell で `scripts/contracts/generate-proto.sh check` を実行すると drift を検出できます。

接続の session、participant、role は message payload ではなく、認証境界が stream context へ設定した identity から取得します。この slice は JWT verification をまだ実装していないため、認証 interceptor がない実行プロセスでは接続を認証失敗として拒否します。

## 検証

```sh
nix run .#realtime
nix run .#realtime -- fix
```

`nix run .#realtime`はRealtime専用のvet、lint、test、build、race detectorを実行する。lint設定とDocker build contextも`app/server/realtime/`内で完結し、移行元のGo HTTP backendを必要としない。

## コンテナ

`app/server/realtime` を build context にして build します。

```sh
docker build -t unframe-realtime app/server/realtime
docker run --rm -p 9090:9090 unframe-realtime
```
