# Unframe Control Plane

Cloudflare Workers / Hono / D1 / R2 で動作する Control Plane です。

現在は次を実装しています。

- Better Auth の Google OAuth、email/password、TOTP MFA、Device Authorization、cookie / Bearer session
- owner / editor / global admin による Presentation 認可（editorは定義更新、削除はowner/adminのみ）
- `Group → Step → Cue` を持つ Presentation Definition の CRUD と revision 競合検知
- R2 直接uploadの初期化、署名済みContent-Length / MIME / SHA-256制約、finalize時のsize / magic bytes検証、download、監査log付き削除、metadata-less objectを含む孤児回収
- Waiting / Presenting / Ended のSession lifecycle、50人上限、固定presenter、hash化join codeとcode / user / IP別rate limit
- session participant向けの1週間有効なEd25519 Realtime credentialと公開JWKS
- Realtime service identity専用のidempotent checkpoint / completion callback
- 実行ルートと一体化した OpenAPI 生成、Hono RPC TypeScript client、契約 drift check

認証endpointとserver-side policyまでが実装済みです。Web / Unityのemail/password UIはこのcomponentの対象外で、まだ接続していません。
Realtime BackendでのJWT検証とsession終了状態の照合、Web / Unityからのconsumer接続は未実装です。
R2 objectを孤児化させないため、Asset metadataが残るPresentationは削除できません。先に各Assetの削除APIを完了させてください。

## Setup

`wrangler.toml` の D1 `database_id` と `R2_ACCOUNT_ID` は環境の値へ置き換えてください。秘密値は `.dev.vars.example` を参照し、ローカルでは `.dev.vars`、remote 環境では `wrangler secret put` で設定します。Better Auth Infrastructure連携を使う場合は、Dashboardで発行した `BETTER_AUTH_API_KEY` も同じ方法で設定してください。

```sh
pnpm db:migrate:local
pnpm db:migrate:remote # remote D1を変更するため、対象を確認してから実行
pnpm r2:cors:apply
pnpm r2:cors:list
```

`db:migrate:remote` と `r2:cors:apply` は remote resource を変更するため、対象 account と resource を確認してから実行してください。R2 CORS は Web Editor からの signed `PUT` / `GET` に必要です。

`api.un-fra.me` の Worker Custom Domain はリポジトリ外の [`infra`](../../../../infra/README.md)
Terraform で管理します。Wrangler は Worker の build / deploy、secret、D1 migration を担当します。

## Commands

```sh
pnpm check
pnpm types
pnpm test
pnpm deploy
pnpm auth:schema:generate
pnpm --filter @unframe/contracts generate:control-plane
```

`pnpm types` は Wrangler binding 型を再生成します。`auth:schema:generate` は Better Auth の参照用 SQL を ignored の `.generated/` へ出力し、review 済み migration を直接上書きしません。

email/password はメール確認後に利用でき、TOTP または backup code の MFA を必要とします。確認・password reset メールは Resend を使うため、`RESEND_API_KEY` と表示名なしの送信元メールアドレス `AUTH_EMAIL_FROM` を設定してください。password reset は既存 session と未消費の認証grantを失効させます。MFA の trusted device は Better Auth 標準どおり30日間有効です。

Realtime credential署名にはEd25519 private JWKのJSONを`REALTIME_SIGNING_JWK`へ設定し、公開鍵の識別子を`REALTIME_SIGNING_KID`で管理します。`SERVICE_IDENTITY_SECRET`はRealtime Backendからcheckpoint / completion callbackを送るための専用Bearer secretで、user session tokenとは共有しません。両方ともremote環境ではWrangler secretとして設定してください。

Worker起動時に全設定を検証するため、`pnpm deploy` または直接 `wrangler deploy` を実行した際に不足・不正な設定があればデプロイは失敗します。エラーには設定名だけを出し、値は出力しません。

Product-owned endpoint は `createRoute` と `OpenAPIHono` で実装・入力検証・OpenAPI・Hono RPC型を一元化しています。OpenAPI 3.0.3 と言語非依存の生成 TypeScript 型は `packages/contracts/`、Hono RPC client は `packages/api-client-typescript/` にあります。Better Auth が所有するendpointは`better-auth@1.6.26`へ固定した認証clientから型付きで利用でき、参照用OpenAPI 3.1.1は`GET /api/auth/open-api/generate-schema`で取得できます。

未処理例外は route pattern、例外名、incident ID だけを構造化ログへ記録し、message、credential、signed URL を response やログへ出しません。
OAuth codeやDevice Authorization user codeをqueryに含むため、Workers invocation logsと自動traceは無効化しています。

Product-owned D1 tables の通常の CRUD・一覧・lookup は Drizzle ORM を使います。migration DDL / trigger、Better Auth の D1 接続、revision・status の比較更新と JSON1 / `NOT EXISTS` を含む競合安全な単一 statement は D1 SQL のまま維持しています。

## Validation boundary

通常 CI は Miniflare の D1 / R2 binding を使って migration、repository、HTTP、asset finalize を検証します。R2 S3 endpoint の SigV4、browser CORS、実 bucket の checksum metadata は local runtime と完全には同一ではないため、remote 設定後に staging bucket で upload / finalize / download の smoke test が必要です。
