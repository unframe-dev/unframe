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

Bun は `packages/config/bun.nix` で 1.4.2 に固定しています。1.3.13 ではブラウザ終了後の追加パイプの二重 close により、成果物の出力が `EBADF` で失敗するためです。開発環境と CI は同じ Nix toolchain を使います。対象 system は Linux x86_64 と macOS arm64 です。macOS の実機検証状態と隔離の保証差は [ADR-0026](../docs/decisions/0026-native-linux-macos-host-adapters.md) に従います。

`packages/contracts/` は Control Plane OpenAPI、Realtime Protocol Buffers、Presentation artifact schema の共有境界です。`nix run .#presentation` は実装済みの `packages/unframe-*` packageを検証した後、repository-local Fixed Browser で `examples/presentation` の check と実 build を2回行います。Definition、RenderBundle、PNG asset set の relative path と SHA-256 manifest が一致することまで確認します。source of truth と生成手順は、対応する component 実装と合わせて定義します。

Apple Silicon で C# consumer を生成・検査するには Rosetta 2 が必要です。固定した `Grpc.Tools 2.76.0` は macOS の x64 plugin のみを配布しています。未導入の場合は `softwareupdate --install-rosetta` でライセンスを確認してインストールしてください。platform 判定は `scripts/lib/grpc-tools.sh` で共有し、`bash scripts/contracts/test-grpc-tools.sh` で単独検証できます。

Presentation v2 の Unity C# bindings は `packages/contracts/proto/` の正本から `protoc` で生成します。Unity 側に置く `.proto` コピーと生成 C# の drift は次で確認でき、正本更新後は引数を省略して生成・同期します。

```bash
nix run .#unity-proto -- check
nix run .#unity-proto
```

`nix run .#check` と Unity CI はこの drift check を含みます。

Presentation 品質ゲートは一時ディレクトリを実パスへ正規化し、macOS の `/tmp` などの symlink を fixture の project root に持ち込まないようにします。

Fixed Browser の実機captureをローカルで試す前には、次を明示的に実行します。package 単体の unit test は Browser を起動しません。`nix run .#presentation` と、それを含む `nix run .#check` は provision 済み Browser を使います。

```bash
nix develop --command scripts/dev/install-presentation-browser.sh
```

browser binary は repository の `.cache/playwright` にのみ配置し、`playwright-core install chromium --only-shell` で provision します。
Nix devShell は両 OS に固定 Noto Sans CJK JP Regular の単独 OTF と runtime closure を提供します。OTF は上流の Sans2.004 配布物を SHA-256 で固定して取得し、SIL OFL ライセンスを同梱します。Linux では共有ライブラリと fontconfig も提供します。font probe は明示 font bytes で描画し、font / Browser / OS / runtime の識別を fingerprint に含めます。生成物の一致を保証する単位は同じ実行環境であり、異なる OS の PNG bytes を一致させる契約ではありません。
通常の renderer-web test は `*.integration.test.ts` を明示的に除外し、provision済み環境でだけ実 Browser capture の integration test を次で実行できます。binary がない場合は skip せず失敗します。`nix run .#presentation` の check mode も同じく provision を必須とし、fix mode と package 単体 check は Browser を起動しません。

```bash
nix develop --command scripts/dev/test-presentation-browser.sh
```

Opaque React capture は Linux では user namespace と memory / pids controller を委譲できる systemd user manager、macOS arm64 では利用可能な Seatbelt policy と process group 監視を必要とします。macOS の監視は Linux の hard subtree limit と異なります。Browser の provision 後、次で native 隔離・資源制限・React / Base UI の CLI build を実行します。capability が欠ける環境では skip せず失敗します。

```bash
nix develop --command scripts/ci/opaque-capture.sh
```

