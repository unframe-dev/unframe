# Unframe Realtime Runtime

Go 1.25.7 と gRPC を使う、Control Plane から独立した Cloud / Venue Edge 共通 Realtime Runtime です。Control Plane の JWKS で session-bound Runtime JWT を検証し、assignment の session、Runtime ID / kind、epoch、Presentation revision、lease で接続と command を fencing します。JWKS cache は5分で失効し、refresh 失敗時は stale key を使用しません。Control / State service は publication-pinned Definition と participant projection を使い、Runtime JWT と handshake は v3 のみ受理します。旧入力・checkpoint の移行経路は設けません。

Realtime Backend / Venue Edge の目標設計は [ARCHITECTURE.md](./ARCHITECTURE.md)、Control Plane との authority handoff は [`../ARCHITECTURE.md`](../ARCHITECTURE.md) を参照してください。

## 起動

```sh
cd app/server/realtime
set -a
source .env.example
set +a
go run ./cmd/server
```

`REALTIME_LISTEN_ADDR` で listen address を指定でき、既定値は `:9090` です。起動には `REALTIME_ISSUER`、Control Planeと共通の`REALTIME_AUDIENCE=unframe-realtime-runtime`、`REALTIME_JWKS_URL` と、Control Plane が発行した assignment の `REALTIME_SESSION_ID`、`REALTIME_RUNTIME_ID`、`REALTIME_RUNTIME_KIND`、`REALTIME_RUNTIME_ENDPOINT`、`REALTIME_ASSIGNMENT_EPOCH`、`REALTIME_PRESENTATION_REVISION`、`REALTIME_ASSIGNMENT_ISSUED_AT`、`REALTIME_LEASE_EXPIRES_AT` が必要です。lease duration は Runtime 側で補完せず、Control Plane の値をそのまま使用します。`REALTIME_CONTROL_PLANE_URL` と32文字以上の `REALTIME_SERVICE_IDENTITY` も必須です。起動時に service Bearer で Control Plane の internal bootstrap を取得し、publication-pinned Definition を検証して service を登録します。service identity をログやクライアントへ渡してはいけません。起動前に bootstrap の検証済み lease を guard へ反映します。5秒間隔の定期更新（要求timeoutは5秒）と明示 resume には `GET /internal/runtime/lease` を使い、assignment と publication fence だけを取得します。Definition、RenderBundle、checkpoint は再取得しません。

Session 終了・assignment 解放は次の lease 要求に対する Control Plane の 409 応答で検出します。401 / 403 / 404 / 409 / 410、無効な lease 応答、assignment / publication fence の変更を受け取ると、保持中 lease の期限を待たずに guard を不可逆に失効させます。同じ process での lease 更新や明示 resume では復活せず、有効な assignment で process を起動し直す必要があります。通信障害、timeout、429、5xx では保持中 lease の期限を上限に継続し、期限後は停止します。Control Plane の変更から検出までには5秒周期と要求完了までの遅延があり、push 通知による即時停止ではありません。

標準 gRPC Health Checking service は process 起動だけでは `SERVING` になりません。composition root が local assignment lease と JWKS cache を期限付きで確認した後に application ready を公開し、稼働中も再評価して依存障害時または shutdown 開始時に `NOT_SERVING` へ戻します。assignment guard は lease 期限切れ・失効後の新規接続、再接続、command / reliable delivery を拒否します。Runtime clock は20ms周期で停止条件を確認し、lease が無効なら `assignmentLeaseExpired` で pause します。既存 Control / State 接続は idle、handshake 待ち、送信待ちも含めて停止条件を再検証し、失効検出後は通常のスケジューリング下で最大1秒以内に閉じます。JWKS のみの障害による `NOT_SERVING` は既存接続を閉じません。`SIGINT` または `SIGTERM` を受け取ると、10秒を上限に graceful shutdown します。

`SSL_CERT_FILE` に PEM 形式の CA 証明書ファイルを指定すると、macOS を含む各 OS で HTTP client の信頼ストアにシステム証明書と併せて読み込み、JWKS と Control Plane の HTTPS 通信に使用します。ホスト名と証明書の検証は維持します。未設定時は標準の HTTP client を使用し、指定ファイルが読めない場合や有効な証明書を含まない場合は起動を中止します。

## 構成

- `cmd/server`: listener と signal handling を組み立てる composition root
- `internal/runtimecore`: v3 canonical state / evaluator と Runtime Assignment Guard の composition 境界
- `internal/transport/grpc`: gRPC の起動・停止、service registration、stream lifecycle
- `internal/auth`: caller と service identity の検証境界
- `internal/assignment`: Cloud / Venue Edge 共通の assignment lease / epoch fencing
- `internal/protocol`: generated wire type と内部入力の変換・検証境界
- `internal/session`: 認証済み Identity と単回 State nonce の境界
- `internal/state`: Element Stateのfield merge / latest-wins mailbox
- `internal/persistence/http`: Control Plane HTTP client 境界
- `internal/observability`: stream metrics と structured logging の境界

generated message / service は `internal/gen/{presentation,delivery,realtime}` に置く。`scripts/contracts/generate-consumers.sh check` は C# とともに再生成と provenance を検査する。`internal/protocol/v2` は required variant / enum / scalar、信頼済み catalog と Snapshot の resource closure、checkpoint の生 bytes hash / identity、Connection Snapshot の fence / origin / sequence、Replay cursor / State frame の順序を検証する。checkpoint restore は logical clock を進めず `paused/processRecovered` にする。

Control / State は participant projection、Snapshot / replay、入力と Cue / Timeline 実行、Pose、checkpoint / completion を Runtime へ接続しています。失敗時の pause と復旧規則は [Architecture](ARCHITECTURE.md) と [配信・実行契約](../../../docs/packages/CONTRACT_RUNTIME.md) を参照してください。`pauseTimeout` policy は未定義です。Quest 実機と remote 環境の検証は [follow-up](todo.md) に残ります。

[Presenter authority v3](../../../docs/packages/CONTRACT_PRESENTER_AUTHORITY.md) の入力受付・復旧を実装しています。Logical / Surface / Gesture / Zone は入力文脈と command epoch を検証し、認識済み Gesture / Zone の Cue を評価します。Pose は最新値と Anchor 投影に使い、server で Gesture / Zone を再認識しません。pause / resume / 再校正 / Step 入場・再接続では入力同期を要求し、Presenter の ACK を checkpoint に保存してから通常入力を再開します。

Outcome と共有状態は同じ checkpoint に保存し、同じ ID・内容の再送へ保存済み結果を返します。記録は容量上限前の同期 ACK と command epoch 更新で整理します。pause の凍結 Anchor を checkpoint と一括 Reliable 更新に保存し、resume 後の有効 Pose を待つ間も保持します。到達済み Step の選択は直近開始状態を復元して paused にし、Run ID・時計・参照と Timer を再構築します。開始状態全体は配布せず、Presenter 専用 catalog に選択可能な ID だけを含めます。検証範囲と残事項は[移行計画](../../../docs/plans/presenter-recognition-runtime-authority-refactor.md)を参照してください。

接続の session、participant、role、Runtime ID / kind、assignment epoch、Presentation revision は message payload ではなく、認証 interceptor が検証して stream context へ設定した identity から取得します。gRPC server は JWT verifier、assignment guard、Realtime service なしでは構築できません。

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
