# Contributing to Unframe

このドキュメントは、Unframe の開発、検証、コミット、Pull Request に関する
現行のルールを定義します。プロダクトの概要は [README.md](./README.md) を、
目標アーキテクチャは [ARCHITECTURE.md](./ARCHITECTURE.md) を参照してください。

## 開発の前提

Unframe は次のコンポーネントからなるモノレポです。

| パス                          | 役割                                     |
| ----------------------------- | ---------------------------------------- |
| `app/web/`                    | React 19 Web Editor（WIP）               |
| `app/server/`                 | Go / Huma / Chi Backend API（WIP）       |
| `app/unity/`                  | Unity MR Application（WIP）              |
| `lp/`                         | SvelteKit Landing Page（WIP）            |
| `packages/contracts/`         | 生成済み OpenAPI 契約と生成設定          |
| `packages/api-client-ts/`     | 生成 TypeScript client                   |
| `packages/api-client-csharp/` | C# client の成果物置き場（現在は未接続） |
| `packages/config/`            | 共有 TypeScript、Vite+、Git hook 設定    |
| `scripts/`                    | 開発、生成、CI、ドキュメント同期の実処理 |

現在の Backend は API、プレゼンテーションとアセットの永続化、manifest の
組み立て、Cloudflare R2 の署名 URL 発行を担当します。認証・認可、リアルタイム
同期、変換パイプライン、バックグラウンドジョブは未実装です。

## 開発スタイル: TDD

機能追加とバグ修正は、原則として次のサイクルで進めます。

```text
探索 -> Red -> Green -> Refactoring
```

1. 既存コード、契約、テストを読み、変更範囲と期待する振る舞いを把握する。
2. 期待する振る舞いを表す失敗テストを書く。
3. テストを通す最小限の実装を書く。
4. テストを緑に保ったまま、設計と命名を整理する。

テストを書く前提が成立しない探索的作業や、Unity 側の見た目・デバイス検証は
例外とします。例外にした場合は、完了報告に理由と代替検証を記載してください。

チケットで KPI やカバレッジ目標が指定されている場合は、達成するまで試行します。

## リポジトリの責務境界

アプリケーション固有のコードは、それを所有するディレクトリに置きます。

- React 固有のコードは `app/web/` に置く。
- Go Backend のコードは `app/server/` に置く。
- Unity / C# のコードは `app/unity/` に置く。
- Landing Page のコードは `lp/` に置く。
- API 契約と生成設定は `packages/contracts/` に置く。
- 生成 TypeScript client は `packages/api-client-ts/` に置く。
- 共有設定は `packages/config/` に置く。
- 再利用するタスク処理は `scripts/` に置き、`flake.nix` から公開する。

`app/server/` 内では次の境界を維持します。

- `internal/api/`: HTTP と Huma API の登録
- `internal/service/`: アプリケーションとドメインロジック
- `internal/db/`: DB adapter と migration
- `internal/db/sqlcgen/`: sqlc 生成コード。手編集禁止
- `internal/storage/`: object storage の抽象化と R2 adapter

## 環境セットアップ

ツールチェインは `flake.nix` と `flake.lock` で管理します。JavaScript の依存関係は
pnpm workspace で管理し、Node.js は 22 以上を使用します。

```bash
nix develop
nix run .#setup
```

`nix develop` は repository-local Git hook も有効化します。DB を使用する場合は
`app/server/.env.example` を確認し、実際の値を ignored な環境ファイルまたは secret
管理機構から読み込んでください。

詳細な server 環境変数、migration、smoke test は
[`app/server/README.md`](./app/server/README.md) を参照してください。

## 公式タスク入口

公式のタスク入口は Nix flake apps です。複雑な処理の実体は `scripts/` にあり、
通常は内部スクリプトを直接実行せず、次の入口を使用します。

| 用途                                    | コマンド                |
| --------------------------------------- | ----------------------- |
| 開発環境                                | `nix develop`           |
| 依存関係と hook のセットアップ          | `nix run .#setup`       |
| OpenAPI / TypeScript client / sqlc 生成 | `nix run .#gen`         |
| 生成物 drift 検査                       | `nix run .#drift`       |
| 全体品質ゲート                          | `nix run .#check`       |
| Legacy Backend check / test / build     | `nix run .#server`        |
| Control Plane check / test / build      | `nix run .#control-plane` |
| Web check / test / build                | `nix run .#web`         |
| LP test / check / build                | `nix run .#lp`          |
| TypeScript client typecheck / test      | `nix run .#contracts`   |
| Backend + LP の開発起動                 | `nix run .#dev`         |
| DB migration                            | `nix run .#migrate`     |
| Notion 同期                             | `nix run .#notion-sync` |
| flake の評価と formatter 検証           | `nix flake check`       |

