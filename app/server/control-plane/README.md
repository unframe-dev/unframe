# Unframe Control Plane

Cloudflare Workers / Hono / D1 / R2 で動作する Control Plane です。

現在は次を実装しています。

- Better Auth の Google OAuth、Device Authorization、cookie / Bearer session
- owner / editor / global admin による Presentation 認可（editorは定義更新、削除はowner/adminのみ）
- `Group → Step → Cue` を持つ Presentation Definition の CRUD と revision 競合検知
- R2 直接uploadの初期化、署名済みContent-Length / MIME / SHA-256制約、finalize時のsize / magic bytes検証、download、監査log付き削除、metadata-less objectを含む孤児回収
- OpenAPI と TypeScript client の生成・drift check

Session、Realtime credential、checkpoint / completion callback は Phase 4 の対象で、まだ実装していません。
R2 objectを孤児化させないため、Asset metadataが残るPresentationは削除できません。先に各Assetの削除APIを完了させてください。

## Setup

`wrangler.jsonc` の D1 `database_id` と `R2_ACCOUNT_ID` は環境の値へ置き換えてください。秘密値は `.dev.vars.example` を参照し、ローカルでは `.dev.vars`、remote 環境では `wrangler secret put` で設定します。

```sh
pnpm db:migrate:local
pnpm r2:cors:apply
pnpm r2:cors:list
```

`db:migrate:remote` と `r2:cors:apply` は remote resource を変更するため、対象 account と resource を確認してから実行してください。R2 CORS は Web Editor からの signed `PUT` / `GET` に必要です。

## Commands

```sh
pnpm check
pnpm types
pnpm test
pnpm auth:schema:generate
pnpm --filter @unframe/contracts generate:control-plane
```

`pnpm types` は Wrangler binding 型を再生成します。`auth:schema:generate` は Better Auth の参照用 SQL を ignored の `.generated/` へ出力し、review 済み migration を直接上書きしません。

OpenAPI 3.0.3 と生成 TypeScript 型は `packages/contracts/`、typed runtime client は `packages/api-client-typescript/` にあります。Better Auth が所有するendpointは`better-auth@1.6.26`へ固定した認証clientから型付きで利用でき、参照用OpenAPI 3.1.1は`GET /api/auth/open-api/generate-schema`で取得できます。

未処理例外は route pattern、例外名、incident ID だけを構造化ログへ記録し、message、credential、signed URL を response やログへ出しません。
OAuth codeやDevice Authorization user codeをqueryに含むため、Workers invocation logsと自動traceは無効化しています。

## Validation boundary

通常 CI は Miniflare の D1 / R2 binding を使って migration、repository、HTTP、asset finalize を検証します。R2 S3 endpoint の SigV4、browser CORS、実 bucket の checksum metadata は local runtime と完全には同一ではないため、remote 設定後に staging bucket で upload / finalize / download の smoke test が必要です。
