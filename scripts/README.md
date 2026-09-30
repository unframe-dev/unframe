# scripts/

タスクの実処理を置くディレクトリです。公式な実行入口は `flake.nix` の apps で、`flake.nix` はここにあるスクリプトをラップします。

| ディレクトリ | 役割                                   |
| ------------ | -------------------------------------- |
| `lib/`       | 共有ヘルパ（パス定数 `paths.sh` など） |
| `ci/`        | 品質ゲート                             |
| `dev/`       | 依存関係・Git hook のセットアップ      |
| `docs/`      | Notion → `docs/notion/` 同期           |

```bash
nix develop
nix run .#setup
nix run .#check
nix run .#control-plane
nix run .#presentation
nix run .#realtime
nix run .#web
nix run .#lp
nix run .#notion-sync
nix flake check
```

GitHub Actions では `nixbuild/nix-quick-install-action` で Nix を導入し、`magic-nix-cache-action` で Nix store をキャッシュします。

Bun は `packages/config/bun.nix` で 1.4.2 に固定しています。1.3.13 ではブラウザ終了後の追加パイプの二重 close により、成果物の出力が `EBADF` で失敗するためです。開発環境と CI は同じ Nix toolchain を使います。

`packages/contracts/` は Control Plane OpenAPI、Realtime Protocol Buffers、Presentation artifact schema の共有境界です。`nix run .#presentation` は実装済みの `packages/unframe-*` packageを検証した後、repository-local Fixed Browser で `examples/presentation` の check と実 build を2回行います。Definition、RenderBundle、PNG asset set の relative path と SHA-256 manifest が一致することまで確認します。source of truth と生成手順は、対応する component 実装と合わせて定義します。

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
