# Unframe Realtime Runtime

Go 1.25.7 と gRPC を使う、Control Plane から独立した Cloud / Venue Edge 共通 Realtime Runtime です。Control Plane の JWKS で session-bound Runtime JWT を検証し、assignment の session、Runtime ID / kind、epoch、Presentation revision、lease で接続と command を fencing します。JWKS cache は5分で失効し、refresh 失敗時は stale key を使用しません。v2 Control / State service は publication-pinned Definition と participant projection を使います。Runtime JWT の protocol version は 2 のみ受理し、v1 service は登録しません。

Realtime Backend / Venue Edge の目標設計は [ARCHITECTURE.md](./ARCHITECTURE.md)、Control Plane との authority handoff は [`../ARCHITECTURE.md`](../ARCHITECTURE.md) を参照してください。

## 起動

```sh
cd app/server/realtime
set -a
source .env.example
set +a
go run ./cmd/server
```

`REALTIME_LISTEN_ADDR` で listen address を指定でき、既定値は `:9090` です。起動には `REALTIME_ISSUER`、Control Planeと共通の`REALTIME_AUDIENCE=unframe-realtime-runtime`、`REALTIME_JWKS_URL` と、Control Plane が発行した assignment の `REALTIME_SESSION_ID`、`REALTIME_RUNTIME_ID`、`REALTIME_RUNTIME_KIND`、`REALTIME_RUNTIME_ENDPOINT`、`REALTIME_ASSIGNMENT_EPOCH`、`REALTIME_PRESENTATION_REVISION`、`REALTIME_ASSIGNMENT_ISSUED_AT`、`REALTIME_LEASE_EXPIRES_AT` が必要です。lease duration は Runtime 側で補完せず、Control Plane の値をそのまま使用します。`REALTIME_CONTROL_PLANE_URL` と32文字以上の `REALTIME_SERVICE_IDENTITY` も必須です。起動時に service Bearer で Control Plane の internal bootstrap を取得し、publication-pinned Definition を検証して v2 service を登録します。service identity をログやクライアントへ渡してはいけません。

標準 gRPC Health Checking service は process 起動だけでは `SERVING` になりません。composition root が local assignment lease と JWKS cache を期限付きで確認した後に application ready を公開し、稼働中も再評価して依存障害時または shutdown 開始時に `NOT_SERVING` へ戻します。assignment guard は期限後の command / reliable delivery を拒否しますが、`NOT_SERVING` 遷移時に既存の idle stream を閉じて Session Runtime を pause する lifecycle 接続は未実装です。`SIGINT` または `SIGTERM` を受け取ると、10秒を上限に graceful shutdown します。

## 構成

- `cmd/server`: listener と signal handling を組み立てる composition root
- `internal/runtimecore`: v2 canonical state / evaluator と Runtime Assignment Guard の composition 境界
- `internal/transport/grpc`: gRPC の起動・停止、service registration、stream lifecycle
- `internal/auth`: caller と service identity の検証境界
- `internal/assignment`: Cloud / Venue Edge 共通の assignment lease / epoch fencing
- `internal/protocol`: generated wire type と内部入力の変換・検証境界
- `internal/session`: 認証済み Identity と単回 State nonce の境界
- `internal/state`: Element Stateのfield merge / latest-wins mailbox
- `internal/persistence/http`: Control Plane HTTP client 境界
- `internal/observability`: stream metrics と structured logging の境界

v2 の generated message / service は `internal/gen/{presentation,delivery,realtime}/v2` に置く。`scripts/contracts/generate-v2-consumers.sh check` は C# とともに再生成と provenance を検査する。`internal/protocol/v2` は required variant / enum / scalar、信頼済み catalog と Snapshot の resource closure、checkpoint の生 bytes hash / identity、Connection Snapshot の fence / origin / sequence、Replay cursor / State frame の順序を検証する。checkpoint restore は logical clock を進めず `paused/processRecovered` にする。

v2 Control / State は participant projection、Snapshot / replay、入力と Cue / Timeline 実行、Tracking、checkpoint / completion を Runtime へ接続しています。失敗時の pause と復旧規則は [Architecture](ARCHITECTURE.md) と [配信・実行契約](../../../docs/packages/CONTRACT_RUNTIME.md) を参照してください。`pauseTimeout` policy は未定義です。Quest 実機と remote 環境の検証は [follow-up](todo.md) に残ります。

接続の session、participant、role、Runtime ID / kind、assignment epoch、Presentation revision は message payload ではなく、認証 interceptor が検証して stream context へ設定した identity から取得します。gRPC server は JWT verifier、assignment guard、v2 service なしでは構築できません。

composition root は単一 Session の assignment を環境変数から読み、Control Plane の internal bootstrap で publication と Definition を照合します。同じassignment / publicationのlease延長をControl Planeで再検証し、期限切れ時はclockと入力を停止します。lease更新だけではRuntimeを再開せず、明示resumeで再検証します。Venue Edge の v2 Asset Gateway は未実装です。`internal/state` の mailbox は transport に未接続の独立した primitive です。現在の Unity Baked Web 経路は Control Plane が発行した Asset URL から直接取得します。

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
