# Tailscale Funnel での公開試験

既存のビルド済み `runtime-host` を、自宅 Mac から公開します。Quest / Audience に Tailscale は不要です。公開 URL はこの Mac の `https://<hostname>.<tailnet>.ts.net` です。

```text
Quest / Audience → Funnel TCP 443 → Caddy TLS 127.0.0.1:8443
                                      ↓ HTTP / H2C
                               Realtime 127.0.0.1:9090
```

## 準備

- [launchd 配備手順](launchd.md)のビルドと環境変数ファイルを準備します。launchd の登録は不要です。既に起動済みなら停止し、9090 / 8443 を空けてください。
- 専用の userspace `tailscaled` を起動し、同じ macOS ユーザーでログインします。daemon の起動・ログインはこの入口では行いません。
- [Funnel の要件](https://tailscale.com/docs/features/tailscale-funnel)に従い、tailnet の HTTPS 証明書と対象ノードの Funnel 権限を有効にします。CLI が承認 URL を表示したらブラウザで承認してください。

別のターミナルで daemon を起動し、そのターミナルを開いたままにします。既に同じ socket の daemon が動いていれば、この起動は不要です。

```sh
umask 077
mkdir -p "$HOME/.config/unframe/funnel"
chmod 700 "$HOME/.config/unframe/funnel"
nix shell nixpkgs#tailscale --command tailscaled \
  --tun=userspace-networking \
  --statedir="$HOME/.config/unframe/funnel" \
  --state="$HOME/.config/unframe/funnel/tailscaled.state" \
  --socket="$HOME/.config/unframe/funnel/tailscaled.sock" \
  --port=0
```

起動入口を実行するターミナルでログインします。表示された URL を開いて承認してください。`nix shell` により CLI を一時的に用意するため、グローバルなインストールは不要です。

```sh
export TS_SOCKET="$HOME/.config/unframe/funnel/tailscaled.sock"
nix shell nixpkgs#tailscale --command tailscale --socket="$TS_SOCKET" up \
  --hostname=unframe-realtime --accept-dns=false --accept-routes=false
```

## 起動と停止

repository root で実行します。

```sh
nix run .#runtime-host-funnel
```

配備物や環境変数ファイルが別の場所にある場合は絶対パスで指定します。

```sh
nix run .#runtime-host-funnel -- /absolute/release /absolute/runtime-host.env
```

`TS_SOCKET` で別の socket、`REALTIME_RELEASE_DIRECTORY` で既定の配備先を指定できます。Caddy は同じ socket から Tailscale 証明書を取得します。証明書の発行には HTTPS の事前許可が必要です。macOS の Tailscale GUI 版も同時に動かす場合、Caddy の証明書取得が GUI 側の daemon を優先することがあるため、初回の TLS 接続を確認してください。

入口は環境変数ファイルを読み、プロセス内の `REALTIME_RUNTIME_ENDPOINT` を `Self.DNSName` の HTTPS URL に置き換えます。環境変数ファイルは変更しません。Realtime の bind は loopback 9090 に固定します。再ビルドは行いません。

既存の Serve / Funnel 設定があれば拒否します。Caddy が設定を読み込み、8443 の listener を確保したことを確認してから公開します。`Ctrl-C`、SIGTERM、通常終了で、この入口が開始した Host / Caddy と TCP 443 の公開を停止します。`tailscaled` は停止しません。この入口はフォアグラウンド実行です。Mac 起動時から常駐させる場合は、下の launchd 手順を使います。

SIGKILL やクラッシュでは、`--bg` の公開設定が残る場合があります。その場合は専用 socket の設定を確認し、TCP 443 の公開を解除します。

```sh
export TS_SOCKET="$HOME/.config/unframe/funnel/tailscaled.sock"
nix shell nixpkgs#tailscale --command tailscale --socket="$TS_SOCKET" serve status --json
nix shell nixpkgs#tailscale --command tailscale --socket="$TS_SOCKET" funnel --tcp=443 off
```

試験を終えたら、daemon を起動した別ターミナルでも `Ctrl-C` で `tailscaled` を停止します。

## 接続確認

別回線から公開 URL の証明書を確認し、Session を作成して割り当てが ready になることを確認します。割り当て前の 502 は Realtime が未起動の場合に発生するため、gRPC / WSS の成功を意味しません。Quest / Audience で制御、状態更新、再接続を確認してください。

Funnel の帯域制限と `ts.net` ドメインの制約が適用されます。外部からの双方向 gRPC / WSS と実機接続は、実際の公開後に検証が必要です。

## Mac 起動時の自動起動

ログイン前から起動する LaunchDaemon を用意します。準備はリポジトリ root で、Realtime を動かす本人のユーザーとして行います。先に上の専用 Tailscale 登録と Realtime のビルドを済ませてください。

```sh
nix run .#runtime-host-funnel-deploy -- "$HOME/Library/Application Support/Unframe/Funnel" "$(id -un)"
```

新規ディレクトリへ実行ファイル、Caddy 設定、起動スクリプトと plist をまとめます。環境変数と Tailscale の登録情報は既存の `~/.config/unframe/` を参照します。実行時にリポジトリや Nix コマンドは使いません。固定した Nix store のツールは配備先の `nix-roots/` で GC から保護するため、配備先を移動・削除しないでください。

現在のフォアグラウンド入口を `Ctrl-C` で止め、続いて専用 `tailscaled` も停止してから登録します。

```sh
sudo /bin/bash "$HOME/Library/Application Support/Unframe/Funnel/install.sh"
sudo launchctl print system/me.un-fra.realtime-funnel
```

プロセスは準備時のユーザーとして動きます。起動順は専用 `tailscaled`、Caddy と Funnel、Runtime Host です。起動時にネットワークが未接続の場合や、子プロセスが終了した場合はサービスを再起動します。以前の公開設定が残っている場合、専用ノードの TCP 443 → `127.0.0.1:8443` と一致するものだけを解除して再開します。異なる Serve 設定があれば変更せず起動を拒否します。

ログは配備先の `logs/stdout.log` と `logs/stderr.log` です。自動ローテーションは行わないため、運用側で管理してください。Mac のスリープ中は接続を提供できません。停止中に割り当ての lease が失効した場合も、同じ Host / endpoint の直前の未終了 Session を新しい世代へ再割り当てし、保存済み checkpoint から一時停止状態へ復元します。checkpoint がまだ保存されていない復旧も初期状態を `paused/processRecovered` として保存してから ready とし、保存されていない進行は復元できません。発表の進行再開は Presenter が明示的に行います。終了・明示解放済みの Session や、別 Host へ割り当て済みの Session は自動復元しません。FileVault が有効な Mac の再起動では、ディスクのロック解除が必要です。

停止と再開は次で行います。

```sh
sudo launchctl bootout system/me.un-fra.realtime-funnel
sudo launchctl bootstrap system /Library/LaunchDaemons/me.un-fra.realtime-funnel.plist
```

自動起動を削除する場合は `bootout` 後に `/Library/LaunchDaemons/me.un-fra.realtime-funnel.plist` を削除します。`runtime-host-funnel-deploy` は既存配備先へ上書きしません。Funnel 配備物全体の更新は停止・登録削除後に新しいディレクトリへ準備して再登録し、復元が必要なら旧配備物の `install.sh` を使います。Runtime binary だけの更新は下記の Pull 型 CD を使用できます。登録後は公開 endpoint で gRPC / WSS を確認してください。プロセスの起動だけでは Session の割り当てと Runtime の ready を保証しません。

## 複数 Session と復旧の確認範囲

一つの Funnel URL と常駐 Host の共通 listener へ複数 Session を割り当てます。Session ごとの port や Funnel 設定は追加しません。`REALTIME_HOST_CAPACITY` を配備設定で明示します。満員・drain 中も担当 Session の lease 更新を継続します。新しい Host boot は旧 lease の失効を待ち、各 Session を新 epoch の paused Snapshot へ復旧してから接続を受け付けます。

公開経路で二つ以上の Session の native gRPC / WSS、途中参加、切断復帰、Host 再起動、保存障害時の進行と終了を確認します。Session ごとの保存ログと配信遅延を測定し、Funnel の帯域も含めて収容上限を決めます。これらの公開環境・実負荷の結果は未取得です。ローカルテストや起動成功を、その検証結果として扱いません。

## GitHub Actions からの Pull 型 CD

`main` の CI が成功し、Realtime 関連の変更がある場合、`realtime-release.yml` が同じ commit の
Darwin arm64 `runtime-host` をビルドして artifact を90日保存します。Control Plane、Caddy、Tailscale、
環境変数や updater 自体はこの artifact で更新しません。

既存の Funnel LaunchDaemon と GitHub CLI の認証を用意し、ログイン中のサービスユーザーで一度実行します。
GitHub の資格情報には対象 repository の Actions 読み取り権限が必要です。

```sh
nix run .#runtime-host-updater-setup -- \
  "$HOME/Library/Application Support/Unframe/RealtimeUpdater" \
  "$HOME/Library/Application Support/Unframe/Funnel" --install
```

これは updater と管理 CLI を配置し、既存の環境変数ファイルへ `REALTIME_HOST_UPDATE_DIRECTORY` を追加して、
10分間隔の LaunchAgent を登録します。更新対象は同じ repository の `push/main` の成功済み CI artifact のみです。
実行時に checkout や Nix は使いません。Node と GitHub CLI は Nix GC root で保護します。
LaunchAgent のため、ログアウト中は自動取得を行いません。Runtime 本体の LaunchDaemon は継続します。

旧 Host は更新状態ファイルを出力しないため、この機能が `main` に反映され、最初の artifact が作られたら、
一度だけ次の手動コマンドで移行してください。同じコマンドは以後も定期実行を待たずに使えます。

```sh
nix run .#runtime-host-update
```

checkout 外からは次を直接実行できます。

```sh
"$HOME/Library/Application Support/Unframe/RealtimeUpdater/update"
```

**手動更新は担当 Session があっても実行します。** 接続は切れ、復旧した発表は一時停止状態になります。
候補の確認だけを行うには `--check`、自動更新と同じ「担当 Session があれば延期」の動作には `--auto` を付けます。

自動更新は新規割り当ての停止を heartbeat で確認し、担当 Session が0件のときだけ進みます。
状態不明・古い状態・Control Plane 障害時は更新せず、受付停止の解除を試みます。解除にも失敗した場合は下記の手動解除を行います。
成果物の archive digest、manifest の commit・対象 OS / CPU・binary hash を照合し、旧 binary を
`Funnel/release/runtime-host.previous` へ退避して atomic に置換します。
再起動後は新 Host の heartbeat、ローカル／公開 gRPC health、Control／State WSS upgrade を確認します。
これは実機の参加・操作・同期の E2E を保証しません。

更新に失敗した場合は旧 binary を戻して再起動し、失敗を記録します。
activation に失敗した commit の自動再適用は抑止し、手動コマンドで再試行できます。
更新途中に強制終了した場合は、次回の実行で未完了記録を読み、更新可能であれば旧 binary の復旧を先に行います。
切り戻し時は状態ファイルを要求せず、配備先のプロセスと gRPC／WSS の疎通で旧 Host の復帰を確認します。

状態は `RealtimeUpdater/state/state.json`、定期実行の結果は `RealtimeUpdater/logs/stdout.log` と
`stderr.log` に残ります。ログの自動ローテーションは行いません。
受付停止が残った場合は、更新処理が動いていないことを確認して次で解除します。

```sh
"$HOME/Library/Application Support/Unframe/RealtimeUpdater/runtime-host-admin" \
  --deployment "$HOME/Library/Application Support/Unframe/Funnel" activity release
```

自動更新の停止は次で行います。再開は `bootout` を `bootstrap` に置き換えて実行します。

```sh
launchctl bootout "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/me.un-fra.realtime-updater.plist"
```
