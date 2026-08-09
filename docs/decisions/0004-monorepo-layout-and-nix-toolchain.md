# ADR-0004: モノレポのレイアウトを確定し、ツールチェインを Nix flake へ移行する

- **Status**: Accepted
- **Date**: 2026-07-16
- **Deciders**: Unframe 開発チーム
- **関連**: [ADR-0003（アーカイブ）](./archived/0003-full-renewal.md)（構成刷新の親決定）, [`ARCHITECTURE.md`](../../ARCHITECTURE.md)

## Context

[ADR-0003（アーカイブ）](./archived/0003-full-renewal.md) で Go backend と分離フロントエンドへの全面刷新を決めたが、具体的なディレクトリ命名（`apps/backend` / `apps/app` / `apps/site` / `apps/mr`）と、各言語クライアントの成果物配置、共有 config の置き場は確定していなかった。実装が進むにつれ、次の点を明確にする必要が生じた。

- 動的編集エディタ（React）と MR クライアント（Unity）、LP（Svelte）の置き場と命名。
- OpenAPI から生成する TypeScript / C# クライアントを、契約成果物（`openapi.yaml` と生成設定）とどう分離するか。
- `tsconfig` / oxc / git hooks など複数レイヤーで共有する config の集約先。
- ツールチェイン管理（現行は `mise`）とタスク実行（現行は `justfile`）を、ローカルと CI で再現性高く一元化する方法。

`mise` はツールのバージョン固定に留まり、`justfile` は各レシピが必要なランタイム・実行位置・環境変数を利用者に意識させる。ローカルと CI の乖離、実行方法のばらつきを構造的に減らしたい。

## Decision

モノレポのレイアウトを下記に確定し、ツールチェインとタスク実行を **Nix flake** に一元化する。`app/unity` は ADR-0003 同様に刷新対象外だが、命名（`apps/mr` → `app/unity`）のみ本 ADR に揃える。

### ディレクトリレイアウト

- `app/web` … React 19 SPA。3D プレゼンテーションの動的編集エディタ。
- `app/server` … Go backend（Huma v2 + Chi + sqlc）。API 契約の唯一の編集点。
- `app/unity` … Unity MR アプリケーション（C#）。
- `lp/` … SvelteKit SSG のランディングページ。
- `packages/contracts` … `openapi.yaml`（契約成果物）と `codegen/`（生成設定）。
- `packages/config` … `tsconfig` / oxc config / git hooks 等の共有 config。
- `packages/api-client-ts` … OpenAPI から生成した TypeScript クライアント成果物。
- `packages/api-client-csharp` … OpenAPI から生成した C# クライアント成果物。
- `scripts/` … dev / generate / ci / docs(notion sync) の実処理を配置する。

### ツールチェインとタスク実行

- ツールチェインは `flake.nix` / `flake.lock` で固定し、`mise.toml` を廃止する。
- タスクの公式な実行入口は **flake apps**（`nix run .#gen` / `.#check` / `.#dev` / `.#migrate` / `.#notion-sync`）と **flake checks**（`nix flake check`）とする。`justfile` は廃止する。
- 複雑な処理の実装は `scripts/` に配置し、`flake.nix` からラップして実行する。`flake.nix` は依存関係・実行環境・公開コマンド名・スクリプト接続に留め、ロジックは持たせない。
- CI もローカルとの差を減らすため `nix run .#…` を入口にする。
- GitHub Actions は `ci.yml`（オーケストレーション）が変更領域を検出し、`server.yml` / `web.yml` / `lp.yml` / `openapi.yml` / `unity.yml`（いずれも `workflow_call` の再利用可能ワークフロー）を呼び分ける。必須チェックは集約 job。依存更新は Hosted Renovate（`.github/renovate.json`）に委ねる。

## Alternatives Considered

### Option A: `mise` + `justfile` を継続する

却下した。`mise` はツール固定に限られ、`justfile` の各レシピは実行環境・環境変数・実行位置を利用者に委ねる。ローカルと CI の乖離が残り、新規参加者が「何を入れて、どこから実行するか」を毎回意識する。Nix flake なら依存ごと固定でき、CI と同一入口を共有できる。

### Option B: 処理ロジックも `flake.nix` に `writeShellApplication` で直書きする

却下した。生成・CI・同期の実処理を flake に埋めると数十〜数百行の shell が flake に集中し、可読性と差分レビュー性が落ちる。`flake.nix` は「公開名と接続」に留め、ロジックは `scripts/` に置いて役割を分離する。

### Option C: TypeScript クライアントを `packages/contracts` に同居させ続ける

却下した。`openapi.yaml`（契約の源泉）と、そこから決定的に生成される各言語クライアント（再生成可能な成果物）を同一パッケージに混ぜると、源泉と成果物の境界が曖昧になる。`packages/contracts` を契約 + 生成設定に限定し、`api-client-ts` / `api-client-csharp` を成果物パッケージとして分離する。

## Consequences

- **Positive**: レイアウトと命名が一意に定まり、`ARCHITECTURE.md` を一次資料として参照できる。
- **Positive**: `nix develop` / `nix run .#…` / `nix flake check` でローカルと CI の入口が一致し、実行方法のばらつきが消える。
- **Positive**: 契約の源泉（`packages/contracts`）と成果物（`api-client-*`）の境界が明確になり、再生成方針を保てる。
- **Negative**: 既存ディレクトリのリネーム（`app/backend` → `app/server` など）とパッケージ分割の物理移行コストが発生する。移行完了までは `scripts/` のパス定数が現行ディレクトリを指す。
- **Negative**: Nix の学習コストと、`flake.lock` / `nix flake check` の維持コストが増える。
- **Neutral**: `app/unity` とその Unity CI は命名変更のみで、刷新対象外である。
- **Neutral**: ADR-0003 の「レイアウト命名」に関する記述（`apps/backend` / `apps/app` / `apps/site` / `apps/mr`）は本 ADR で置換される。ADR-0003 の技術選定（Go / Huma / Turso / R2 / OpenAPI 生成）は有効なまま。

## Follow-ups

- [x] `app/backend` → `app/server` のリネームと、参照（README / scripts）の追従。
- [x] `packages/contracts` から TS クライアントを切り出し、`packages/api-client-ts` / `packages/api-client-csharp` を新設。
- [x] `packages/config` を新設し、共有 tsconfig / Vite+ staged hook を集約。
- [x] `tools/notion-sync` を `scripts/docs/notion-sync` へ移設（完了）。
- [ ] `flake.lock` を生成し、`nix flake check` をローカルと CI で検証。
- [x] `app/web`（React 編集エディタ）のワークスペースを新設。
