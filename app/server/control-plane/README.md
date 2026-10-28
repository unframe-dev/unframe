# Unframe Control Plane

Cloudflare Workers / Hono / D1 / R2 で動作する Control Plane です。

内部の責務、layer、durable resource、contract、security boundary は [ARCHITECTURE.md](./ARCHITECTURE.md)、Realtime Backend との関係は [`../ARCHITECTURE.md`](../ARCHITECTURE.md) を参照してください。

現在は次を実装しています。

- Better Auth の Google OAuth、email/password、TOTP MFA、Device Authorization、cookie / Bearer session
- owner / editor / global admin による Presentation 認可（editorは定義更新、削除はowner/adminのみ）
- `Group → Step → Cue` を持つ Presentation Definition の CRUD と revision 競合検知
- R2 直接uploadの初期化、署名済みContent-Length / MIME / SHA-256制約、finalize時のsize / magic bytes検証、download、監査log付き削除、metadata-less objectを含む孤児回収
- Waiting / Presenting / Ended のSession lifecycle、50人上限、固定presenter、hash化join codeとcode / user / IP別rate limit
- adminによるVenue Edge provisioning、hash化したEdge固有credential、rotation / revoke、registration、単一Sessionのlease付きassignment / epoch fencing。lease日時はcanonical ISOで保存し、Edgeからのrenewは5分以内に制限する
- v2 専用の Venue Edge registration / Realtime JWT と公開 JWKS。bootstrap は公開済み v2 build に pin された Session と参加者の Projection Profile を必須とし、Publication Fence を返す
- Realtime service identity専用のidempotent checkpoint / completion callback
- 実行ルートと一体化した OpenAPI 生成、Hono RPC TypeScript client、契約 drift check

認証endpointとserver-side policyまでが実装済みです。Web / Unityのemail/password UIはこのcomponentの対象外で、まだ接続していません。
Realtime Backend の JWT / scope 検証、assignment fencing と Unity の v2 Delivery / bootstrap 接続は実装済みです。Control Plane の Session 終了を既存 Realtime 接続へ反映する Cloud Agent と、Web の旧 CRUD 定義の v2 移行は後続作業です。
R2 objectを孤児化させないため、Asset metadataが残るPresentationは削除できません。先に各Assetの削除APIを完了させてください。

Session の新規作成には公開済み Dist が必要です。公開版の確認と epoch の固定は D1 の同じ原子的処理で行い、未公開の場合は 409 を返して Session／participant を残しません。作成・取得 response の `publicationFence` は保存 epoch の manifest から返します。既存の未公開 Session だけ `publicationFence: null` となり、start / bootstrap は 409 を返します。この場合は先に Session を終了し、v2 build を公開してから作り直してください。既存 v1 Venue Edge は assignment / renew / bootstrap の対象にならず、v2 で再登録が必要です。v1 データを v2 として読み替えません。

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

Venue Edge credentialはprovisioning / rotation responseで一度だけ返し、D1にはtoken IDとSHA-256 hashだけを保存します。`0009_runtime_assignments.sql` は旧 Edge assignment の lease を解放し、既存 Edge が provisioning identity とは別の `runtimeId` で再登録できる状態へ移行します。migration は session state を変更しないため、適用前に `Presenting` session を停止・drainし、適用後に Edge の再登録と必要な session の再割り当てを行ってください。移行行の `runtime_id` に残る旧 `edge_id` は released history の識別子であり、active Runtime identity として再利用しません。Realtime credential署名にはEd25519 private JWKのJSONを`REALTIME_SIGNING_JWK`へ設定し、公開鍵の識別子を`REALTIME_SIGNING_KID`で管理します。Runtime JWT audienceはControl PlaneとRealtime Runtimeで`unframe-realtime-runtime`に統一します。Quest向けJWTはruntime ID / kind、epoch、Presentation ID / revisionを拘束し、active leaseの期限を越えて発行しません。Venue Edge assignmentだけが`assets:read`を含み、Cloud assignmentは`realtime:connect`だけを含みます。`SERVICE_IDENTITY_SECRET`はRealtime Backendからcheckpoint / completion callbackを送るための専用Bearer secretで、user session tokenやEdge固有credentialとは共有しません。秘密値はremote環境ではWrangler secretとして設定してください。

`wrangler.toml` の `secrets.required` は remote 環境へ事前設定する binding の一覧です。`REALTIME_AUDIENCE` は secret ではなく、`[vars]` で `unframe-realtime-runtime` に固定しています。Worker は request handling の入口で全設定を検証するため、不足・不正な設定がある環境は traffic を受ける前の smoke test で検出します。エラーには設定名だけを出し、値は出力しません。

Product-owned endpoint は `createRoute` と `OpenAPIHono` で実装・入力検証・OpenAPI・Hono RPC型を一元化しています。OpenAPI 3.0.3 と言語非依存の生成 TypeScript 型は `packages/contracts/`、Hono RPC client は `packages/api-client-typescript/` にあります。Better Auth が所有するendpointは`better-auth@1.7.1`へ固定した認証clientから型付きで利用でき、参照用OpenAPI 3.1.1は`GET /api/auth/open-api/generate-schema`で取得できます。

未処理例外は route pattern、例外名、incident ID だけを構造化ログへ記録し、message、credential、signed URL を response やログへ出しません。
OAuth codeやDevice Authorization user codeをqueryに含むため、Workers invocation logsと自動traceは無効化しています。

Product-owned D1 tables の通常の CRUD・一覧・lookup と単純な条件付き更新は Drizzle ORM を使います。migration DDL / trigger、Better Auth の D1 接続、JSON1 や複数テーブルの整合性・割当の排他条件を含む複雑な書き込みは D1 SQL を使います。SQL を残す理由は条件と書き込みを一つの文として読み取れることにあり、原子性が Drizzle では保てないという制約ではありません。Drizzle と SQL を同じ処理で使う場合も、既存の D1 batch による原子性を維持します。

## Validation boundary

通常 CI は Miniflare の D1 / R2 binding を使って migration、repository、HTTP、asset finalize を検証します。R2 S3 endpoint の SigV4、browser CORS、実 bucket の checksum metadata は local runtime と完全には同一ではないため、remote 設定後に staging bucket で upload / finalize / download の smoke test が必要です。

## TODO

- Presentation CRUD API の旧 `groups / elements` 定義を共有 v2 Definition 契約へ更新し、Web の作成・保存と生成クライアントを揃える。既存 v1 データの移行・互換読み込みは行わない。この更新は Delivery / Realtime の v2 専用化とは別途実施する。

## Audience のブラウザー接続

`AUDIENCE_ORIGIN` は任意の origin URL です。設定すると `WEB_ORIGIN` に加えてその origin の CORS を許可します。匿名 Viewer はメモリ上の bearer credential を使い、Better Auth のログインや cookie を必要としません。

`POST /viewer-credentials` に `joinCode` を渡すと、その Session に Viewer として参加し、1 時間有効な資格を発行します。既存の join と同じコード・IP 制限と参加人数上限を適用します。`POST /viewer-credentials/refresh` は有効な bearer 資格を更新し、旧 token を直ちに失効させます。発行から 24 時間を超えて更新できません。`DELETE /viewer-credentials` は資格を失効させ、参加枠と専用の匿名ユーザー行を解放します。期限切れの匿名 Viewer は、同じ Session の次回資格発行時に回収します。発行後の `/sessions/join` は既存の参加結果を返し、参加制限を二重に消費しません。Session 終了時も資格を受理しません。匿名資格は対象 Session の join・取得・delivery・bootstrap に限定し、編集・管理 API には使用できません。