通常の CLI 実行を同じ profile に入れる場合は、`nix develop` 内で `PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" scripts/dev/opaque-capture-scope.sh <command> [arguments...]` を使います。Linux では delegated scope を作り、macOS では native adapter を直接使用します。Opaque integration は通常の package unit test から分離しています。GitHub Actions では Linux / macOS ともに通常の品質チェックと Opaque 受入テストを独立した job（各上限45分）で並列実行し、両方の成功を集約 CI で必須とします。GitHub Actions の AppArmor 許可は Linux の専用 step の executable path に限定します。

PostCSS / Tailwind を使う project の `unframe.lock` は native runtime と依存も固定します。OS を切り替えた場合は、移行先の同じ隔離 profile 内で `pnpm --filter @unframe/unframe-cli run presentation lock update <absolute-project-directory>` を実行します。`lock refresh` では runtime を切り替えません。

## Local Editor と Unity

Local Editor の開発は、Web の `dev:editor` と CLI の `dev` を別ターミナルで起動します。CLI の起動入口が OS 別の隔離経路と固定 Browser のパスを準備します。初回準備・起動順序・画面での確認手順は [Web README](../app/web/README.md#local-editor-の起動) を参照してください。

```bash
nix run .#unity-editor -- -projectPath "$PWD/app/unity"
nix run .#unity-preview
nix run .#local-editor-e2e
nix run .#local-editor-e2e -- --showcase
```

`unity-editor` は Linux で `steam-run` を介し、macOS では native Editor を直接起動します。`UNITY_EDITOR` で実行ファイルを指定でき、未指定時は `app/unity/ProjectSettings/ProjectVersion.txt` の OS 別 Unity Hub 配置を使います。対応する Unity version のインストール、license と WebGL module は利用者が用意します。

`unity-preview` は共有 Runtime の描画・Preview 部分から `.unframe/unity-preview/project` を生成し、WebGL player を `.unframe/unity-preview/UnframePreview` に出力します。生成 Assets は再構成し、Library／build cache は再利用します。build log は `.unframe/unity-preview/logs/build.log` です。

共通再生処理と Preview の EditMode テストは `nix develop --command bash scripts/unity/test-native-editor.sh playback` で実行します。結果は `.unframe/local-editor-e2e/logs/playback.xml`、ログは同 directory の `playback.log` に出力します。

`local-editor-e2e` は生成済み WebGL player と固定 Browser の provision を必要とします。Chromium 実行ファイルは既定で renderer の managed headless shell を使用し、`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` で明示指定できます。OS 別の Opaque capture の隔離要件も満たしてください。

試験は `.unframe/unity-preview/e2e/<run>` に隔離した D1／R2、実行専用 CA・証明書、ログ・結果を作り、ローカル Control Plane、Realtime、承認用 Web と Host を起動します。実 WebGL Dist commit、device 承認、固定 Dist 公開と hash、権限・PublicationFence 拒否、HTTPS 素材と実 Snapshot／StateReady を用いる native Unity 描画を検査します。実行 directory は秘密情報を含むため共有・commit しないでください。

`--showcase` は `examples/local-editor-showcase` の5枚構成を使用し、実 Surface interaction → Cue → Step／状態更新と Timeline、カメラの周回・パン・ズームを native Unity で収録します。`ffmpeg` が必要で、`UNFRAME_FFMPEG_EXECUTABLE_PATH` で指定できます。run 内の `showcase.mp4` は1280×720・24fps・36秒、`native.json` は各入力の Cue・Step・状態・sequence と描画フレームの観測結果です。動画は実カメラの連番フレームから生成します。

各プロセスは終了時に停止しますが、結果 directory は診断用に残ります。失敗時はその run のログを確認してください。build や unit test の成功と、この E2E の成功は分けて記録します。2026-10-07 に成功し、証拠は `.unframe/unity-preview/e2e/20261007T160533-371594/result.json` と `native.png` に保存しました。Quest 実機と WebGL の本番 Realtime 接続はこの試験に含みません。
