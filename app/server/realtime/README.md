# Unframe Realtime Runtime

Go 1.25.7 と gRPC を使う、Control Plane から独立した Cloud / Venue Edge 共通 Realtime Runtime です。Control Plane の JWKS で session-bound Runtime JWT を検証し、assignment の session、Runtime ID / kind、epoch、Presentation revision、lease で接続と command を fencing します。JWKS cache は5分で失効し、refresh 失敗時は stale key を使用しません。v2 Control / State service は publication-pinned Definition と participant projection を使います。v1 page-change service も独立した protocol-version 検証付きで登録しています。

Realtime Backend / Venue Edge の目標設計は [ARCHITECTURE.md](./ARCHITECTURE.md)、Control Plane との authority handoff は [`../ARCHITECTURE.md`](../ARCHITECTURE.md) を参照してください。

## 起動

```sh
cd app/server/realtime
set -a
source .env.example
set +a
go run ./cmd/server
```

`REALTIME_LISTEN_ADDR` で listen address を指定でき、既定値は `:9090` です。起動には `REALTIME_ISSUER`、Control Planeと共通の`REALTIME_AUDIENCE=unframe-realtime-runtime`、`REALTIME_JWKS_URL` と、Control Plane が発行した assignment の `REALTIME_SESSION_ID`、`REALTIME_RUNTIME_ID`、`REALTIME_RUNTIME_KIND`、`REALTIME_RUNTIME_ENDPOINT`、`REALTIME_ASSIGNMENT_EPOCH`、`REALTIME_PRESENTATION_REVISION`、`REALTIME_ASSIGNMENT_ISSUED_AT`、`REALTIME_LEASE_EXPIRES_AT` が必要です。lease duration は Runtime 側で補完せず、Control Plane の値をそのまま使用します。`REALTIME_CONTROL_PLANE_URL` と32文字以上の `REALTIME_SERVICE_IDENTITY` も必須です。起動時に service Bearer で Control Plane の internal bootstrap を取得し、publication-pinned Definition を検証して v2 service を登録します。service identity をログやクライアントへ渡してはいけません。起動前に bootstrap の検証済み lease を guard へ反映します。5秒間隔の定期更新（要求timeoutは5秒）と明示 resume には `GET /internal/runtime/lease` を使い、assignment と publication fence だけを取得します。Definition、RenderBundle、checkpoint は再取得しません。

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

v2 の generated message / service は `internal/gen/{presentation,delivery,realtime}` に置く。`scripts/contracts/generate-consumers.sh check` は C# とともに再生成と provenance を検査する。`internal/protocol/v2` は required variant / enum / scalar、信頼済み catalog と Snapshot の resource closure、checkpoint の生 bytes hash / identity、Connection Snapshot の fence / origin / sequence、Replay cursor / State frame の順序を検証する。checkpoint restore は logical clock を進めず `paused/processRecovered` にする。

v2 は Control / State service registration、single-use nonce、Snapshot cut と subscriber 登録、bounded reliable replay、Logical Input / Surface Interaction、Guard と即時 Action、checkpoint 書込み・復元を application に接続しています。checkpoint 保存に失敗した Command は変更を戻して fault pause にし、event を公開しません。復元直後に過去の in-memory event log は存在しないため、保持範囲外の resume は Snapshot 再同期を要求します。Timeline / Surface transition / Media / Model Run、Group 遷移、Timer、Presence、Runtime Control、fault 時の pause、completion callback を接続しました。assignment lease の再検証、Presenter disconnect による pause、再検証後の明示 resume を実装しています。各 mutation の checkpoint を保存してから event を公開し、時計だけの進行は最大1秒に一回保存します。復旧では最新 checkpoint を使い、Session 開始日時、過去の参加者、保持期間内の command outcome と fingerprint も復元します。この recovery metadata を欠く checkpoint は Runtime 起動時に拒否します。checkpoint の hash / fence / snapshot 検証に失敗した場合は起動を拒否します。`recoveryGap` 中の resume も拒否します。`pauseTimeout` は期間と自動終了 policy が未定義のため未実装です。Presenter State stream は Tracking frame を受理して Cue と Anchor binding を評価します。ローカルの実 Control Plane と TLS 接続では Cue 実行、replay / resume、checkpoint 保存と Session 終了を確認しています。Video / Model の配信受理と Unity 実機での表示は、consumer と capability 条件の検証が別途必要です。

接続の session、participant、role、Runtime ID / kind、assignment epoch、Presentation revision は message payload ではなく、認証 interceptor が検証して stream context へ設定した identity から取得します。gRPC server は JWT verifier、assignment guard、session coordinator なしでは構築できません。

composition root は単一 Session を起動します。lease期限切れ時はclockと入力を停止し、lease更新だけではRuntimeを再開しません。Asset Gatewayのlocal HTTPS listenerは未接続です。`internal/asset` の cache と `internal/state` の mailbox は独立した primitive であり、v2 transport の配線済み機能とは区別してください。現在の Unity Baked Web 経路は Control Plane が発行した Asset URL から直接取得します。

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
