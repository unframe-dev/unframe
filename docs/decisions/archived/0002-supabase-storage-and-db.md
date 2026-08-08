# ADR-0002: DB / Storage を Supabase、Runtime を Cloudflare Workers に乗せる

- **Status**: Superseded by ADR-0003
- **Date**: 2026-05-19
- **Deciders**: 颯士（Backend / WebApp 担当）
- **関連**: [ADR-0001](./0001-backend-mvp-design.md), [ADR-0003](./0003-full-renewal.md)

> **アーカイブ**: 本ADRは旧Supabase / Cloudflare Workers構成の歴史資料です。現在の設計・実装には使用しません。刷新履歴は [ADR-0003](./0003-full-renewal.md)、現行構成は [ADR-0004](../0004-monorepo-layout-and-nix-toolchain.md)、[`ARCHITECTURE.md`](../../../ARCHITECTURE.md) を参照してください。

---

## Context

ADR-0001 では「localhost + ローカル Postgres (docker-compose) + ローカル FS + Hono on Node.js」を前提に設計した。これを **Supabase（Postgres + Storage）+ Cloudflare Workers の runtime** に乗せ替える。動機:

- **配信**: マシン非依存。発表会の会場ネットワーク事情に左右されない URL を WebApp / MR / Backend で共有できる
- **運用**: docker-compose / migration / FS パーミッション / Node.js プロセス管理が消える
- **エッジ実行**: Cloudflare Workers の edge 配置で MR からのマニフェスト取得がレイテンシ低
- **コスト**: Supabase Free + Workers Free で発表会期間中はゼロ運用
- **Phase β への直接移行**: 「Phase β に Cloudflare へ」を前倒しで実現する

本 ADR は **どこをどう変えるか / どこは変えないか** を確定する。

---

## Decision

### 1. 永続化と runtime の構成

| レイヤー     | ADR-0001 原案                            | 本 ADR                                                                                   |
| ------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| DB           | ローカル Postgres（docker-compose）      | **Supabase Postgres**（チーム共有プロジェクト）                                          |
| ストレージ   | ローカル FS（`apps/backend/storage/`）   | **Supabase Storage**（バケット `assets`、**Public**）                                    |
| Runtime      | Node.js + `@hono/node-server`            | **Cloudflare Workers**（V8 isolates、wrangler でデプロイ）                               |
| 認証         | なし                                     | なし。**service role key は Worker env のみが保持**（後述）                              |
| アップロード | `POST /assets` multipart で backend 経由 | **Signed upload URL パターン**: `POST /assets/init` → クライアントが Supabase に直接 PUT |
| ダウンロード | `GET /assets/:id/file` で backend が返す | **クライアントが Supabase Public URL を直接 GET**                                        |

backend は引き続き **Hono の API layer** として残る（CRUD・バリデーション・マニフェスト組み立て・OpenAPI ドキュメントの責務）。Supabase REST/PostgREST を WebApp / MR から直接叩く構成にはしない。理由: `SlideContentSchema` の Zod バリデーションと `presentations.thumbnailAssetId` の参照整合 / `content.elements[].assetId` の存在検証などを backend に一本化したい。

### 2. Storage 構造

- **バケット**: `assets`（Public）
- **オブジェクトキー** (`<bucket>/<path-in-bucket>` の形): **`assets/<assetId>.<ext>`**
  - ADR-0001 で導入した `assets.storageKey` の値**そのまま**を再利用する。値の形式は変えない。
  - 解釈だけ変更: `storageKey` の **`/` より前**を bucket 名、**`/` より後**を bucket 内の path として扱う。
  - 結果: Phase β で別バケット（例: `thumbnails`）を切る将来も同じ列で吸収できる。
- **Public URL の組み立て**: backend は `${SUPABASE_URL}/storage/v1/object/public/${storageKey}` を作って `manifest` / `GET /presentations` レスポンスに埋め込む（または `supabase.storage.from(bucket).getPublicUrl(path)` の戻り値を使う）

### 3. 環境変数

