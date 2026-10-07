# scripts/

タスクの実処理を置くディレクトリです。公式な実行入口は `flake.nix` の apps で、`flake.nix` はここにあるスクリプトをラップします。

| ディレクトリ    | 役割                                      |
| --------------- | ----------------------------------------- |
| `lib/`          | 共有ヘルパ（パス定数 `paths.sh` など）    |
| `ci/`           | 品質ゲート                                |
| `contracts/`    | 契約生成と生成物の差分検査                |
| `dev/`          | 依存関係・Git hook のセットアップ         |
| `docs/`         | Notion → `docs/notion/` 同期              |
| `unity/`        | Unity Editor の起動と WebGL Preview build |
| `local-editor/` | ローカル実サービスと Unity の E2E         |

```bash
nix develop
nix run .#setup
nix run .#check
nix run .#control-plane
nix run .#presentation
nix run .#unity-proto -- check
nix run .#realtime
nix run .#web
nix run .#lp
nix run .#notion-sync
nix flake check
```

GitHub Actions では `nixbuild/nix-quick-install-action` で Nix を導入し、`magic-nix-cache-action` で Nix store をキャッシュします。

Bun は `packages/config/bun.nix` で 1.4.2 に固定しています。1.3.13 ではブラウザ終了後の追加パイプの二重 close により、成果物の出力が `EBADF` で失敗するためです。開発環境と CI は同じ Nix toolchain を使います。

`packages/contracts/` は Control Plane OpenAPI、Realtime Protocol Buffers、Presentation artifact schema の共有境界です。`nix run .#presentation` は実装済みの `packages/unframe-*` packageを検証した後、repository-local Fixed Browser で `examples/presentation` の check と実 build を2回行います。Definition、RenderBundle、PNG asset set の relative path と SHA-256 manifest が一致することまで確認します。source of truth と生成手順は、対応する component 実装と合わせて定義します。

Presentation v2 の Unity C# bindings は `packages/contracts/proto/` の正本から `protoc` で生成します。Unity 側に置く `.proto` コピーと生成 C# の drift は次で確認でき、正本更新後は引数を省略して生成・同期します。

```bash
nix run .#unity-proto -- check
nix run .#unity-proto
```

`nix run .#check` と Unity CI はこの drift check を含みます。

Fixed Browser の実機captureをローカルで試す前には、次を明示的に実行します。通常の package / repository check は browser binary を download / 起動せず、unit test だけを実行します。

```bash
nix develop --command scripts/dev/install-presentation-browser.sh
```

browser binary は repository の `.cache/playwright` にのみ配置し、`playwright-core install chromium --only-shell` で provision します。
Linuxでは `flake.nix` のNix devShellがmanaged headless shellの共有ライブラリと固定Noto CJK fontconfigを提供します。font provenanceはcaller文字列ではなく、この固定font setでcaptureしたglyph baseline bytesから導出します。
通常の renderer-web test は `*.integration.test.ts` を明示的に除外し、provision済み環境でだけ実 Browser capture の integration test を次で実行できます。binary がない場合は skip せず失敗します。`nix run .#presentation` の check mode も同じく provision を必須とし、fix mode と package 単体 check は Browser を起動しません。

```bash
nix develop --command scripts/dev/test-presentation-browser.sh
```

Opaque React capture は Linux の user namespace と、memory / pids controller を委譲できる systemd user manager を必要とします。Browser の provision 後、次で隔離・資源上限・React / Base UI の CLI build を実行します。capability が欠ける環境では skip せず失敗します。

```bash
nix develop --command scripts/ci/opaque-capture.sh
```

通常の CLI 実行を同じ profile に入れる場合は、`nix develop` 内で `PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" scripts/dev/opaque-capture-scope.sh <command> [arguments...]` を使います。この wrapper は一時的な delegated scope を作成し、終了時に worker を回収します。Opaque integration は通常の package unit test から分離しています。GitHub Actions の AppArmor 許可も、この専用 step で使用する executable path に限定します。

## Local Editor と Unity

```bash
nix run .#unity-editor -- -projectPath "$PWD/app/unity"
nix run .#unity-preview
nix run .#local-editor-e2e
nix run .#local-editor-e2e -- --showcase
```

`unity-editor` は Linux で `steam-run` を介して Editor を起動します。`UNITY_EDITOR` で実行ファイルを指定でき、未指定時は `app/unity/ProjectSettings/ProjectVersion.txt` の Unity Hub 配置を使います。対応する Unity version のインストール、license と WebGL module は利用者が用意します。

`unity-preview` は共有 Runtime の描画・Preview 部分から `.unframe/unity-preview/project` を生成し、WebGL player を `.unframe/unity-preview/UnframePreview` に出力します。生成 Assets は再構成し、Library／build cache は再利用します。build log は `.unframe/unity-preview/logs/build.log` です。

`local-editor-e2e` は生成済み WebGL player と固定 Browser の provision を必要とします。Chromium 実行ファイルは `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` で指定できます。現在の既定値は host の `/etc/profiles/per-user/t4ko/bin/google-chrome` です。Opaque capture の namespace／delegated cgroup 要件も満たしてください。

試験は `.unframe/unity-preview/e2e/<run>` に隔離した D1／R2、実行専用 CA・証明書、ログ・結果を作り、ローカル Control Plane、Realtime、承認用 Web と Host を起動します。実 WebGL Dist commit、device 承認、固定 Dist 公開と hash、権限・PublicationFence 拒否、HTTPS 素材と実 Snapshot／StateReady を用いる native Unity 描画を検査します。実行 directory は秘密情報を含むため共有・commit しないでください。

`--showcase` は `examples/local-editor-showcase` の5枚構成を使用し、実 Surface interaction → Cue → Step／状態更新と Timeline、カメラの周回・パン・ズームを native Unity で収録します。`ffmpeg` が必要で、`UNFRAME_FFMPEG_EXECUTABLE_PATH` で指定できます。run 内の `showcase.mp4` は1280×720・24fps・36秒、`native.json` は各入力の Cue・Step・状態・sequence と描画フレームの観測結果です。動画は実カメラの連番フレームから生成します。

各プロセスは終了時に停止しますが、結果 directory は診断用に残ります。失敗時はその run のログを確認してください。build や unit test の成功と、この E2E の成功は分けて記録します。2026-10-07 に成功し、証拠は `.unframe/unity-preview/e2e/20261007T160533-371594/result.json` と `native.png` に保存しました。Quest 実機と WebGL の本番 Realtime 接続はこの試験に含みません。
