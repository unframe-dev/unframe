# Unframe アーキテクチャ

このドキュメントは Unframe モノレポの**現行の目標構成**を示す一次資料です。個別の意思決定の背景は [`docs/decisions/`](./docs/decisions/) の ADR を、開発フローは [`CONTRIBUTING.md`](./CONTRIBUTING.md) を参照してください。構成の刷新経緯は [ADR-0003](./docs/decisions/0003-full-renewal.md)、レイアウト命名と Nix ツールチェインへの移行は [ADR-0004](./docs/decisions/0004-monorepo-layout-and-nix-toolchain.md) が正です。

## 全体像

Unframe は「MR プレゼンテーションを Web で編集し、Unity クライアントで表示する」プロダクトです。API 契約を Go backend の型定義から一意に生成し、各言語クライアントと Web/Unity/LP がそれを消費します。

```text
                       ┌──────────────────────────────┐
                       │  app/server (Go / Huma+Chi)  │  ← API 契約の唯一の編集点
                       └───────────────┬──────────────┘
                                       │ generate
                                       ▼
                     packages/contracts/openapi.yaml   ← コミット済み契約成果物
                                       │
                        ┌──────────────┴───────────────┐
                        ▼                              ▼
        packages/api-client-ts (TS)     packages/api-client-csharp (C#)
                        │                              │
        ┌───────────────┼──────────────┐              ▼
        ▼               ▼              ▼        app/unity (MR クライアント)
   app/web (React)   lp (Svelte)   その他 TS 利用側
```

## ディレクトリ構成

```text
unframe/
├── flake.nix / flake.lock        # ツールチェイン・タスク入口 (mise/just を置換)
├── ARCHITECTURE.md               # このドキュメント
├── app/
│   ├── web/                      # React 19 SPA。3D プレゼンテーションの動的編集エディタ
│   ├── server/                   # Go backend。API 契約・DB・ストレージ境界の実装
│   └── unity/                    # Unity MR アプリケーション (C#)
├── lp/                           # SvelteKit SSG。ランディングページ / ドキュメントサイト
├── packages/
│   ├── contracts/                # openapi.yaml (契約成果物) と codegen/ (生成設定)
│   ├── config/                   # tsconfig / oxc / git hooks 等の共有 config
│   ├── api-client-ts/            # OpenAPI から生成した TypeScript クライアント成果物
│   └── api-client-csharp/        # OpenAPI から生成した C# クライアント成果物
├── scripts/                      # dev / generate / ci / docs(notion sync) の実処理
│   ├── generate/                 # OpenAPI・クライアント・sqlc 生成
│   ├── ci/                       # CI 補助 (drift 検査・チェック集約)
│   ├── docs/                     # Notion → docs/ 同期
│   └── dev/                      # ローカル開発セットアップ・並走起動
└── docs/
    ├── decisions/                # ADR
    ├── api/                      # API ドキュメント
    ├── notion/                   # Notion 同期成果物 (自動生成)
    └── plans/                    # 実装計画の記録
```

## 各コンポーネントの責務

### `app/server` — Go backend

- **技術**: Go 1.25、Huma v2、Chi、sqlc。DB は Turso/libSQL（テストは `modernc.org/sqlite` の in-memory）、マイグレーションは goose。
- **ストレージ**: Cloudflare R2。S3 互換の署名 URL を backend から発行する。
- **責務**: API 契約の唯一の編集点。Huma の操作定義から OpenAPI を決定的に生成する。`service` / `db` / `storage` の境界を明確に分離し、in-memory SQLite と fake storage で統合テスト可能に保つ。
- **エラー包絡**: `{ error: { code, message, details? } }` を全エンドポイントで統一する。

> 詳細は [`app/server/README.md`](./app/server/README.md)（現行は `app/backend/README.md`）を参照。

### `app/web` — React 編集エディタ

- **技術**: React 19 SPA。3D プレゼンテーションの動的編集を担う。状態量が多く、ビルド・ルーティング・テスト戦略を LP と分離する。
- **契約消費**: `packages/api-client-ts` の生成クライアント経由で backend と通信する。API 型を手書きしない。

### `app/unity` — MR クライアント

- **技術**: Unity / C#。MR デバイス上でプレゼンテーション manifest を描画する。
- **契約消費**: `packages/api-client-csharp` の生成クライアント経由で manifest API を消費する。
- **CI**: ライセンス制約により GitHub-hosted runner では静的チェック（`dotnet format`、PSScriptAnalyzer、`.meta` 整合性）のみ。Editor 起動テストはローカル/self-hosted。

### `lp` — ランディングページ