`nix flake check` は flake の評価と formatter を検証します。アプリケーションの
品質ゲートではありません。コード変更時の全体品質ゲートは
`nix run .#check` です。

`nix run .#dev` が起動するのは Go server と LP だけです。`app/web` は Web package
の `dev` script から別途起動します。

Just、Make、Task、mise、その他の repository-wide task runner は、明示的な設計判断
なしに追加しません。

## API 契約と生成コード

HTTP API の編集点は `app/server/` の Huma operation 定義、入出力型、validation です。
`packages/contracts/openapi.yaml` は生成された成果物であり、手編集しません。

API を変更する場合は次の順序で進めます。

1. `app/server/` の Huma 定義と関連する Go 型を変更する。
2. `nix run .#gen` を実行する。
3. OpenAPI と生成 TypeScript client の差分を確認する。
4. `app/web/`、Unity の手書き manifest model など影響を受ける consumer を更新する。
5. server、client、consumer のテストを追加または更新する。
6. `nix run .#drift` または `nix run .#check` で生成物の整合性を確認する。

現在 `nix run .#gen` が生成するものは次のとおりです。

- `packages/contracts/openapi.yaml`
- `packages/api-client-ts/src/generated/schema.d.ts`
- `app/server/internal/db/sqlcgen/`

C# client の生成処理はまだ接続されていません。`packages/api-client-csharp/` や
Unity が自動更新されるとは扱わないでください。C# generator を導入する場合は、
生成 script と drift 検査を同じ変更で追加します。

`docs/api/openapi.json` は現在の `nix run .#gen` では生成されません。Go API と同期
していると仮定せず、更新する場合はその更新手順を明確にしてください。

生成ファイルは手編集しません。sqlc や `openapi-typescript` が付与する generated-file
notice も保持します。

## Database と migration

Backend は本番で Turso/libSQL、テストで `modernc.org/sqlite` の in-memory database
を使用します。migration は goose で管理し、`app/server/db/migrations/` から embed
されます。

- 適用済み migration は書き換えず、新しい migration を追加する。
- SQL を変更した場合は `nix run .#gen` で sqlc 生成コードを更新する。
- `nix run .#migrate` は documented な Turso 環境変数を必要とする。
- migration、repository、service、API、テストを一貫して更新する。

## テストと品質ゲート

各 package の `package.json` にある script を JavaScript の実行方法の正とします。
テストフレームワークを推測してコマンドを追加しません。

| 対象                      | 現在のテスト                                 | 今後の方針                          |
| ------------------------- | -------------------------------------------- | ----------------------------------- |
| `app/server/`             | Go `testing`、in-memory SQLite、fake storage | 維持                                |
| `packages/api-client-ts/` | `tsx --test`、TypeScript typecheck           | 維持                                |
| `app/web/`                | 現在は `tsx --test`                          | Vitest + Testing Library へ移行予定 |
| `lp/`                     | `tsx --test`、`svelte-check`、静的 build     | ページ追加に合わせて拡張            |
| `app/unity/`              | Unity Test Framework の EditMode/PlayMode    | Unity Editor で実行                 |

`nix run .#check` は生成物 drift、server、contracts、LP、Web の検証を実行します。
現在は Unity Editor テストを実行しません。ドキュメント link check や security
check も、この品質ゲートには含まれません。

Unity の動作変更では、Unity `6000.3.14f1` の Editor で EditMode/PlayMode テストを
実行します。GitHub-hosted runner の Unity workflow は `dotnet format`、PowerShell
analysis、`.meta` 整合性の静的検査のみを行います。

`nix run .#drift` と `nix run .#check` は drift 検査のため生成対象を index に staging
します。実行前後に `git status`、`git diff`、`git diff --cached` を確認してください。

チェックを実行できない場合は、実行できなかったコマンド、理由、代替検証を報告します。
skip された検証を成功したとは報告しません。

### 自動修正

領域別の自動修正は次のコマンドで実行します。

```bash
nix run .#server -- fix
nix run .#contracts -- fix
nix run .#lp -- fix
nix run .#web -- fix
```

Pull Request では `autofix.yml` が format と lint の自動修正を行う場合があります。

## Git hooks と commit

`nix develop` または `nix run .#setup` により、repository-local の
`core.hooksPath=packages/config/githooks` が有効になります。

現在 tracked されている hook は `prepare-commit-msg` です。commit message を変換
しますが、pre-commit の format や staged file の検証を保証するものではありません。
Vite+ の staged 設定が存在していても、設定された `core.hooksPath` と hook file を
確認せずに自動実行を前提にしません。

現在の変換例は次のとおりです。