Cloudflare Workers では `process.env` が**存在しない**。env は Hono の `c.env` 経由で参照する（後述）。`.env` は **Drizzle Kit (ローカル CLI)** 専用で、Worker 本体は **`.dev.vars`（ローカル wrangler dev）** と **`wrangler.toml` + Secrets**（本番）から env を取る。

```env
# === apps/backend/.env (Drizzle Kit migration 用、ローカル CLI のみ) ===
# Drizzle Kit migration は direct 接続必須（pooler の transaction mode は DDL で詰む）
DIRECT_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres

# === apps/backend/.dev.vars (ローカル wrangler dev 用) ===
# Worker runtime の DB 接続（Supavisor pooler、port 6543 / transaction mode）
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-...pooler.supabase.com:6543/postgres

# Supabase
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-jwt>
SUPABASE_STORAGE_BUCKET=assets

# CORS（カンマ区切り）
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

本番（Cloudflare Workers）には `wrangler secret put` で `DATABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` を投入し、`wrangler.toml` の `[vars]` に公開してよい `SUPABASE_URL` / `SUPABASE_STORAGE_BUCKET` / `CORS_ORIGINS` を書く。

**規律:**

- 必ず 2 種類の DB URL を持つ（DIRECT_URL は migration、DATABASE_URL は runtime）。
- Worker runtime の `postgres-js` は **`prepare: false`** で初期化する。Supavisor の **transaction mode** が prepared statement と非互換なため。**これが Workers + Supabase の最頻出 footgun**。
- `drizzle.config.ts` は `DIRECT_URL` を参照、`src/lib/db.ts` は **`c.env.DATABASE_URL`** から渡される接続文字列を使う。

### 4. RLS（Row Level Security）の姿勢

- Supabase は Postgres の RLS を **デフォルトでは無効**で `CREATE TABLE` を作る（Drizzle Kit が出す DDL もそのまま）。
- backend は **service role key** で接続するため **RLS をバイパスする**（service role は RLS を無視する仕様）。
- 結果: MVP では RLS を **意図的に有効化しない**。anon key を WebApp / MR に配らない限り公開アクセスは発生しない。
- **将来 anon key を WebApp / MR から直接使うようになった瞬間に**、RLS 未設定のテーブルが全公開状態になる。Phase β で認証を入れるタイミングで RLS ポリシーを設計するまで、**anon key の配布禁止**を運用ルールとして記録しておく。

### 5. アップロード経路（**Signed Upload URL パターン**）

ADR-0001 で当初想定していた「`POST /assets` multipart で backend が受ける」を**廃止**し、業界標準の signed URL パターンに切り替える。Workers の CPU / body 制限と無関係に動かすため、かつダウンロード側との対称性を取るための決定。

**フロー（2 ステップ運用 / MVP）:**

```
1. WebApp → Worker:  POST /assets/init { filename, contentType, sizeBytes }
   Worker: 許可 MIME / sizeBytes 検証 (50MB) → assetId 確保 → storageKey 確定
           "pending" 行を assets 表に insert
           supabase.storage.from('assets').createSignedUploadUrl(path)
           ← { assetId, uploadUrl, expiresAt }

2. WebApp → Supabase Storage:  PUT <uploadUrl>  body: file bytes
   バイトは **Worker を一切経由しない**
