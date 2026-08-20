# Realtime Backend TODO

## 現状

- Go 1.25.7 / gRPC の独立した実行プロセスがある。
- `RealtimeService.Connect` の双方向 stream を実装済み。
- protocol-version handshake、session 単位の sequence、page-change の in-memory fan-out、重複排除、backpressure を実装済み。
- Protobuf は `packages/contracts/proto/` を source of truth とし、Go code の生成と drift check がある。
- `REALTIME_LISTEN_ADDR` で listen address を指定し、既定値は `:9090`。
- SIGINT / SIGTERM に対して最大 10 秒の graceful shutdown を行う。
- multi-stage build、distroless、non-root の Docker image を構築できる。
- Realtime 専用の vet、lint、test、build、race detector と Docker build check がある。
- Control Plane は session-bound Ed25519 JWT の発行と JWKS の公開を実装済み。
- Control Plane はVenue Edgeのprovisioning / registration / assignmentと、endpoint / fingerprint / assignment-bound JWTを返すbootstrapを実装済み。
- Realtime gRPC processはJWKS検証、scope検証、assignment lease / epoch fencingを実装済み。
- Manifest検証、content-addressed Asset cache、Range配信、Runtime pause/resume、Element State mailboxはdomain primitiveまで実装済み。

## 現在の制限

- assignment / ManifestをControl Planeから同期しleaseを更新するCloud Agentは未実装で、通常プロセスは単一room assignmentを環境変数から読み込む。
- session の終了状態を Realtime Backend から確認できない。
- snapshot、replay、resume、ephemeral state は未実装。
- Asset Gatewayのlocal HTTPS listenerとreadiness報告、Control / State channel分離は未実装。
- session state は process memory のみにあり、Machine の停止・再起動で失われる。
- Control Plane への checkpoint / completion 送信は未実装。
- gRPC health service、metrics、traces、運用向け structured log は未実装。
- 複数 Machine 間の session routing / affinity は未実装。
- Unity client は Realtime gRPC contract に未接続。
- Fly.io manifest、app、Machine、certificate、DNS、deploy automation は未設定。

## 公開デプロイ前の必須作業

### JWT / JWKS 認証

- [x] gRPC metadata から `Authorization: Bearer <token>` を取得する。
- [x] `REALTIME_JWKS_URL` から JWKS を取得・cacheする。
- [x] JWKS cacheを5分で失効させ、refresh失敗時はstale keyを使用しない。
- [x] 未知の `kid` を受けた場合に JWKS をrefreshする。
- [x] `alg = EdDSA`、`kid`、signatureを検証する。
- [x] `iss = REALTIME_ISSUER` を検証する。
- [x] `aud = unframe-venue-edge` を検証する。
- [x] `exp`、`nbf`、`sub`、`session_id`、`role`、`edge_id`、`assignment_epoch`、Presentation、scope、`protocol_version` を検証する。
- [x] 検証済みclaimを`session.Identity`へ変換し、stream contextへ設定する。
- [x] tokenやcredentialをlogへ出さない。
- [x] 正常系とclaim / signatureごとの異常系testを追加する。

### Session lifecycle

- [ ] 接続時に session の存在と状態を確認する。
- [ ] 終了済み session の接続を、JWT の期限内でも拒否する。
- [ ] participant と role が session の認可状態と一致することを確認する。
- [ ] 高頻度 message の hot path では Control Plane / D1 へ問い合わせない。
- [ ] session 終了を既存接続へ反映する方法を定義する。

### Health / readiness

- [ ] 標準 gRPC Health Checking Protocol を登録する。
- [ ] 起動直後、shutdown 開始時、依存障害時の serving status を定義する。
- [ ] Fly.io の初期 service check は TCP check とする。
- [ ] TCP 到達性と application readiness を区別して監視する。

## Fly.io 初期構成

- [ ] `app/server/realtime/fly.toml` を追加する。
- [ ] app name を確定する。候補は `unframe-realtime`。
- [ ] primary region を `nrt` にする。
- [ ] Docker build context を `app/server/realtime` にする。
- [ ] internal port を `9090` にする。
- [ ] Fly Proxy で TLS を終端する。
- [ ] backend を HTTP/2 cleartext（H2C）として設定する。
- [ ] external ALPN を HTTP/2 にする。
- [ ] SIGTERM と graceful shutdown に合わせて kill timeout を設定する。
- [ ] TCP health check を設定する。
- [ ] 当面は 1 Machine、`auto_stop_machines = "off"` で運用する。
- [ ] scale-out するまで session state が単一 Machine の memory にあることを運用制約として明記する。

想定する service 設定の要点:

```toml
primary_region = "nrt"

[[services]]
internal_port = 9090
protocol = "tcp"
auto_stop_machines = "off"
auto_start_machines = true
min_machines_running = 1

[[services.ports]]
port = 443
handlers = ["tls", "http"]

[services.ports.http_options]
h2_backend = true

[[services.tcp_checks]]
grace_period = "10s"
interval = "15s"
timeout = "2s"
```

## Domain / TLS

- [ ] Fly.io で `realtime.un-fra.me` の certificate を追加する。
- [ ] Fly.io が提示する DNS target を確認する。
- [ ] Cloudflare 管理下の `un-fra.me` zone に DNS record を追加する。
- [ ] certificate の発行完了を確認する。
- [ ] Control Plane の `REALTIME_ENDPOINT=https://realtime.un-fra.me` と一致することを確認する。

## Persistence / recovery

- [ ] Realtime Backend から Control Plane の checkpoint / completion callback を呼び出す。
- [ ] service identity の認証を追加する。
- [ ] bounded retry と local buffer の上限を定義する。
- [ ] process 再起動時の snapshot / replay / resume 方針を実装する。
- [ ] session state を外部化するまで複数 Machine へ scale-out しない。

## Observability

- [ ] connection、disconnect、authentication failure、backpressure、session fan-out の structured log を追加する。
- [ ] credential、JWT、authorization metadata を秘匿する。
- [ ] active stream、session、message rate、queue overflow、latency の metrics を追加する。
- [ ] trace の境界と sampling 方針を定義する。
- [ ] alert と dashboard を用意する。

## Deployment 手順

- [ ] `nix run nixpkgs#flyctl -- auth login` で Fly.io にログインする。
- [ ] organization と app name を確認する。
- [ ] Fly app を作成する。
- [ ] 東京リージョンに 1 Machine で初回 deploy する。
- [ ] `fly status`、`fly checks list`、`fly logs` で状態を確認する。
- [ ] certificate と DNS を設定する。
- [ ] gRPC smoke test を実行する。
- [ ] rollback 手順を確認する。
- [ ] deploy automation と必要な `FLY_API_TOKEN` の管理方法を定義する。

## 完了前の検証

- [ ] `nix run .#realtime` が成功する。
- [ ] `nix run .#check` が成功する。
- [ ] Docker image を build して non-root で起動できる。
- [ ] TCP health check が成功する。
- [ ] TLS / HTTP2 で gRPC 接続できる。
- [ ] credential なし、署名不正、期限切れ、issuer 不一致、audience 不一致を拒否する。
- [ ] 有効な credential で protocol handshake が成功する。
- [ ] presenter の page-change が接続中 participant へ順序付きで配信される。
- [ ] viewer の page-change を `PermissionDenied` で拒否する。
- [ ] SIGTERM 時に新規接続を止め、既存 stream を graceful に終了する。
- [ ] Machine 再起動時に state が失われる現在の制限を確認・記録する。
- [ ] `realtime.un-fra.me:443` から外形確認する。
