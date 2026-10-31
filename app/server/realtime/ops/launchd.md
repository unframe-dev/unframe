# macOS の Runtime Host 配備

自宅の Mac で `runtime-host` を LaunchDaemon として動かす手順です。
ログイン前から起動し、Runtime Host が割り当てられた 複数 Session の実行状態を同一プロセス内で管理します。
Caddy、DNS、公開回線の設定は infra 側で管理します。

## 配備物を作成する

repository root で実行します。出力先は存在しない絶対パスを指定します。
実行ユーザーは Mac に存在する非 root ユーザーです。

```sh
nix run .#runtime-host-deploy -- "$PWD/.unframe/realtime-release" t4ko
```

`runtime-host`、`start.sh`、環境変数例、plist を生成します。
このコマンドはサービスを登録・起動しません。起動時の Go、Nix、checkout は不要です。
再度 build する場合は別の出力先を指定します。

## 環境変数と公開経路を準備する

```sh
mkdir -p "$HOME/.config/unframe"
cp -n .unframe/realtime-release/runtime-host.env.example "$HOME/.config/unframe/runtime-host.env"
chmod 600 "$HOME/.config/unframe/runtime-host.env"
```

先に [公開前の準備](../README.md#公開前の準備) に従い、Control Plane の Runtime Host API、
D1 migration、Audience origin の設定を確認します。
このファイルを編集し、`REALTIME_SERVICE_IDENTITY` を Control Plane の
`SERVICE_IDENTITY_SECRET` と同じ32文字以上の値にします。
`REALTIME_BROWSER_ORIGINS` は `https://app.un-fra.me` を使用し、別環境ではその Audience の HTTPS origin に置き換えます。
秘密値の shell quoting と他の設定は [Realtime README](../README.md#起動) を参照してください。
このファイルは実行ユーザーの権限で shell として読み込まれます。

`REALTIME_RUNTIME_ENDPOINT` のホスト名が自宅の到達可能な公開 IP へ名前解決されるよう、DNS とルーターの TCP 443 転送を準備します。
Caddy の設定は [設定例](Caddyfile.example) に従い、
TCP 443、証明書の取得・更新、証明書保存先の永続化を準備します。
Runtime は `127.0.0.1:9090` に bind し、外部公開は Caddy を経由させます。
Mac のスリープ中は接続できないため、ホストの電源設定も確認してください。

## インストールと起動

以下は `t4ko` 向けに生成した配備物を、この Mac に配置する例です。
`sudo` を操作するログインユーザーも `t4ko` を想定しています。
環境変数ファイルを準備してから実行します。

```sh
(
set -eu
release="$PWD/.unframe/realtime-release"
destination='/Library/Application Support/Unframe/Realtime'
sudo install -d -o root -g wheel -m 755 "$destination"
sudo install -o root -g wheel -m 755 "$release/runtime-host" "$release/start.sh" "$destination/"
sudo install -o t4ko -g "$(id -gn t4ko)" -m 600 "$HOME/.config/unframe/runtime-host.env" "$destination/runtime-host.env"
sudo install -d -o t4ko -g "$(id -gn t4ko)" -m 700 /Library/Logs/UnframeRealtime
sudo install -o root -g wheel -m 644 "$release/me.un-fra.realtime.plist" /Library/LaunchDaemons/me.un-fra.realtime.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/me.un-fra.realtime.plist
sudo launchctl print system/me.un-fra.realtime
)
```

`KeepAlive` で終了後に再起動します。短時間で終了を繰り返す場合は、`ThrottleInterval` で起動頻度を10秒間隔に制限します。
停止時は SIGTERM を受け、受付解除・保存・Session 停止を全体最大10秒で行います。
launchd の `ExitTimeOut` は30秒です。
ログは `/Library/Logs/UnframeRealtime/stdout.log` と `stderr.log` に出力します。
ファイルは自動ローテーションしないため、ホスト側で保管・ローテーションを管理してください。

Host は割り当て待ちでも `9090` の共通 listener を保持します。未準備 Session への接続は拒否します。
Control Plane の Session 準備が `ready` になった後、外部回線の Quest／Audience で
接続・進行・再接続を確認します。[接続確認](../README.md#接続確認と停止) を参照してください。
ローカル health の成功だけでは、Caddy と公開経路の疎通は確認できません。

## 更新・停止・削除

更新は発表を止めて行います。既存の配備物は退避し、新しい配備物を別ディレクトリに build します。
次の例では、新しい出力先を `release` に指定して置き換えます。
環境変数ファイルは保持します。設定も変更する場合は、起動前に同じ配置先のファイルを更新してください。

```sh
(
set -eu
release="$PWD/.unframe/realtime-release-next"
nix run .#runtime-host-deploy -- "$release" t4ko
destination='/Library/Application Support/Unframe/Realtime'
sudo launchctl bootout system/me.un-fra.realtime
sudo install -o root -g wheel -m 755 "$release/runtime-host" "$release/start.sh" "$destination/"
sudo install -o root -g wheel -m 644 "$release/me.un-fra.realtime.plist" /Library/LaunchDaemons/me.un-fra.realtime.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/me.un-fra.realtime.plist
)
```

停止だけを行う場合は `sudo launchctl bootout system/me.un-fra.realtime` を実行します。
`bootout` は自動再起動も解除し、再度 `bootstrap` するまで停止したままです。
Host を同じ Runtime ID と endpoint で起動し直すと、旧 lease の失効を待ち、新 epoch で未終了 Session を復旧します。
checkpoint からの Runtime 復旧は pause 状態で、再開操作が必要です。
更新に失敗した場合は停止後に退避したバイナリと plist を戻して bootstrap します。

常駐設定を削除する場合は `bootout` 後に次を実行します。
環境変数とログの削除は必要な記録を保管してから別途行います。

```sh
sudo rm /Library/LaunchDaemons/me.un-fra.realtime.plist
```

## 配備スクリプトの検証

macOS 上で repository root から実行します。

```sh
nix develop --command node --test scripts/runtime-host/deploy.test.mjs
```

サービス登録は行わず、配備物生成、plist の検証、失敗時の後始末を検証します。