```text
feat(server): add endpoint       -> ✨ server: add endpoint
gm feat(server): add endpoint    -> feat(server): ✨ add endpoint
n feat(server): add endpoint     -> feat(server): add endpoint
```

hook は Conventional Commits、scope、日本語、release metadata を検証しません。
既存の repository convention に従い、独自の convention を追加しません。

commit message の入力形式は次のとおりです。

```text
<type>(<scope>): <概要を日本語で>

<本文（必要な場合）>
```

scope は主な変更対象に合わせます。

| scope       | 対象                                             |
| ----------- | ------------------------------------------------ |
| `web`       | `app/web/`                                       |
| `server`    | `app/server/`                                    |
| `unity`     | `app/unity/`                                     |
| `lp`        | `lp/`                                            |
| `contracts` | `packages/contracts/` と `packages/api-client-*` |
| `config`    | `packages/config/`                               |
| `scripts`   | `scripts/`                                       |
| `docs`      | `docs/`                                          |
| `repo`      | repository 全体の設定                            |

対応する type は `feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、
`ci`、`chore`、`remove`、`deploy`、`init` です。gitmoji は手動で付けず、hook に任せます。

明示的に依頼されない限り commit や push を実行しません。commit を依頼された場合は、
事前に worktree と staged diff を確認し、完了後にも commit、status、diff を確認します。

## ブランチ

ブランチ名は次の形式を基本とします。

```text
<type>/<scope>-<short-desc>
```

例:

```text
feat/web-fbx-upload
feat/server-presentations-crud
fix/unity-controller-input-deadzone
```

`main` への直接 commit は原則として行いません。ブランチは短命に保ち、長期化した
場合は main の変更を取り込みます。

## 依存関係

依存関係を追加する前に、既存の stack で解決できないか確認します。

- JavaScript の依存関係は pnpm で追加し、`pnpm-lock.yaml` を更新する。
- Go の依存関係は Go tooling で `app/server/go.mod` と `go.sum` を更新する。
- Unity package は Unity Package Manager で `manifest.json` と `packages-lock.json` を更新する。
- 1 つの application のために repository-wide dependency を追加しない。
- 依存関係変更後は、関連する typecheck、test、lint、build を実行する。
- Unity が生成する `.sln`、`.csproj`、cache、build directory は commit しない。

## ドキュメント

次の変更では関連ドキュメントも更新します。

- アーキテクチャや責務境界
- Public API や生成契約
- DB schema や migration 手順
- 環境変数
- 開発セットアップや repository command
- build、CI、deployment 手順
- User-visible behavior

現行の開発情報は次を参照します。

- `ARCHITECTURE.md`: 目標アーキテクチャ
- `app/server/README.md`: server 環境変数と smoke test
- `scripts/README.md`: task entry point
- `docs/decisions/`: accepted ADR

`docs/plans/` は実装計画の履歴であり、現行仕様の根拠とは限りません。古い Hono、
Cloudflare/Supabase、`apps/*` layout を参照している資料は、現行実装と照合してから
使用します。

`docs/notion/` は Notion sync による生成物です。同期動作そのものを変更する場合を
除き、手編集しません。

将来の機能を、現在実装済みの機能としてドキュメントに記載しません。

## Security

次の情報は commit しません。

- Secrets
- API keys
- Tokens
- Private certificates
- Production credentials
- 個人用 environment files

Backend の環境変数は `app/server/.env.example` をテンプレートとして使用し、実際の
値は ignored な環境ファイルまたは secret management に置きます。

認証・認可、外部 URL、アップロードされた presentation data、file conversion、DB input
を扱う場合は、trust boundary で validation します。現在の API には認証・認可 middleware
がないため、user identity や access policy の存在を仮定しません。

Secrets、credentials、signed URL、sensitive な presentation data をログに出しません。
R2 signed URL の content type、content length、expiry、storage-key validation を維持します。

## Pull Request

Pull Request には次を含めます。

1. 何を変更したか、なぜ変更したか。
2. UI 変更時のスクリーンショットと動作確認手順。
3. 関連する Issue、ADR、設計判断。
4. 実行したチェックと、実行できなかったチェックの理由。

最低限、次を確認します。

- `nix run .#check` が成功している。
- TDD でテストを追加または更新している。
- API 契約を変更した場合は `nix run .#gen` を実行している。

Pull Request のタイトルは commit message と同じ形式にします。レビューを受け、
必要なチェックが通ってから merge します。

契約を変更した場合は `nix run .#gen` の実行と、server / Web / Unity など影響先の
更新を確認します。設計判断が必要な場合は `docs/decisions/` に ADR を追加するか、
Pull Request の本文に根拠を記載します。

要件が曖昧な場合は、推測で実装せず、実装前に確認します。