```

`POST /assets/:id/finalize`（HEAD 検証）は **MVP では省略**。pending 行は週次 GC で掃除（Follow-up）。

**service role key の所在は変わらない**: Worker env が保持し、signed upload URL の発行に使う。**バイトを見ることはない**。

### 6. API 表面の変更点

| API                                             | ADR-0001 原案                        | 本 ADR                                                                                        |
| ----------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `POST /assets` (multipart)                      | backend が受信して FS に書く         | **廃止**                                                                                      |
| `POST /assets/init` (JSON)                      | （存在せず）                         | **新規**。signed upload URL を返す                                                            |
| `GET /assets/:assetId/file`                     | backend が FS から stream            | **廃止**（クライアントが Supabase Public URL を直接取得）                                     |
| `GET /presentations/:id/manifest`               | `model.url` / `image.url` は相対パス | **絶対 URL（Supabase Public URL）**: `${SUPABASE_URL}/storage/v1/object/public/${storageKey}` |
| `GET /presentations` / `GET /presentations/:id` | `thumbnailUrl` は相対パス            | **絶対 URL（Supabase Public URL）**                                                           |

ADR-0001 の「URL は相対で返す」決定はここで覆る。理由: Supabase Storage のドメインが backend と別で、相対パスでは表現できない。代わりに Supabase URL を埋め込むことで、クライアントは backend を経由せず CDN 直接ダウンロードできる。

### 7. ファイルサイズ上限

- **50MB**（Supabase Free plan 上限）。ADR-0001 原案の 200MB を上書き。
- `POST /assets/init` の段階で `sizeBytes` を見て **事前に `413`** を返す。Worker にバイトが流れない（signed upload URL パターンの副次効果）。
- 発表会用デモモデルは 50MB 以下に押さえる（テクスチャ解像度を落とす / 埋め込みを外して別アセット化、等）。

### 8. Cloudflare Workers 実装上の留意点

| 項目                   | 留意点                                                                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Compatibility flag** | `wrangler.toml` に **`compatibility_flags = ["nodejs_compat"]`** を設定。`postgres-js` / `Buffer` などの Node API を Workers で動かすため必須                                                      |
| **postgres-js 初期化** | `postgres(url, { prepare: false })`。transaction-mode pooler が prepared statement と非互換のため。**最頻出 footgun**                                                                              |
| **env の取得経路**     | Worker は `process.env` 不可。Hono の **`c.env.DATABASE_URL`** 経由。`src/lib/env.ts` は `c.env` を Zod で再検証する形に refactor（middleware で 1 回検証して `c.set('env', ...)` する実装が安全） |
| **ロギング**           | `pino` / `pino-pretty` / `hono-pino` / `dotenv` を **削除**。`console.log` + 構造化 JSON で代替。Cloudflare logs に stdout が捕捉される                                                            |
| **ビルド**             | `@hono/vite-build/node` を削除し、**`wrangler deploy`** ベースに切り替え。`apps/backend/wrangler.toml` を新設、`dist/index.js` 起動方式は廃止                                                      |
| **ローカル dev**       | `wrangler dev` で起動。env は `.dev.vars` から読む（`.env` ではない）。`@hono/vite-dev-server` の Workers アダプタを使う選択肢もあるが、本番との挙動差を最小化するため `wrangler dev` を採用       |
| **Hyperdrive**         | MVP では**不要**。Supavisor pooler で十分。Phase β の負荷が読めた段階で再評価                                                                                                                      |

### 9. 依存の追加 / 削除

| 追加                                        | 削除                                                        |
| ------------------------------------------- | ----------------------------------------------------------- |
| `@supabase/supabase-js`                     | `@hono/node-server`                                         |
| `wrangler`（dev / deploy）                  | `dotenv`                                                    |
| `@cloudflare/workers-types`（型）           | `pino` / `pino-pretty` / `hono-pino`                        |
| `@cloudflare/vitest-pool-workers`（テスト） | （`@hono/vite-build/node` は build 時のみで残置可、要整理） |

既存の `postgres` + `drizzle-orm` はそのまま使える（接続文字列と `prepare: false` の追加だけ）。

### 10. docker-compose の扱い

- `docker-compose.yml` の `postgres` サービスは PoC 期間中は**起動不要**。`just db-up` を打たなくなる。
- ファイルは即時削除せず、`README.md` / `CONTRIBUTING.md` 側に「PoC 中は Supabase + Cloudflare Workers」旨を追記してから別 PR で整理する（Follow-up）。

---

## Alternatives Considered

### Option α: `GET /assets/:assetId/file` を backend proxy として残す

却下。Worker が Supabase からダウンロードして再 stream するため、帯域が二重に流れ Worker CPU を消費する。Public URL を直接埋め込めば不要。認証が要る Phase β でも、そのときに backend が短命の signed URL を発行する形に切り替えれば足り、proxy にする必然はない。

### Option β: `GET /assets/:assetId/file` を **302 リダイレクト**で Supabase URL に飛ばす

却下しないが採用しない。クライアントの URL 解釈をシンプルに保つため、manifest / list レスポンスに最初から最終 URL を埋め込む方を採る。302 を残す価値は「将来 signed URL に切り替える時の差し替え点」という保険のみ。MVP に不要。

### Option γ: WebApp / MR が Supabase の PostgREST / Storage API を**直接叩く**（backend を消す）

却下。`SlideContentSchema` の Zod バリデーション・`thumbnailAssetId` の FK 整合・`content.elements[].assetId` の参照確認・マニフェスト派生ビューの組み立てを Supabase 側に持たせるには RLS と Postgres functions / triggers の設計が必要で、PoC の 2 週間に収まらない。backend の Hono レイヤーを残す方が安い。

### Option δ: Cloudflare R2 + Hyperdrive + 自前 Postgres

却下。Phase β のフル設計に近いが、6/7 までに組み上がらない。Supabase で 1 つのサービスに集約する方が運用負担が低い。

### Option ε: Supabase CLI でローカルにインスタンスを立てる

却下。チーム共有プロジェクトの方が和貴（MR 担当）との疎通会で「同じ URL を見る」運用ができる。CLI ローカルだとマシン間で MR から WebApp の保存結果が見えない。

### Option ζ: Worker proxy で `POST /assets` multipart を維持

却下。**Workers Free の CPU 10ms 予算**を 50MB の multipart 解析が超える。Paid plan に上げても upload トラフィック増で詰む。signed upload URL に変えれば Worker が一切バイトを触らない（業界標準解）。

### Option η: Runtime に Node.js を残し Cloudflare Pages Functions / Vercel に置く

却下。Cloudflare Workers を選んだ目的（Phase β 直行 + edge レイテンシ）から外れる。Pages Functions は内部的に Workers なので結局同じ制約を踏む。

---

## Consequences

### Positive

- ローカル DB / FS / docker-compose / Node.js プロセス管理が消える
- MR / WebApp / Backend が別マシンでも Supabase + Workers エンドポイントを見れば疎通する → 発表会会場でも動かしやすい
- アセット配信が **CDN 直結**（Supabase edge）で、Worker が帯域ボトルネックにならない
- **Worker はバイトを一切扱わない**ため、CPU 10ms 制限の Free plan でも 50MB アップロードが成立する
- `storageKey` 列が**そのまま再利用**でき、ADR-0001 の抽象化への投資が回収される
- Phase β（認証 + signed download URL）への切り替えが「`getPublicUrl` → `createSignedUrl` の置換」だけで済む

### Negative

- **ファイルサイズが 50MB に縛られる**。発表会のデモモデルを縮める運用が必要
- **service role key の管理リスク**。漏れると DB が全権限で晒される。`.dev.vars` の git 除外 / `wrangler secret` 経由の本番投入を厳格に運用すること
- **インターネット必須**。会場ネットワークが死ぬと全停止する → リハで必ず会場 Wi-Fi での疎通を確認する
- **RLS 未設定**のため、**anon key の取り扱い**は厳重に。WebApp / MR には絶対に配らない（Worker 経由のみ）
- Drizzle migration を `DIRECT_URL` で適用するため、CI 環境では Secret として渡す追加設定が必要
- **`POST /assets/init` で 50MB 検証して通っても、Supabase 側で実バイトが超えると最終的に拒否される**（init は宣言ベース）。WebApp に retry / エラー表示の責務が乗る
- Workers ↔ Supabase の cold start レイテンシ。MVP では実害ない見込みだが計測対象

### Neutral

- backend は Hono のまま。アプリ層のレイヤー構造は不変
- `slides.content` jsonb / `thumbnailAssetId` FK / `storageKey` などの ADR-0001 のスキーマ判断はすべて生きる

---

## ADR-0001 への反映済み変更（追跡用）

ADR-0001（当時の Status は Accepted）には本 ADR の決定を反映していた。主な反映点:

| ADR-0001 の箇所               | 反映内容                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 「ストレージ」節              | 物理書き込み先が Supabase Storage バケット `assets` に。`storageKey` 値は不変                               |
| 「マニフェストの型」`url`     | **絶対 URL（Supabase Public URL）**                                                                         |
| 「ファイルサイズ上限」        | **50MB**（200MB から下げ）                                                                                  |
| API 表 `POST /assets`         | **`POST /assets/init`** に置換（signed upload URL を返す）                                                  |
| API 表 `GET /assets/:id/file` | **廃止**（クライアントが Supabase URL を直接 GET）                                                          |
| セキュリティ節                | `STORAGE_ROOT` 配下確認は対象外。`storageKey` 正規表現バリデーション + Supabase SDK 呼び出し前再検証の 2 段 |
| 受入条件 A1〜A7               | signed upload URL パターンに合わせて書き換え                                                                |
| 実装ステップ B2               | FS 書き込みを `createSignedUploadUrl` に置換                                                                |

---

## Follow-ups

### Supabase 周り

- [ ] Supabase プロジェクト作成 → 2 人で `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `DATABASE_URL` / `DIRECT_URL` を共有
- [ ] バケット `assets` を **Public** で作成（Supabase ダッシュボード or migration SQL）
- [ ] バケット `assets` の **CORS 設定**（WebApp の dev / 本番オリジンを許可）
- [ ] `apps/backend/src/lib/storage.ts` に Supabase Storage 操作の薄いラッパを置く（`createSignedUploadUrl` / `getPublicUrl`、テスト時に差し替え可能に）
- [ ] **pending 行の GC**: `assets` 表に N 日以上参照されていないレコードを掃除する Cloudflare Cron Triggers ジョブ

