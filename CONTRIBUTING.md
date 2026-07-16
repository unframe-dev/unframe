# Contributing to Unframe

このプロジェクトに変更を加える前に、必ずこのドキュメントを読んでください。

---

## 開発スタイル: TDD (テスト駆動開発)

**Unframe ではすべての機能追加・バグ修正を TDD で進めます。** 例外は「実装が試行錯誤の調査フェーズに留まっている」「Unity (C#) 側で MR の見た目を試している」など、テストを書く前提が成立していない場合のみです。

### サイクル

```
[探索] → [Red] → [Green] → [Refactoring]
```

| Phase           | やること                                                              | やってはいけないこと                                  |
| --------------- | --------------------------------------------------------------------- | ----------------------------------------------------- |
| **探索**        | 既存コード・契約 (`packages/contracts/`) を読む。型と入出力を把握する | いきなり実装を書く                                    |
| **Red**         | 失敗するテストを 1 つ書く。期待する振る舞いを明確化する               | 1 つの PR で大量のテストを先出しする (反復が遅くなる) |
| **Green**       | テストが通る**最小限**の実装を書く                                    | テストの想定外の機能まで盛り込む                      |
| **Refactoring** | テストを緑のまま、設計と命名を整える                                  | 振る舞いを変える (それは別サイクル)                   |

### サイクルが回らないときの戒律

- **テストが書けない = 設計が悪い** のサイン。型 / 関数シグネチャを切り直す
- **モックを書いた瞬間に詰まる = 関心の分離ができていない**。状態とロジックを分離する
- **「全部書いてからテスト」は TDD ではない**。コミットを切る前に必ず Red → Green の足跡が残ること

### KPI / カバレッジ

KPI やカバレッジ目標がチケット側で指定された場合、**達成するまで試行する**こと。途中で諦めてマージしない。

---

## 各層でのテスト粒度

| 層                    | フレームワーク                          | 主に書くテスト                                       | 例                                                          |
| --------------------- | --------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| `app/server/`         | Go `testing` (modernc in-memory SQLite) | ルートのリクエスト→レスポンス契約、service/DB シナリオ | `/health` の応答が OpenAPI 契約と一致、presigner 単体      |
| `packages/contracts/` | tsx `--test`                            | 生成 OpenAPI の整合、クライアントラッパの境界         | 生成 schema がコンパイルでき、fetch ラッパが型で縛られる   |
| `app/web/` (React)    | Vitest + Testing Library                | コンポーネントの振る舞い、フォーム検証、状態遷移      | フォーム送信時に生成クライアントのエラーを正しく表示       |
| `lp/` (Svelte)        | tsx `--test` / svelte-check             | コンテンツレジストリ、ルーティング整合               | `content-registry` が想定の一覧を返す                      |
| `app/unity/` (Unity)  | Unity Test Framework                    | C# 側のロジック (`PlayMode`/`EditMode`)              | マニフェストパース、座標変換                                |

**契約は `app/server` の Huma 定義が唯一の編集点。** 契約を変えたら `nix run .#gen` で `openapi.yaml` と各クライアントを再生成し、影響先 (backend テスト / web / unity) を同時に更新する。生成物の drift は CI が検出する。

---

## 環境セットアップ

```bash
nix develop        # ツールチェイン (Go / Node / pnpm / sqlc / goose 等) が入った shell に入る
nix run .#setup    # pnpm 依存をインストール
nix run .#migrate  # Turso/libSQL に goose マイグレーションを適用
```

> ツールチェインは `flake.nix` が固定します (ADR-0004、旧 `mise` を置換)。DB は Turso/libSQL、アセットは Cloudflare R2 (ADR-0002 / ADR-0003)。

詳細は [`ARCHITECTURE.md`](./ARCHITECTURE.md) と [`app/backend/README.md`](./app/backend/README.md) を参照。

---

## 日々のコマンド

公式の実行入口は flake apps / flake checks (ADR-0004)。実処理は `scripts/` にある。

| 用途                                     | コマンド                |
| ---------------------------------------- | ----------------------- |
| 開発環境に入る                           | `nix develop`           |
| backend + lp 並走                        | `nix run .#dev`         |
| 契約・クライアント・sqlc 生成            | `nix run .#gen`         |
| **品質ゲート (drift + lint + test + build)** | `nix run .#check`   |
| 生成物の drift 検査のみ                  | `nix run .#drift`       |
| DB マイグレーション適用                  | `nix run .#migrate`     |
| Notion 同期                              | `nix run .#notion-sync` |
| CI 検証 (flake 自体の評価)               | `nix flake check`       |

---

## 品質ゲート

**`nix run .#check` (drift + lint + test + build) が緑であることをマージの最低条件**とします。

- ローカルで `nix run .#check` を流して通すこと
- pre-commit hook (`packages/config/` の共有 git hooks) がコミット時に format を自動で走らせます
- CI は `ci.yml` が変更領域を検出し、`server` / `web` / `lp` / `openapi` / `unity` の各 workflow を呼び分けます。必須チェックは集約 job `CI`
- format / lint の自動修正は `autofix.yml` が PR ブランチへ commit します（同一リポジトリの PR 限定）。手元では領域別に `nix run .#server -- fix` 等、または pre-commit hook で修正できます

**赤を放置して別の作業に進まない。** 赤いまま push しない。

---

## コミット規約

### Conventional Commits + 日本語 + gitmoji 自動付与

```
<type>(<scope>): <概要を日本語で>

<本文 (必要なら)>
```

- **言語: 原則として日本語**
- **gitmoji は手動で付けない** — `~/.git_template/hooks/prepare-commit-msg` が type から自動で挿入する
  - もし自動付与が効いていない場合は `core.hooksPath` を確認 (Vite+ の `.vite-hooks/_` が上書きしている可能性)

### scope

| scope       | 対象                                                                    |
| ----------- | ----------------------------------------------------------------------- |
| `web`       | `app/web/` 配下 (React 編集エディタ)                                    |
| `server`    | `app/server/` 配下 (Go backend)                                         |
| `unity`     | `app/unity/` 配下 (Unity MR)                                            |
| `lp`        | `lp/` 配下 (SvelteKit)                                                   |
| `contracts` | `packages/contracts/` / `packages/api-client-*` 配下                    |
| `config`    | `packages/config/` 配下 (共有 tsconfig / oxc / git hooks)               |
| `scripts`   | `scripts/` 配下 (dev / generate / ci / docs)                            |
| `docs`      | `docs/` 配下                                                            |
| `repo`      | リポジトリ全体 (`.gitignore` / `flake.nix` / `pnpm-workspace.yaml` 等) |

### type ↔ gitmoji 対応

| type       | gitmoji | 用途                            |
| ---------- | ------- | ------------------------------- |
| `feat`     | ✨      | 新機能                          |
| `fix`      | 🐛      | バグ修正                        |
| `docs`     | 📝      | ドキュメントのみ                |
| `style`    | 💄      | フォーマット (意味に影響しない) |
| `refactor` | ♻️      | 振る舞いを変えないコード変更    |
| `perf`     | ⚡️      | パフォーマンス改善              |
| `test`     | ✅      | テスト追加・修正                |
| `build`    | 👷      | ビルドシステム / 依存変更       |
| `ci`       | 🎡      | CI 設定                         |
| `chore`    | 🔧      | 雑務                            |
| `remove`   | 🔥      | コード・ファイル削除            |

### 分割方針

- **作業終了時点の差分をそのまま残し、機能単位でグルーピング**してコミットする
- `git checkout HEAD -- <file>` で巻き戻して再適用する手順は**取らない** (回帰リスク)
- 同一ファイル内に複数関心が混在したら `git add -p` でハンク分割

### 良い例

```
feat(server): GET /presentations を実装
fix(web): スライド追加時に store が更新されない
refactor(contracts): manifest スキーマを media/spatial に分離
docs(decisions): ADR-0004 でモノレポ構成と Nix 移行を記録
```

---

## ブランチ規約

```
<type>/<scope>-<short-desc>
```

例:

```
feat/web-fbx-upload
feat/server-presentations-crud
fix/unity-controller-input-deadzone
refactor/contracts-manifest-split
```

`main` 直 commit は基本しない (現時点では scaffold 期間中の例外あり)。
ブランチ寿命は短く (1〜3 日目安)。長引いたら main を rebase する。

---

## Pull Request

1. **タイトル**: コミットメッセージと同形式 (`<type>(<scope>): ...`)
2. **本文**:
   - 何をしたか・なぜか (背景)
   - スクリーンショット / 動作確認手順 (UI 変更時)
   - 関連 Issue / ADR
3. **チェック**:
   - [ ] `nix run .#check` が緑
   - [ ] TDD で書いた (Red → Green のコミットがある or 同一 PR にテストが含まれる)
   - [ ] 契約 (`app/server` の Huma 定義) を変えたなら `nix run .#gen` で再生成し、影響先 (server / web / unity) のテストも更新
4. **レビュー**: 1 名以上のレビューを受けてから merge

---

## 不明な点があれば

- **要件が曖昧 / 仕様が分からない**: 実装に進む前に必ず質問する。**勘で実装しない**
- **設計判断が必要**: ADR (`docs/decisions/`) を起こすか、PR の本文で根拠を明示する
- **ライブラリの選定を変えたい**: ADR で議論する (`docs/decisions/0000-template.md` を踏襲)

> **設計の簡潔さと正確さを優先する。最小限の変更に固執しない。** (CLAUDE.md より)
