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

| 層                    | フレームワーク                               | 主に書くテスト                                         | 例                                                                    |
| --------------------- | -------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| `packages/contracts/` | Vitest (`vp test`)                           | Zod スキーマの境界値、Drizzle 派生型の整合             | `HealthResponseSchema.safeParse(...)` が想定通り通る/落ちる           |
| `apps/backend/`       | Vitest + Hono `app.request()`                | ルートのリクエスト→レスポンス契約、DB 経由のシナリオ   | `app.request('/health')` が `HealthResponseSchema` で parse できる    |
| `apps/web/`           | Vitest + Testing Library + Vue/React Testing | コンポーネントの振る舞い、フォーム検証、ストア状態遷移 | フォーム送信時に `@unframe/contracts/api` の Zod がエラーを正しく表示 |
| `apps/mr/` (Unity)    | Unity Test Framework                         | C# 側のロジック (`PlayMode`/`EditMode`)                | マニフェストパース、座標変換                                          |

**契約 (`packages/contracts/`) のスキーマを変えたら、必ず最初にテストを書き換える。** スキーマは backend / web 双方を同時に縛るため、テストファーストで影響範囲を見える化することが死活的に重要です。

---

## 環境セットアップ

```bash
just bootstrap   # mise install + vp env off + vp install
just db-migrate  # Supabase Postgres に apps/backend/drizzle/ のマイグレーションを適用
```

> DB 本体は Supabase Postgres を使用するため、ローカルで Postgres を立てる必要はありません (ADR-0002)。

詳細は [`README.md`](./README.md) を参照。

---

## 日々のコマンド

| 用途                                     | コマンド                    |
| ---------------------------------------- | --------------------------- |
| Backend dev (HMR)                        | `just dev-backend`          |
| Web dev (HMR)                            | `just dev-web`              |
| Web + Backend 並走                       | `just dev`                  |
| **品質ゲート (typecheck + lint + test)** | `just check` (= `vp check`) |
| テストのみ                               | `just test` (= `vp test`)   |
| Lint のみ                                | `just lint`                 |
| Format                                   | `just fmt`                  |
| DB マイグレーション生成                  | `just db-generate`          |
| DB マイグレーション適用                  | `just db-migrate`           |
| Drizzle Studio                           | `just db-studio`            |
| ライブラリビルド (`packages/contracts/`) | `just pack`                 |

---

## 品質ゲート

**`vp check` (typecheck + lint + test) が緑であることをマージの最低条件**とします。

- ローカルで `just check` を流して通すこと
- pre-commit hook (`vite.config.ts` の `staged: { "*": "vp check --fix" }`) がコミット時に自動で走ります
- CI では PR ごとに `vp check` を実行する想定 (workflow は今後追加)

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

| scope       | 対象                                                                  |
| ----------- | --------------------------------------------------------------------- |
| `web`       | `apps/web/` 配下                                                      |
| `backend`   | `apps/backend/` 配下                                                  |
| `contracts` | `packages/contracts/` 配下                                            |
| `mr`        | `apps/mr/` 配下 (Unity)                                               |
| `docs`      | `docs/` 配下                                                          |
| `tools`     | `tools/` 配下 (notion-sync 等)                                        |
| `repo`      | リポジトリ全体 (`.gitignore` / `justfile` / `pnpm-workspace.yaml` 等) |

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
feat(backend): GET /presentations を実装
fix(web): スライド追加時に store が更新されない
refactor(contracts): manifest スキーマを media/spatial に分離
docs(decisions): ADR-0002 で Backend スタックを記録
```

---

## ブランチ規約

```
<type>/<scope>-<short-desc>
```

例:

```
feat/web-fbx-upload
feat/backend-presentations-crud
fix/mr-controller-input-deadzone
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
   - [ ] `just check` が緑
   - [ ] TDD で書いた (Red → Green のコミットがある or 同一 PR にテストが含まれる)
   - [ ] `packages/contracts/` のスキーマを変えたなら、影響先 (backend / web) のテストも更新
4. **レビュー**: 1 名以上のレビューを受けてから merge

---

## 不明な点があれば

- **要件が曖昧 / 仕様が分からない**: 実装に進む前に必ず質問する。**勘で実装しない**
- **設計判断が必要**: ADR (`docs/decisions/`) を起こすか、PR の本文で根拠を明示する
- **ライブラリの選定を変えたい**: ADR で議論する (`docs/decisions/0000-template.md` を踏襲)

> **設計の簡潔さと正確さを優先する。最小限の変更に固執しない。** (CLAUDE.md より)
