# Tailscale Funnel での公開試験

既存のビルド済み `runtime-host` / `realtime-server` を、自宅 Mac から公開します。Quest / Audience に Tailscale は不要です。公開 URL はこの Mac の `https://<hostname>.<tailnet>.ts.net` です。

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

ログは配備先の `logs/stdout.log` と `logs/stderr.log` です。自動ローテーションは行わないため、運用側で管理してください。Mac のスリープ中は接続を提供できません。停止中に割り当ての lease が失効した場合も、同じ Host / endpoint の直前の未終了 Session を新しい世代へ再割り当てし、保存済み checkpoint から一時停止状態へ復元します。checkpoint がまだ保存されていない場合は初期状態で起動し、保存されていない進行は復元できません。発表の進行再開は Presenter が明示的に行います。終了・明示解放済みの Session や、別 Host へ割り当て済みの Session は自動復元しません。FileVault が有効な Mac の再起動では、ディスクのロック解除が必要です。

停止と再開は次で行います。

```sh
sudo launchctl bootout system/me.un-fra.realtime-funnel
sudo launchctl bootstrap system /Library/LaunchDaemons/me.un-fra.realtime-funnel.plist
```

自動起動を削除する場合は `bootout` 後に `/Library/LaunchDaemons/me.un-fra.realtime-funnel.plist` を削除します。配備物の上書き更新には対応していません。更新時は停止・登録削除後に新しいディレクトリへ準備して再登録し、復元が必要なら旧配備物の `install.sh` を使います。登録後は公開 endpoint で gRPC / WSS を確認してください。プロセスの起動だけでは Session の割り当てと Runtime の ready を保証しません。
