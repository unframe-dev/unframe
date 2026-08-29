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
nix run .#notion-sync
nix flake check
```

`packages/contracts/` は Control Plane OpenAPI、Realtime Protocol Buffers、Presentation artifact schema の共有境界です。`nix run .#presentation` は実装済みの `packages/presentation-*` packageをまとめて検証します。source of truth と生成手順は、対応する component 実装と合わせて定義します。

Fixed Browser の実機captureをローカルで試す前には、次を明示的に実行します。通常の package / repository check は browser binary を download / 起動せず、unit test だけを実行します。

```bash
nix develop --command scripts/dev/install-presentation-browser.sh
```

browser binary は repository の `.cache/playwright` にのみ配置し、`playwright-core install chromium --only-shell` で provision します。
Linuxでは `flake.nix` のNix devShellがmanaged headless shellの共有ライブラリと固定Noto CJK fontconfigを提供します。font provenanceはcaller文字列ではなく、この固定font setでcaptureしたglyph baseline bytesから導出します。
通常の renderer-web test は `*.integration.test.ts` を明示的に除外し、provision済み環境でだけ実 Browser capture の integration test を次で実行できます。binary がない場合は skip せず失敗します。

```bash
nix develop --command scripts/dev/test-presentation-browser.sh
```
