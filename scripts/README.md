# scripts/

タスクの実処理を置くディレクトリ。公式な実行入口は `flake.nix` の **apps** と **checks**（[ADR-0004](../docs/decisions/0004-monorepo-layout-and-nix-toolchain.md)）。`flake.nix` はここのスクリプトをラップするだけで、ロジックは持たない。

| ディレクトリ  | 役割                                              |
| ------------- | ------------------------------------------------- |
| `lib/`        | 共有ヘルパ（パス定数 `paths.sh` など）            |
| `generate/`   | OpenAPI・各言語クライアント・sqlc 生成            |
| `ci/`         | CI 補助（生成 drift 検査 `drift.sh`、集約 `check.sh`）|
| `dev/`        | ローカル開発（`setup.sh` / `dev.sh` / `migrate.sh`）|
| `docs/`       | Notion → `docs/notion/` 同期                       |

## 実行入口

```bash
nix develop            # 開発環境に入る
nix run .#gen          # 契約・クライアント・sqlc 生成
nix run .#check        # 品質ゲート集約
nix run .#dev          # backend + lp 並走
nix run .#migrate      # DB マイグレーション
nix run .#notion-sync  # Notion 同期
nix flake check        # CI 検証
```

## パスについて

`lib/paths.sh` が目標構成（ADR-0004）と現行ディレクトリの対応を保持する。物理移行（`app/backend` → `app/server` 等）が完了したら右辺を更新する。スクリプト本体はパス定数のみに依存し、移行後も変更不要。
