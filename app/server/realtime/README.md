# Unframe Realtime Runtime

Go 1.25.7 と gRPC を使う、Control Plane から独立した Cloud / Venue Edge 共通 Realtime Runtime の実行基盤です。`RealtimeService.Connect` は Control Plane の JWKS で session-bound Runtime JWT を検証し、local `RuntimeAssignment` の session、Runtime ID / kind、epoch、Presentation revision、lease で接続と command を fencing します。JWKS cache は5分で失効し、refresh 失敗時は stale key を使用しません。protocol-version handshake 後は presenter の page-change command を session 単位で採番し、接続中の participant へ順序付きで in-memory fan-out します。replay と resume は未実装です。

Realtime Backend / Venue Edge の目標設計は [ARCHITECTURE.md](./ARCHITECTURE.md)、Control Plane との authority handoff は [`../ARCHITECTURE.md`](../ARCHITECTURE.md) を参照してください。

## 起動

```sh
cd app/server/realtime
set -a
source .env.example
set +a
go run ./cmd/server
```

`REALTIME_LISTEN_ADDR` で listen address を指定でき、既定値は `:9090` です。起動には `REALTIME_ISSUER`、Control Planeと共通の`REALTIME_AUDIENCE=unframe-realtime-runtime`、`REALTIME_JWKS_URL` と、Control Plane が発行した assignment の `REALTIME_SESSION_ID`、`REALTIME_RUNTIME_ID`、`REALTIME_RUNTIME_KIND`、`REALTIME_RUNTIME_ENDPOINT`、`REALTIME_ASSIGNMENT_EPOCH`、`REALTIME_PRESENTATION_REVISION`、`REALTIME_ASSIGNMENT_ISSUED_AT`、`REALTIME_LEASE_EXPIRES_AT` が必要です。lease duration は Runtime 側で補完せず、Control Plane の値をそのまま使用します。

標準 gRPC Health Checking service は process 起動だけでは `SERVING` になりません。composition root が local assignment lease と JWKS cache を期限付きで確認した後に application ready を公開し、稼働中も再評価して依存障害時または shutdown 開始時に `NOT_SERVING` へ戻します。assignment guard は期限後の command / reliable delivery を拒否しますが、`NOT_SERVING` 遷移時に既存の idle stream を閉じて Session Runtime を pause する lifecycle 接続は未実装です。`SIGINT` または `SIGTERM` を受け取ると、10秒を上限に graceful shutdown します。

## 構成

- `cmd/server`: listener と signal handling を組み立てる composition root
- `internal/runtimecore`: 配置 profile に依存しない Coordinator と Runtime Assignment Guard の composition 境界
- `internal/transport/grpc`: gRPC の起動・停止、service registration、stream lifecycle
- `internal/auth`: caller と service identity の検証境界
- `internal/assignment`: Cloud / Venue Edge 共通の assignment lease / epoch fencing
- `internal/asset`: Manifest検証、content-addressed prefetch cache、Range対応HTTP配信の境界
- `internal/protocol`: generated wire type と内部入力の変換・検証境界
- `internal/session`: session 中だけ存在する状態とRunning / Paused / Terminatingの調整境界
- `internal/state`: Element Stateのfield merge / latest-wins mailbox
- `internal/persistence/http`: Control Plane HTTP client 境界
- `internal/observability`: stream metrics と structured logging の境界

`internal/gen/realtime/v1` は protobuf generator の出力先です。`.proto` の source of truth は `packages/contracts/proto/` で、generated Go files は手で編集しません。repository root の Nix development shell で `scripts/contracts/generate-proto.sh check` を実行すると drift を検出できます。

接続の session、participant、role、Runtime ID / kind、assignment epoch、Presentation revision は message payload ではなく、認証 interceptor が検証して stream context へ設定した identity から取得します。gRPC server は JWT verifier、assignment guard、session coordinator なしでは構築できません。

現在の composition root は `runtimeKind` にかかわらず同じ Runtime Core を起動しますが、単一 Session の assignment は環境変数から読み取ります。Control Plane から assignment / Manifest を取得して lease を更新する profile adapter、Asset Gateway の local HTTPS listener、runtime state machine と State mailbox の gRPC contract への接続は後続実装です。`internal/persistence/http` の callback client / bounded buffer も transport 境界までで、Snapshot schema や session lifecycle には未接続です。`internal/asset`、`internal/session.Runtime`、`internal/state` は transport-independent な検証済み domain primitive です。

`fly.toml` は TLS 終端から H2C backend へ接続する共通 service profile だけを定義します。app、region、Machine 構成、autoscaling、Runtime identity、health routing は未決定であり、この repository では固定していません。

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
