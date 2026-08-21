# Realtime Runtime TODO

## 実装済み foundation

- Cloud / Venue Edge 共通の `RuntimeAssignment`、`runtimeId`、`runtimeKind`、lease / epoch fencing
- Venue Edge Bearer credential と Edge ID の provisioning identity への分離
- session-bound Runtime JWT、必須 audience 設定、strict JWKS 検証、cache TTL / refresh cooldown
- 配置 profile に依存しない Runtime Core composition と単一 room gRPC process
- application readiness と標準 gRPC Health Checking service の分離
- credential を記録しない stream log と in-process metrics
- assignment-bound checkpoint / completion HTTP client と bounded callback buffer
- Fly Proxy の TLS / HTTP/2 から H2C backend へ接続する service profile
- Manifest 検証、content-addressed Asset cache、Range 配信、Runtime pause / resume、Element State mailbox の domain primitive

## 部分実装

- callback API / client / buffer はあるが、Snapshot schema と session lifecycle へ未接続
- callback API は既存 service identity で認証しており、Venue Edge credential / Cloud platform identity の profile 別 adapter は未接続
- Runtime Assignment の assign / read / bootstrap は共通化済みだが、renew / release API は Venue Edge profile だけで、Cloud lifecycle は未実装
- readiness は lease / JWKS 失効を反映するが、既存 idle stream の終了と Session Runtime pause へ未接続
- Asset Gateway は handler までで、Venue Edge local HTTPS listener と証明書管理へ未接続
- runtime pause / resume と Element State mailbox は gRPC protocol へ未接続
- observability は stream log / metrics までで、exporter、trace、dashboard、alert は未実装
- `fly.toml` は service profile だけで、app、region、Machine、autoscaling、Runtime identity、health routing は未決定

## 次の実装

### Cloud Runtime lifecycle

- [ ] Control Plane と Fly.io の Runtime 登録・起動 lifecycle を設計する
- [ ] Runtime instance と Fly.io Machine の identity / lifetime を決める
- [ ] public endpoint と application readiness を Fly.io routing へ接続する
- [ ] assignment / lease 更新と graceful drain を profile adapter へ接続する
- [ ] deploy / update / rollback 手順を確定する

### Runtime protocol / state

- [ ] Control / State channel を分離する
- [ ] Presenter Tracking Frame と離散 Input Event を定義する
- [ ] Step / Cue / Action / Transition evaluator を実装する
- [ ] canonical Element State と reliable event を生成する
- [ ] protocol ごとの message size、participant rate、invalid-message count 制限を実装する
- [ ] Snapshot / Replay / Connection Resume contract を確定して実装する
- [ ] checkpoint / completion buffer を session lifecycle へ接続する

### Quest / Asset

- [ ] Unity に bootstrap、Runtime JWT、Control / State gRPC client を接続する
- [ ] Cloud 配置の R2 / CDN signed URL と readiness を実装する
- [ ] Venue Edge の Cloud Agent、Manifest prefetch、local HTTPS listener を実装する
- [ ] certificate fingerprint pinning と rotation を実装する

### 検証 / 運用

- [ ] 1 / 10 / 25 / 50 Quest で latency、jitter、fan-out、Asset ready を測定する
- [ ] slow viewer、reconnect、lease expiry、process / Machine restart を試験する
- [ ] Runtime 共通 audience の具体値と旧値からの移行方法を protocol contract で決める
- [ ] region、Machine 構成、autoscaling、durable Snapshot、rolling update を実測後に決める

## 現在の制限

- 通常 process は単一 room の assignment を環境変数から読み取る
- page-change 以外の Presentation runtime protocol は未実装
- session state は process memory のみにあり、再起動で失われる
- Runtime 自動選定と session 作成 UI / API からの配置先選択は未接続
- Fly.io app 作成、公開 DNS / certificate、deploy は実施していない

## 検証

- [ ] `nix run .#realtime` が成功する
- [ ] `nix run .#check` が成功する
- [ ] Docker image を build して non-root で起動できる
- [ ] gRPC health が readiness 前 / shutdown 中に `NOT_SERVING`、依存確認後に `SERVING` となる
- [ ] Cloud / Venue Edge の両 Runtime kind で JWT / assignment fencing が成立する
- [ ] stale な Venue Edge heartbeat が assignment / bootstrap から除外される
- [ ] lease 失効時に blocked reliable send も終了する
- [ ] TLS / HTTP2 経由の gRPC smoke test を公開 endpoint 決定後に実行する
