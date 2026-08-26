# scripts/

タスクの実処理を置くディレクトリです。公式な実行入口は `flake.nix` の apps で、`flake.nix` はここにあるスクリプトをラップします。

| ディレクトリ | 役割 |
| --- | --- |
| `lib/` | 共有ヘルパ（パス定数 `paths.sh` など） |
| `ci/` | 品質ゲート |
| `dev/` | 依存関係・Git hook のセットアップ |
| `docs/` | Notion → `docs/notion/` 同期 |

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
