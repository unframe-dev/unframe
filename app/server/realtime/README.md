# Unframe Realtime Backend

Go 1.25.7 と gRPC を使う、Control Plane から独立した Realtime Backend の最小実行基盤です。現時点ではサービスを登録せず、gRPC のプロセスライフサイクルだけを提供します。

## 起動

```sh
set -a
source app/server/realtime/.env.example
set +a
go run ./app/server/realtime/cmd/server
```

`REALTIME_LISTEN_ADDR` で listen address を指定できます。既定値は `:9090` です。`SIGINT` または `SIGTERM` を受け取ると、10 秒を上限に graceful shutdown します。

## 構成

- `cmd/server`: listener と signal handling を組み立てる composition root
- `internal/transport/grpc`: gRPC の起動・停止と将来の service registration 境界
- `internal/auth`: caller と service identity の検証境界
- `internal/protocol`: generated wire type と内部入力の変換・検証境界
- `internal/session`: session 中だけ存在する状態の調整境界
- `internal/persistence/http`: Control Plane HTTP client 境界
- `internal/observability`: metrics、traces、structured logging の境界

`internal/gen/realtime/v1` は protobuf generator の出力先です。`.proto` の source of truth は `packages/contracts/proto/` にあり、生成パイプラインが導入されるまでこの module に手書きの protobuf Go code は置きません。

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
