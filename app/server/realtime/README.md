# Unframe Realtime Runtime

Go 1.25.7 と gRPC を使う、Control Plane から独立した Cloud / Venue Edge 共通 Realtime Runtime です。Control Plane の JWKS で session-bound Runtime JWT を検証し、assignment の session、Runtime ID / kind、epoch、Presentation revision、lease で接続と command を fencing します。JWKS cache は5分で失効し、refresh 失敗時は stale key を使用しません。Control / State service は publication-pinned Definition と participant projection を使い、Runtime JWT と handshake は v3 のみ受理します。旧 wire / schema version の入力・checkpoint の移行経路は設けません。

Realtime Backend / Venue Edge の目標設計は [ARCHITECTURE.md](./ARCHITECTURE.md)、Control Plane との authority handoff は [`../ARCHITECTURE.md`](../ARCHITECTURE.md) を参照してください。

## Venue Edge の起動

Cloud は下記の Cloud Host を使用します。以下は登録・割り当て済み Venue Edge 用です。[会場検証手順](../../../docs/validation/venue-edge-asset-delivery.md#会場構成と証明書)に従い、環境変数例の仮値を置き換え、TLS 証明書・鍵・cache のパスを設定してから起動します。

```sh
cd app/server/realtime
set -a
source .env.example
set +a
go run ./cmd/server
```

`REALTIME_LISTEN_ADDR` で listen address を指定でき、既定値は `:9090` です。起動には `REALTIME_ISSUER`、Control Planeと共通の`REALTIME_AUDIENCE=unframe-realtime-runtime`、`REALTIME_JWKS_URL` と、Control Plane が発行した assignment の `REALTIME_SESSION_ID`、`REALTIME_RUNTIME_ID`、`REALTIME_RUNTIME_KIND`、`REALTIME_RUNTIME_ENDPOINT`、`REALTIME_ASSIGNMENT_EPOCH`、`REALTIME_PRESENTATION_REVISION`、`REALTIME_ASSIGNMENT_ISSUED_AT`、`REALTIME_LEASE_EXPIRES_AT` が必要です。lease duration は Runtime 側で補完せず、Control Plane の値をそのまま使用します。`REALTIME_CONTROL_PLANE_URL` と32文字以上の `REALTIME_SERVICE_IDENTITY` も必須です。起動時に service Bearer で Control Plane の internal bootstrap を取得し、publication-pinned Definition を検証して service を登録します。service identity をログやクライアントへ渡してはいけません。起動前に bootstrap の検証済み lease を guard へ反映します。5秒間隔の定期更新（要求timeoutは5秒）と明示 resume には `GET /internal/runtime/lease` を使い、assignment と publication fence だけを取得します。Definition、RenderBundle、checkpoint は再取得しません。

ブラウザ Audience の Viewer は同じ listener の `/browser/control` と `/browser/state` に WebSocket 接続します。`REALTIME_BROWSER_ORIGINS` に許可する HTTPS origin をカンマ区切りで指定してください。未設定時はブラウザ接続を無効にし、Origin のない要求も拒否します。HTTPS ingress は同じ advertised endpoint の native gRPC（HTTP/2）と WebSocket upgrade（HTTP/1.1）の両方をこのポートへ転送する必要があります。Cloud の TLS は ingress で終端し、Venue Edge は自身の HTTPS listener で終端します。パス prefix は使用しません。接続フレームと認証の契約は [browser-realtime.md](../../../packages/contracts/browser-realtime.md) を参照してください。停止時はブラウザ接続を閉じて Runtime の参加状態を解放し、native gRPC は従来の graceful drain を行います。

Session 終了・assignment 解放は次の lease 要求に対する Control Plane の 409 応答で検出します。401 / 403 / 404 / 409 / 410、無効な lease 応答、assignment / publication fence の変更を受け取ると、保持中 lease の期限を待たずに guard を不可逆に失効させます。同じ process での lease 更新や明示 resume では復活せず、有効な assignment で process を起動し直す必要があります。通信障害、timeout、429、5xx では保持中 lease の期限を上限に継続し、期限後は停止します。Control Plane の変更から検出までには5秒周期と要求完了までの遅延があり、push 通知による即時停止ではありません。

標準 gRPC Health Checking service は process 起動だけでは `SERVING` になりません。composition root が local assignment lease と JWKS cache を期限付きで確認した後に application ready を公開し、稼働中も再評価して依存障害時または shutdown 開始時に `NOT_SERVING` へ戻します。assignment guard は lease 期限切れ・失効後の新規接続、再接続、command / reliable delivery を拒否します。Runtime clock は20ms周期で停止条件を確認し、lease が無効なら `assignmentLeaseExpired` で pause します。既存 Control / State 接続は idle、handshake 待ち、送信待ちも含めて停止条件を再検証し、失効検出後は通常のスケジューリング下で最大1秒以内に閉じます。JWKS のみの障害による `NOT_SERVING` は既存接続を閉じません。`SIGINT` または `SIGTERM` を受け取ると、10秒を上限に graceful shutdown します。

`SSL_CERT_FILE` に PEM 形式の CA 証明書ファイルを指定すると、macOS を含む各 OS で HTTP client の信頼ストアにシステム証明書と併せて読み込み、JWKS と Control Plane の HTTPS 通信に使用します。ホスト名と証明書の検証は維持します。未設定時は標準の HTTP client を使用し、指定ファイルが読めない場合や有効な証明書を含まない場合は起動を中止します。

## Cloud Host

repository root から `nix run .#runtime-host` で常駐 Host を build・起動します。事前に次の環境変数を設定してください。

- `REALTIME_CONTROL_PLANE_URL`、`REALTIME_SERVICE_IDENTITY`: Control Plane の HTTPS origin と service identity。
- `REALTIME_RUNTIME_ID`、`REALTIME_RUNTIME_ENDPOINT`: Host 固有 ID と、同じ listener へ native gRPC／WebSocket を転送する HTTPS origin。
- `REALTIME_LISTEN_ADDR`: 共通 listener の bind address（例 `127.0.0.1:9090`）。
- `REALTIME_ISSUER`、`REALTIME_AUDIENCE`、`REALTIME_JWKS_URL`: Runtime と共通の認証設定。
- `REALTIME_BROWSER_ORIGINS`: 許可する Audience の HTTPS origin。独自 CA の場合は `SSL_CERT_FILE`。
- `REALTIME_HOST_CAPACITY`: 同時に収容する Session 数（1〜256、必須）。配備環境で明示し、Funnel の帯域・代表負荷の測定から決定します。ローカルテストは公開環境の収容数を保証しません。
- `REALTIME_HOST_DRAIN`: `true` なら新規受付を止めます。既存 Session の lease 更新は継続します。

Host は一つのプロセス・listener で複数 Session を管理します。起動時の `POST /internal/runtime/hosts/{runtimeId}/start` で boot generation を取得し、5秒ごとの heartbeat で各 Session の epoch・実行状態を報告して割り当て一覧を受け取ります。Session・epoch・revision・lease は応答から設定します。認証済み JWT または WebSocket 認証メッセージから Session を選び、未割り当ての Session を要求から生成しません。Host の生存と Session の ready は別に扱います。

実行を作り直すたびに新しい epoch を取得します。同じ boot で旧実行の停止を確認できれば再割り当てし、新 boot では更新を止めた旧 lease の失効を待ちます。終了・明示解放済み、別 Host へ移動済みの Session は自動復元しません。保存済み checkpoint を検証して paused へ復元し、checkpoint がない復旧も `paused/processRecovered` にします。新 fence の復旧 checkpoint の保存後に ready を報告し、Presenter の入力同期と明示 resume を待ちます。破損 checkpoint で初期状態へ代替しません。

Ctrl-C では受付を止め、各 Session の保存と停止を全体10秒を上限に試みます。boot 登録は開始時刻の単調増加を検証するため、ホストの時計が前回起動より逆行すると登録を拒否します。VM 作成や TLS ingress の構築は行いません。Cloud は `cmd/runtime-host` を使用し、静的 assignment を使う `cmd/server` は Venue Edge 用です。Venue Edge は bootstrap 時に起動 ID を割り当てへ一度だけ紐づけ、別プロセスによる同じ epoch の再利用を拒否します。再起動前に旧実行を停止・明示 release し、旧 lease の失効後に新しい assignment の取得が必要です。checkpoint がない新 epoch の復旧も paused とします。Venue Edge の自動割り当て Agent・複数 Session 管理は本変更の対象外です。

### 自宅 Caddy 経由で公開する

`realtime.un-fra.me` で Quest の native gRPC と Audience の WebSocket を受け、自宅の Caddy から同じマシンの Runtime へ転送する構成です。

```text
Quest / Audience ── HTTPS ── Control Plane (Workers): 認証・参加・Delivery・bootstrap
Quest / Audience ── gRPC / WSS ── realtime.un-fra.me (Caddy) ── HTTP / H2C ── Runtime
Runtime Host / Runtime ── HTTPS ── Control Plane (Workers): heartbeat・lease・checkpoint
```

この repository は [Caddy 設定例](ops/Caddyfile.example)、[Host 環境変数例](ops/runtime-host.env.example)、起動手順と [macOS の Runtime Host 配備](ops/launchd.md) を管理します。適用する Caddy 設定の正本、DNS、自宅ホストへの Caddy 導入・常駐・firewall、証明書の永続保存は infra / ホスト設定 repository で管理します。秘密値と証明書の実データは Git へ保存しません。

#### 公開前の準備

- Control Plane に Runtime Host API と D1 migration（`0015_runtime_host_sessions.sql` まで）が適用され、公開済み Dist から Session を作成できることを確認します。
- `realtime.un-fra.me` の DNS と自宅への TCP 443 の到達性を infra 側で準備し、確認してから起動します。直接公開できない回線では native gRPC と WebSocket を通せる中継経路が必要です。
- infra 側の Caddy 設定へ設定例の site block を反映し、公開証明書の取得・更新、listen port の権限と永続保存先を設定します。[Caddy の自動 HTTPS](https://caddyserver.com/docs/automatic-https) の到達条件も確認してください。
- Audience の HTTPS origin を Control Plane の `AUDIENCE_ORIGIN` と Host の `REALTIME_BROWSER_ORIGINS` に設定します。Audience の `VITE_AUDIENCE_API_ORIGIN` は Control Plane の HTTPS origin にします。

Caddy 設定例は `/browser/*` を HTTP / WebSocket、それ以外を H2C の gRPC として `127.0.0.1:9090` へ転送し、path と Origin を保持します。公開 endpoint に path prefix を追加しません。Caddy と Runtime を同じマシンで動かし、Runtime の port は loopback のみに bind します。[Caddy の reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) が WebSocket upgrade と H2C を扱います。

#### 起動

repository root から、環境変数例を Git 外へコピーします。

```sh
mkdir -p "$HOME/.config/unframe"
cp -n app/server/realtime/ops/runtime-host.env.example "$HOME/.config/unframe/runtime-host.env"
chmod 600 "$HOME/.config/unframe/runtime-host.env"
```

コピー先の `REALTIME_SERVICE_IDENTITY` に Control Plane の `SERVICE_IDENTITY_SECRET` と同じ32文字以上の値を設定し、`REALTIME_BROWSER_ORIGINS` の仮 origin を実際の Audience origin へ置き換えます。Control Plane の接続先を変える場合は URL・issuer・JWKS URL をその環境と揃えます。Host ID はホスト固有の安定した値にし、`REALTIME_RUNTIME_ENDPOINT` を Caddy の公開 origin と一致させます。

このファイルは shell で読み込むため、秘密値は単一引用符で囲みます（`REALTIME_SERVICE_IDENTITY='...'`）。値に単一引用符が含まれる場合は、その位置を `'\''` に置き換えます。

infra 側に配置した設定を Caddy の実行ユーザーで検証・起動します。次の `/path/to/infra/Caddyfile` は実際の設定ファイルへ置き換えてください。

```sh
caddy validate --config /path/to/infra/Caddyfile --adapter caddyfile
caddy run --config /path/to/infra/Caddyfile --adapter caddyfile
```

別のターミナルで、repository root から Host を起動します。

```sh
(
  set -a
  . "$HOME/.config/unframe/runtime-host.env"
  set +a
  nix run .#runtime-host
)
```

Host は登録後に割り当てを待ち、Session の準備要求を受けて Runtime を起動します。割り当て待ちでも共通 listener は存在しますが、未準備の Session への接続は拒否します。Session ID・epoch・revision・lease を環境変数へ追加する必要はありません。

#### 接続確認と停止

1. 発表者または管理者として Console にログインし、公開済み Presentation の Session を作成します。ルーム画面の「発表環境を準備」を押し、「発表環境の準備ができました。」を確認します。API を直接使う場合も発表者または管理者の認証が必要で、`POST /sessions/{id}/runtime-preparation` の後、同 URL の GET が `ready` になることを確認します。空き Host がない場合は `409 runtime_unavailable` です。Quest の発表者導線でも Session 作成後に準備を要求します。
2. Session の bootstrap の `endpoint` が `https://realtime.un-fra.me` であることを確認し、外部回線の Quest で gRPC 接続、Audience でルーム参加から Control / State の WebSocket 接続・素材準備まで確認します。`ready` は Session の準備状態なので、公開経路の疎通確認は別に必要です。
3. 発表を開始して進行・一時停止・再開が両端末へ反映されることを確認します。素材は Delivery に記載された URL から取得し、Caddy 設定例は素材配信を追加しません。

手動起動した Host はそのターミナルの Ctrl-C で停止します。Caddy を手動起動した場合は別ターミナルの Ctrl-C で停止します。Mac の Runtime Host は [launchd 配備手順](ops/launchd.md) で常駐できます。Caddy の常駐・設定反映は infra 側で管理します。

## 保存と復旧

通常操作・入力同期 READY・Reliable event はメモリ上で確定して公開し、保存を待ちません。変更のある Session を1秒間隔で checkpoint 対象とし、送信中の一件と未送信の最新 cut を保持します。再試行は payload・version・冪等キーを変えず、backoff を使います。Host 全体の同時保存は4件が上限です。保存失敗だけでは通常進行を止めず、保存障害中のクラッシュでは巻き戻り幅に上限を保証しません。

復旧時の ready と発表終了は保存確定を必要とします。終了の最終 checkpoint・Session の Ended 化・割り当て解放が確定するまで終了完了を公開しません。Session ごとの保存成功時刻、保存済み / 現在の Reliable sequence、失敗と retry 状態は `CheckpointStatus()` と Host の構造化ログで確認できます。本文や資格情報はログへ出しません。

## 構成

- `cmd/runtime-host` / `internal/host`: Cloud の共通 listener、Session 管理、boot generation と heartbeat
- `cmd/server`: Venue Edge の listener と signal handling を組み立てる composition root
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

Control / State は participant projection、Snapshot / replay、入力と Cue / Timeline 実行、Pose、checkpoint / completion を Runtime へ接続しています。失敗時の pause と復旧規則は [Architecture](ARCHITECTURE.md) と [配信・実行契約](../../../docs/packages/CONTRACT_RUNTIME.md) を参照してください。`pauseTimeout` policy は未定義です。Quest 実機、Funnel 経由の複数 Session と代表負荷は[再設計計画](../../../docs/plans/realtime-runtime-redesign.md)の未検証項目です。

[Presenter authority v3](../../../docs/packages/CONTRACT_PRESENTER_AUTHORITY.md) の入力受付・復旧を実装しています。Logical / Surface / Gesture / Zone は入力文脈と command epoch を検証し、認識済み Gesture / Zone の Cue を評価します。Pose は最新値と Anchor 投影に使い、server で Gesture / Zone を再認識しません。pause / resume / 再校正 / Step 入場・再接続では入力同期を要求し、Presenter の ACK をメモリ上で確定してから通常入力を再開します。

Outcome と共有状態は一体でメモリ上に確定し、同じ実行世代の同じ ID・内容の再送へ確定済み結果を返します。記録は容量上限前の同期 ACK と command epoch 更新で整理します。pause の凍結 Anchor を checkpoint と一括 Reliable 更新に保存し、resume 後の有効 Pose を待つ間も保持します。到達済み Step の選択は直近開始状態を復元して paused にし、Run ID・時計・参照と Timer を再構築します。開始状態全体は配布せず、Presenter 専用 catalog に選択可能な ID だけを含めます。検証範囲と残事項は[移行計画](../../../docs/plans/presenter-recognition-runtime-authority-refactor.md)を参照してください。

接続の session、participant、role、Runtime ID / kind、assignment epoch、Presentation revision は message payload ではなく、認証 interceptor が検証して stream context へ設定した identity から取得します。gRPC server は JWT verifier と、単一 Session の guard / service または認証後に選択する Session router を必要とします。

Venue Edge の composition root は単一 Session の assignment を環境変数から読み、Control Plane の internal bootstrap で publication と Definition を照合します。同じassignment / publicationのlease延長をControl Planeで再検証し、期限切れ時はclockと入力を停止します。lease更新だけではRuntimeを再開せず、明示resumeで再検証します。Venue Edge は同じ Runtime endpoint に TLS / HTTP2 listener と認可付き Asset Gateway を公開します。`internal/state` の mailbox は transport に未接続の独立した primitive です。Unity は Cloud 割当では Cloud URL、VenueEdge 割当では会場内 Asset URL へ Runtime Bearer を付けて取得します。

`fly.toml` は TLS 終端から H2C backend へ接続する将来用の service profile です。参照先の `Dockerfile` は Venue Edge 用で、Cloud Host の起動 profile には未対応です。app、region、Machine 構成、autoscaling、Runtime identity、health routing は未決定であり、この repository では固定していません。

## 検証

```sh
nix run .#realtime
nix run .#realtime -- fix
```

`nix run .#realtime`はRealtime専用のvet、lint、test、build、race detectorを実行する。lint設定とDocker build contextも`app/server/realtime/`内で完結し、移行元のGo HTTP backendを必要としない。

実 Control Plane／D1／R2 と TLS ingress を使う同期・復旧 E2E は、repository root で `nix run .#realtime-e2e` を実行します。Fixed Browser の事前準備が必要です。gRPC 検証クライアントと複数の WebSocket Viewer、Chromium 上の製品 Audience を接続し、進行・pause／resume・途中参加・切断復帰・checkpoint 復元・Session 終了を検証します。`--unity --race` を付けると、実 Unity Editor の製品 SDK・Runtime・描画処理を Presenter として使用します。`e2e/` は通常の Go test では skip し、この専用入口から設定を渡したときだけ実行します。[準備と検証範囲](../../../scripts/README.md#realtime-の同期復旧-e2e)を参照してください。

## Venue Edge コンテナ

`Dockerfile` は `cmd/server` を生成する Venue Edge 用です。Cloud Host のコンテナ配備はこの入口では提供しません。

`app/server/realtime` を build context にして build します。

```sh
docker build -t unframe-realtime app/server/realtime
```

実行には割り当てと認証の環境変数、TLS 証明書・鍵、writable cache のマウントが必要です。Venue Edge の素材 cache、TLS listener、環境変数、証明書更新と会場試験は [会場検証手順](../../../docs/validation/venue-edge-asset-delivery.md) を参照してください。実機結果は未取得です。

自宅 Mac をポート開放なしで一時公開する場合は [Tailscale Funnel の起動手順](ops/funnel.md) を参照してください。