### Cloudflare Workers 周り

- [ ] `apps/backend/wrangler.toml` を新設（`compatibility_flags = ["nodejs_compat"]` / `[vars]` / `[[migrations]]`）
- [ ] `apps/backend/src/lib/env.ts` を `c.env` ベースに refactor（Zod 検証は middleware で 1 回）
- [ ] `pino` / `pino-pretty` / `hono-pino` / `dotenv` / `@hono/node-server` を削除し、`console.log` + 構造化 JSON ロガーに置換
- [ ] `wrangler` / `@cloudflare/workers-types` / `@cloudflare/vitest-pool-workers` を追加
- [ ] `apps/backend/src/lib/db.ts` を `postgres(url, { prepare: false })` に整える
- [ ] `drizzle.config.ts` を `DIRECT_URL` 参照に変更
- [ ] `vite.config.ts` の Node ビルドを wrangler ベースに置換
- [ ] `package.json` の `scripts.dev` を `wrangler dev`、`scripts.deploy` を `wrangler deploy` に
- [ ] `.dev.vars`（git ignore）と `.dev.vars.example`（git 管理）の整備

### リポジトリ整理

- [x] `docker-compose.yml` の `postgres` 削除 PR（PoC が安定したら）
- [ ] `README.md` / `CONTRIBUTING.md` に「runtime = Cloudflare Workers / DB+Storage = Supabase」を反映
- [ ] CI で `wrangler deploy --dry-run` の typecheck + Drizzle migration の dry-run を回す

### Phase β

- [ ] 認証導入時に RLS ポリシーを設計し、anon key を WebApp / MR で使い始める
- [ ] 大容量 upload が必要になったら R2 への移行 + Workers 直接バインドを検討
- [ ] Hyperdrive 導入で connection storm 対策（負荷が読めてから）
- [ ] `README.md` / `CONTRIBUTING.md` に「PoC 中は Supabase」追記
- [ ] `.env.example` を Supabase 前提に書き換え
- [ ] CI で `DIRECT_URL` / `DATABASE_URL` / `SUPABASE_*` を GitHub Secrets に登録
- [ ] Phase β: RLS ポリシー設計 + anon key 配布 + signed URL 切り替え
