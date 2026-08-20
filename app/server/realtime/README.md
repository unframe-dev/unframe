# Unframe Realtime Backend

Go 1.25.7 と gRPC を使う、Control Plane から独立した Venue Edge Realtime Backend の実行基盤です。`RealtimeService.Connect` はControl PlaneのJWKSでsession-bound JWTを検証し、local assignmentのsession、Edge ID、epoch、Presentation revision、leaseで接続とcommandをfencingします。JWKS cacheは5分で失効し、refreshでControl Planeから削除された鍵を反映します。protocol-version handshake後はpresenterのpage-change commandをsession単位で採番し、接続中のparticipantへ順序付きでin-memory fan-outします。replayとresumeは未実装です。

## 起動

```sh
cd app/server/realtime
set -a
source .env.example
set +a
go run ./cmd/server
```

`REALTIME_LISTEN_ADDR` で listen address を指定でき、既定値は `:9090` です。起動には `REALTIME_ISSUER`、`REALTIME_JWKS_URL` と、Control Planeが発行したassignmentの `REALTIME_SESSION_ID`、`REALTIME_EDGE_ID`、`REALTIME_ASSIGNMENT_EPOCH`、`REALTIME_PRESENTATION_REVISION`、`REALTIME_ASSIGNMENT_ISSUED_AT`、`REALTIME_LEASE_EXPIRES_AT` が必要です。lease durationはRuntime側で補完せず、Control Planeの値をそのまま使用します。`SIGINT` または `SIGTERM` を受け取ると、10秒を上限にgraceful shutdownします。

## 構成

- `cmd/server`: listener と signal handling を組み立てる composition root
- `internal/transport/grpc`: gRPC の起動・停止、service registration、stream lifecycle
- `internal/auth`: caller と service identity の検証境界
- `internal/edge`: assignment lease / epoch fencing
- `internal/asset`: Manifest検証、content-addressed prefetch cache、Range対応HTTP配信の境界
- `internal/protocol`: generated wire type と内部入力の変換・検証境界
- `internal/session`: session 中だけ存在する状態とRunning / Paused / Terminatingの調整境界
- `internal/state`: Element Stateのfield merge / latest-wins mailbox
- `internal/persistence/http`: Control Plane HTTP client 境界
- `internal/observability`: metrics、traces、structured logging の境界

`internal/gen/realtime/v1` は protobuf generator の出力先です。`.proto` の source of truth は `packages/contracts/proto/` で、generated Go files は手で編集しません。repository root の Nix development shell で `scripts/contracts/generate-proto.sh check` を実行すると drift を検出できます。

接続のsession、participant、role、Edge、assignment epoch、Presentation revisionはmessage payloadではなく、認証interceptorが検証してstream contextへ設定したidentityから取得します。gRPC serverはJWT verifierとassignment guardなしでは構築できません。

現在のcomposition rootは単一roomのassignmentを環境変数から読み取ります。Control Planeからassignment / Manifestを取得してleaseを更新するCloud Agent、Asset Gatewayのlocal HTTPS listener、runtime state machineとState mailboxのgRPC contractへの接続は後続実装です。`internal/asset`、`internal/session.Runtime`、`internal/state`はそれらのtransport-independentな検証済みdomain primitiveです。

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