- **技術**: SvelteKit + `adapter-static` による SSG。静的配信中心のマーケティング / ドキュメントサイト。
- 編集エディタ（`app/web`）とはデプロイ単位・依存関係を分離する。

## 契約生成パイプライン

API 契約は次の一方向フローで生成され、各段の成果物はコミットされる。CI が全段の drift を検出する。

1. **編集点**: `app/server` の Huma 操作定義（Go の型 + バリデーション）。
2. **OpenAPI 生成**: `app/server` から `packages/contracts/openapi.yaml` を生成（`nix run .#gen`）。YAML は手編集しない。
3. **クライアント生成**: `packages/contracts/codegen/` の設定に基づき、`openapi.yaml` から
   - `packages/api-client-ts`（TypeScript、`openapi-typescript` + `openapi-fetch` の薄いラッパ）
   - `packages/api-client-csharp`（C#）
   を生成する。
4. **DB コード生成**: `app/server` の sqlc が SQL から Go の型付きクエリを生成する。
5. **drift 検査**: CI で再生成し、`openapi.yaml` / 各クライアント / sqlc 生成物に差分が無いことを保証する。

## ツールチェインとタスク実行

ツールチェインは **Nix flake** で固定し（旧 `mise` を置換）、タスクの公式な実行入口は **flake apps** と **flake checks** とする。複雑な処理の実装は `scripts/` に配置し、`flake.nix` からラップして実行する（`justfile` を置換）。

| 用途                       | コマンド                        |
| -------------------------- | ------------------------------- |
| 開発環境に入る             | `nix develop`                   |
| OpenAPI / クライアント生成 | `nix run .#gen`                 |
| 品質ゲート（集約）         | `nix run .#check`               |
| 開発サーバ並走             | `nix run .#dev`                 |
| DB マイグレーション        | `nix run .#migrate`             |
| Notion 同期                | `nix run .#notion-sync`         |
| CI 検証                    | `nix flake check`               |

- **flake apps** … 手動で叩く操作（生成・同期・セットアップ・migration・dev 統合起動）と、CI が領域別に呼ぶチェック（`check-server` / `check-web` / `check-lp` / `check-contracts` / `drift`）。
- **`scripts/`** … apps から呼ばれる実処理。単純なファイル操作や複数コマンドから再利用する処理を置く。

`flake.nix` は「依存関係・実行環境・公開コマンド名・スクリプトとの接続」に留め、ロジックは `scripts/` に置く。ローカルと CI の差を減らすため、CI も `nix run .#…` を入口にする。

### GitHub Actions

CI はオーケストレーション用の `ci.yml` が変更領域を検出し（`dorny/paths-filter`）、変更のあった領域の再利用可能ワークフローだけを呼び分ける。必須ステータスチェックは全結果を集約する job `CI`。

| workflow             | 対象 / 実体                                                    |
| -------------------- | ------------------------------------------------------------- |
| `ci.yml`             | オーケストレーション（変更検出・呼び分け・集約ゲート）        |
| `server.yml`         | `app/server` … `nix run .#check-server`                       |
| `web.yml`            | `app/web` … `nix run .#check-web`（未実装時はスキップ）        |
| `lp.yml`             | `lp` … `nix run .#check-lp`                                    |
| `openapi.yml`        | 契約 drift + TS クライアント … `nix run .#drift` / `.#check-contracts` |
| `unity.yml`          | `app/unity` の静的チェック（dotnet format / PSScriptAnalyzer / .meta） |
| `.github/renovate.json` | 依存更新（Hosted Renovate App。npm/pnpm・gomod・nuget・github-actions・nix flake） |

`server.yml` / `web.yml` / `lp.yml` / `openapi.yml` / `unity.yml` は `on: workflow_call`（+ `workflow_dispatch`）の再利用可能ワークフローで、単独では起動せず `ci.yml` から呼ばれる。運用系の `sync-notion.yml`（Notion 同期の cron）は CI オーケストレーションとは独立。

## 移行状況（follow-up）

本ドキュメントは目標構成を示す。次の物理移行は ADR-0004 の follow-up として順次実施する。

- [ ] `app/backend` → `app/server` へのリネーム。
- [ ] `packages/contracts` から TS クライアントを切り出し、`packages/api-client-ts` / `packages/api-client-csharp` を新設。
- [ ] `packages/config` の新設（共有 tsconfig / oxc / git hooks の集約）。
- [ ] `tools/notion-sync` → `scripts/docs/` への集約。
- [ ] `app/web`（React 編集エディタ）の新規実装。
- [ ] `flake.lock` の生成と `nix flake check` のローカル検証。

移行が完了するまでは、`scripts/` 内のパス定数が現行ディレクトリ（`app/backend` など）を指す。
