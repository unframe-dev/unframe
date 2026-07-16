# ADR-0001: Backend MVP（6/7 発表会版）の要件と設計

- **Status**: Accepted
- **Date**: 2026-05-19
- **Deciders**: 颯士（Backend / WebApp 担当）
- **関連**: [`docs/notion/6月MVP.md`](../notion/6月MVP.md), [`docs/notion/Unframe.md`](../notion/Unframe.md), [ADR-0002](./0002-supabase-storage-and-db.md)（ストレージ層・DB ホスト・runtime・アップロード経路を本 ADR とセットで読む）

---

## Context

2026-06-07 の成果発表会まで実質 2 週間。`docs/notion/6月MVP.md` で「**Web で作る → Backend に保存 → MR で表示する E2E 1 スライス**」を 1 スライド + 1 モデル + 1 テキストで通すことが MVP と確定済み。本 ADR は **`apps/backend/` がそれを満たすために何を提供するか** を確定する。

既存 scaffold: Hono + `@hono/zod-openapi` + Drizzle ORM + Scalar (`/docs`) + pino + 共有契約 (`packages/contracts/`) は導入済み。`/health` のみ実装され、`presentations` テーブルは `(id, title, createdAt, updatedAt)` の最小形のみ。

確定済みの上位判断（[`memory/mr_presen_overview.md`](../../memory/mr_presen_overview.md) 参照）:

| 項目 | 決定 |
| --- | --- |
| 3D モデル形式 | **`.fbx`**（`6月MVP.md` 準拠。`.glb` 撤退） |
| 配信パイプライン | localhost + ローカル Postgres (docker-compose) |
| 認証 / リアルタイム同期 / R2 / Cloudflare | **全部やらない** |
| アップロードフロー | **2 段階**（`POST /assets` → assetId → `PUT /presentations/:id`） |
| マニフェスト | **`GET /presentations/:id/manifest`**（単一プレゼンの全要素） |

---

## Decision

`apps/backend/` は以下を提供する Hono on Node.js の HTTP サーバとする。

### 提供する 4 種類の API

| カテゴリ | API | 役割 |
| --- | --- | --- |
| アセット | `POST /assets/init` | `{ filename, contentType, sizeBytes }` を受け、許可 MIME / サイズを検証して `assetId` を確保、Supabase の **signed upload URL** を発行して返す（**signed upload URL パターン**。詳細 → ADR-0002） |
| アセット | （アップロード本体） | WebApp が `uploadUrl` に直接 PUT。Backend は介在しない |
| プレゼン | `POST /presentations` | タイトル + 1 スライド（`content.elements[]`）+ `thumbnailAssetId?` を作成 |
| プレゼン | `PUT /presentations/:id` | 既存プレゼンの title / slide.content / `thumbnailAssetId` を更新（content は全置換） |
| プレゼン | `GET /presentations/:id` | プレゼン本体（slide + thumbnail URL）を返す（WebApp 編集再開用） |
| プレゼン | `GET /presentations/:id/manifest` | MR 向けの統合マニフェスト（slide + model URL + transform） |
| プレゼン | `GET /presentations` | プレゼン一覧（id + title + thumbnailUrl）。WebApp の選択 UI 用 |
| システム | `GET /health` | 既存。プロセス liveness のみ |

> **MVP では `/finalize` を省略** する 2 ステップ運用（init + PUT）。`init` 時点で DB に `assets` 行を作成し、参照されない pending 行は週次 GC で掃除する（Follow-up）。`GET /assets/:assetId/file` は **廃止**（クライアントは manifest / list レスポンスの URL を直接取得）。

`DELETE` は MVP では出さない（発表会の手元から消す必要が無い）。

### ストレージ（`storageKey` の契約）

- ファイル本体は **Supabase Storage の `assets` バケット**に書く（ADR-0002）。
- **`storageKey`** は DB の `assets.storageKey` 列に保存する正規化済み文字列で、形式は **`assets/<assetId>.<ext>`**（`<ext>` は小文字正規化済み拡張子）。`/` 区切りで前半が bucket 名、後半が bucket 内 path。
- 入口バリデーション: `storageKey` は `^assets/[0-9a-f-]{36}\.[a-z0-9]+$` に一致するもののみ受理。`..` / バックスラッシュ / 想定外文字種は拒否。
- backend は `storageKey` から Supabase Storage SDK 経由で `createSignedUploadUrl` / `getPublicUrl` を呼ぶ（物理パス組み立てを自前で行わない）。
- **Phase β（R2/S3 等への乗せ替え）でも `storageKey` 値はそのまま object key として再利用**できる。DB スキーマは不変。

### DB スキーマ（拡張）

`packages/contracts/src/db/schema.ts` を以下に拡張する。

```ts
// 既存を拡張
presentations {
  id                  uuid PK
  title               text NOT NULL
  thumbnailAssetId    uuid NULL REFERENCES assets(id) ON DELETE SET NULL  // 追加: 一覧/詳細でサムネ表示
  createdAt           timestamptz NOT NULL DEFAULT now()
  updatedAt           timestamptz NOT NULL DEFAULT now()
}

// 追加
assets {
  id              uuid PK
  filename        text NOT NULL              // 元ファイル名（表示用、拡張子つき）
  mimeType        text NOT NULL              // "application/octet-stream" / "image/png" / "image/jpeg" / "image/webp"
  sizeBytes       bigint NOT NULL
  storageKey      text NOT NULL UNIQUE       // 例: "assets/3f8a....-....fbx" / "assets/.....png"
  createdAt       timestamptz NOT NULL DEFAULT now()
}

slides {
  id              uuid PK
  presentationId  uuid NOT NULL REFERENCES presentations(id) ON DELETE CASCADE
  orderIndex      integer NOT NULL DEFAULT 0          // MVP は 0 固定だが Phase α 用に持つ
  content         jsonb NOT NULL                      // スライド本体（要素配列）
  createdAt       timestamptz NOT NULL DEFAULT now()
  updatedAt       timestamptz NOT NULL DEFAULT now()

  UNIQUE (presentationId, orderIndex)
}
```

`assets` テーブルは「**モデル・画像・サムネを区別しないバイナリ blob ストア**」として扱う。種別の意味は「どこから参照されているか」（`presentations.thumbnailAssetId` の FK / `slides.content.elements[].assetId` の jsonb 参照）が決める。

`slides.content` には WebApp / Backend / MR で共有する **`SlideContentSchema`**（Zod）の形を入れる。スライドは **要素の配列**であり、各要素は自身の `transform`（3D 空間内の位置・回転・拡縮）を持つ:

```ts
TransformSchema = z.object({
  position: z.object({ x: number, y: number, z: number }),
  rotation: z.object({ x: number, y: number, z: number }),   // Euler 角・度
  scale:    z.object({ x: number, y: number, z: number }),
})

const ElementBase = z.object({
  id: z.string().uuid(),         // slide 内で一意。要素単位の transform 編集・選択のために backend が UUID を発番
  transform: TransformSchema,    // 各要素が個別に持つ
})

SlideElementSchema = z.discriminatedUnion('type', [
  ElementBase.extend({ type: z.literal('text'),  text: z.string() }),
  ElementBase.extend({ type: z.literal('model'), assetId: z.string().uuid() }),  // assets.id を参照（jsonb 内）
  ElementBase.extend({ type: z.literal('image'), assetId: z.string().uuid() }),  // assets.id を参照（jsonb 内）
])

SlideContentSchema = z.object({
  elements: z.array(SlideElementSchema),
})
```

MVP では「text 要素 1 つ + model 要素 1 つ + image 要素 0〜N 個」の組み合わせで 1 スライドを構成する。要素タイプを増やしたい将来は `SlideElementSchema` の `discriminatedUnion` に branch を追加するだけ。slide レベルのプロパティ（背景色・遷移・音声 cue 等）は **MVP では持たない**。必要になったら `SlideContentSchema = z.object({ elements, background?, ... })` に拡張する余地は jsonb で保たれる。

#### なぜ jsonb 1 列か（slide-as-document）

- **スライドを 1 つの「ドキュメント」として扱う**。スキーマ進化（注釈・複数モデル・画像要素など）に対し RDB スキーマ migration を毎回出さずに済む
- ストレージにファイルとして書き出すと **「DB の updatedAt 更新」と「ファイル書き込み」をアトミックにできない**（クラッシュ時の不整合）。jsonb なら 1 トランザクションで完結
- WebApp / MR から見れば「スライド = 1 JSON」という見え方を維持できる

#### FK を jsonb の外に出すルールの**再定義**

> **FK は jsonb の外に出す — ただしカーディナリティが固定・安定なときに限る。**

- **適用される例**: `presentations.thumbnailAssetId`（1 プレゼンに 1 サムネ、明確に 1:1）→ **FK 列**として残す。Postgres が参照整合性を強制する
- **適用されない例**: `slides.content.elements[].assetId`（1 スライドに 0〜N 個の model/image 要素）→ **jsonb 内に書く**。要素数が可変なので FK 列群では表現できない
- **過去案**（`slides.modelAssetId` を FK 列に出す）の却下理由: 「1 スライド = 1 モデル」を schema に焼き付けてしまうため、image 要素や追加モデル要素を入れる際に schema migration が必要になる。MVP の前提が崩れた時点で却下

#### jsonb 内の `assetId` の整合性をどう守るか

`content.elements[].assetId` は Postgres FK で守れない。代わりに以下の規律で扱う:

- **MVP**: そもそも `DELETE /assets` を実装しない（ADR-0001 で決定済み）。**API 表面から dangling 参照を作れない**ため、整合性問題は発生しない
- **書き込み時の参照確認**: `POST /presentations` / `PUT /:id` で `content.elements[].assetId` が `assets` 表に存在するか、backend が同一トランザクション内で SELECT して `400` を返す
- **Phase α の整合性**: `DELETE /assets` を追加するタイミングで以下のいずれかを採用する（本 ADR では決めない、Follow-up）
  - (a) `assets.deletedAt` 論理削除 + `WHERE deleted_at IS NULL` フィルタ。物理ファイルだけ消す（軽い）
  - (b) `slide_assets` join table を作り、`content.elements[].assetId` から backend が同期。Postgres の FK が守る（強い / 並行更新で複雑）

#### 更新ポリシー: `content` は常に全置換

- `PUT /presentations/:id` は `content` を **部分パッチせず常にまるごと差し替える**（`jsonb_set` 禁止）
- 受け取った body を `SlideContentSchema` で再バリデーション → そのまま `update().set({ content })`
- 部分更新の整合性ロジックを backend に持たせない（複雑度の最大の発生源を消す）

#### 回転表現

- Euler 角（度）。Unity / Babylon.js どちらも度→ラジアン変換 1 回で済む。Quaternion は MVP 不要

### マニフェストの型（MR が消費）

マニフェストは `SlideContentSchema` を**そのまま投影**し、各要素の `assetId` を解決済みの `asset` オブジェクト（URL 等つき）に展開した派生ビューとする:

```ts
ManifestAsset = {
  assetId: string
  url: string             // 相対パス "/assets/<id>/file"
  filename: string
  mimeType: string
  sizeBytes: number
}

ManifestElement =
  | { type: 'text';  id: string; transform: Transform; text: string }
  | { type: 'model'; id: string; transform: Transform; asset: ManifestAsset }
  | { type: 'image'; id: string; transform: Transform; asset: ManifestAsset }

GetManifestResponse = {
  presentationId: string   // uuid
  title: string
  slides: Array<{
    id: string
    orderIndex: number
    elements: Array<ManifestElement>
  }>
  updatedAt: string        // ISO 8601、slides.updatedAt の MAX とプレゼン本体の MAX
}
```

- `url` は **相対パス**で返す（base URL はクライアントが環境設定で持つ）
- MR は `elements` を上から走査して、`type` 別に「テキストを 3D 空間配置 / model を fbx ロード / image を textured quad 描画」を行う
- マニフェストに **thumbnail は含めない**（MR は使わない。WebApp の一覧 UI 用は `GET /presentations` で返す）

マニフェストは DB の `slides.content` jsonb と `assets` を join して**毎リクエスト動的に組み立てる**派生ビュー。事前生成・キャッシュは MVP では不要。MR の取得頻度は低く、レイテンシも実用域。

### CORS

`hono/cors` を `app.ts` 直下に挟む。MVP では `origin: ["http://localhost:5173", "http://localhost:3000"]` をデフォルトに、環境変数 `CORS_ORIGINS`（カンマ区切り）で上書き可能にする。MR (Unity) は CORS の影響を受けない。

> **WebApp が Supabase Storage に直接 PUT する経路（signed upload URL）の CORS** は backend ではなく **Supabase バケット側で設定**する必要がある。本番ドメインとローカル dev のオリジンを Supabase ダッシュボードの Storage CORS 設定に登録（Follow-up）。

### ファイルサイズ上限

**50MB**（Supabase Free plan 準拠。ADR-0002 で確定）。`POST /assets/init` の段階で `sizeBytes` を見て事前に `413` を返すため、Worker にバイトが流れない（signed upload URL パターンの副次効果）。発表会用デモモデルは 50MB 以下に押さえる運用ルール。

### エラー応答の共通形

```ts
{ error: { code: string; message: string; details?: unknown } }
```

ステータスコード:
- `400` バリデーション失敗（Zod の issue を details に詰める）
- `404` リソース未存在
- `409` 整合性エラー（`UNIQUE (presentationId, orderIndex)` 違反など）
- `413` ファイルサイズ超過
- `415` MIME type 不正
- `500` 想定外（pino で error log）

---

## Alternatives Considered

### Option A: 1 段階アップロード（`POST /presentations` に multipart で全部）

却下。`transform` の細かい更新でも数十 MB のファイルが飛ぶ。WebApp の transform 編集の UX が崩れる。

### Option B: スライドを relational 列フル展開（`text` / `position` / `rotation` / `scale` を slides の列に）

却下。スライド構造が育つたびに schema migration が要る。Phase α で「複数モデル」「画像要素」「注釈」を入れた瞬間に列爆発する。MVP の単純さで一見勝つように見えるが、寿命が短い。

### Option F: スライド JSON を storage に書き、DB は `storageKey` だけ持つ（質問で出た案）

却下。「DB の `updatedAt` 更新」と「ファイル書き込み」を**アトミックにできない**（クラッシュで不整合）。transform 編集の保存はホットパスなので、ここの不整合バグは MVP に持ち込みたくない。スキーマレスのメリットは jsonb 1 列で同等に取れる。

> スライド JSON を**ファイルとしてエクスポートしたい**要件が将来出てきた場合は、`GET /presentations/:id/export` のような export 専用エンドポイントを足せばよく、永続化の主格を storage に置く必要はない。

### Option C: 回転を Quaternion で保持

却下。MVP で Quaternion 編集 UI を用意する余裕がない。Euler 角（度）の方が WebApp 側で直接 input number に bind できる。ジンバルロックは発表シナリオで踏まない。

### Option G: `content` jsonb に `modelAssetId` も含める（**初版で却下、現在は採用**）

**当初却下していたが、要素配列化に伴い採用**に転じた。理由: 「1 スライド = 1 モデル」前提が `text + model + image` の同居で崩れた時点で、FK 列方式では複数アセット参照を表現できなくなった。整合性は **`DELETE /assets` を MVP で出さない**ことで API 表面から dangling 不能にして対処（→ Phase α で論理削除 or join table のいずれかを採用、Follow-up）。

### Option H: スライドを `text` / `model` のフラット列で持つ（要素配列にしない）

却下。`image` 要素を入れた瞬間に schema 変更が必要。**要素の種類が増えるたびに型が爆発する**。discriminated union + 配列なら branch 追加だけで済む。

### Option I: 要素ごとに別テーブル（`slide_texts` / `slide_models` / `slide_images`）

却下。MR / WebApp は「要素を**順序つき配列として上から走査する**」のが自然。テーブル別にすると、その順序を保つために `orderIndex` を 3 テーブル横断で UNIQUE にする等の複雑さが発生する。jsonb 配列なら**配列の物理順がそのまま意味を持つ**。

### Option D: マニフェストに絶対 URL を埋め込む

却下。dev/本番で host が変わるたびに backend 内部で base URL を組み立てるロジックが要る。クライアント側で base URL を持つ方が単純。

### Option E: ストレージを object storage（MinIO 等）でモック

却下。発表会版のスコープ外。ローカルファイルシステムで十分。

---

## Consequences

### Positive
- WebApp / MR 双方が **`packages/contracts/`** の Zod スキーマ 1 ヶ所で API 形を共有でき、型整合の食い違いが起きない。
- 1:N の slide テーブルにしたことで、Phase α（マルチスライド）への移行が**スキーマ無変更**で済む。
- `slides.content` を jsonb にしたことで、スライド構造の進化（注釈・複数要素・画像など）に対し DB schema migration が原則不要になる。
- 2 段階アップロードで、transform 編集時に巨大ファイル再送がない → WebApp のプレビュー編集が軽い。

### Negative
- ストレージがローカル FS なので、**他マシンの MR から見たい場合は同一マシン上で backend を立てる必要**がある（OK / 発表会では 1 PC でデモする想定）。
- 拡張子 `.fbx` の MIME type が標準化されておらず、`application/octet-stream` 受け入れになる。MIME ベースでのバリデーションが弱い → ファイル名末尾 `.fbx` の検査で代替。

### Negative（jsonb 採用の代償）
- `slides.content` 内側の値で WHERE 検索する場合は jsonb 演算子が必要になる。MVP では内側検索の要件なし。
- jsonb の中身は DB constraint で守れない → **入口で `SlideContentSchema` (Zod) で必ず再バリデーション**する規律が必要（PUT 時の全置換ポリシーで一本化）。

### Neutral
- 「テキストだけのスライド」「画像が複数あるスライド」など、要素構成の自由度が schema レベルで保証される
- discriminated union により Zod のエラーメッセージが「どの要素のどのフィールドが不正か」を明確に返す（debug が楽）

---

## 機能要件（受入条件 = TDD のテストケース粒度）

`apps/backend/` 配下に追加するテストで以下を緑にする。

- [ ] **A1**: `POST /assets/init { filename: "x.fbx", contentType: "application/octet-stream", sizeBytes }` で `201 { assetId, uploadUrl, expiresAt }` が返り、`assets` 表に `pending` 状態の行が作成される
- [ ] **A2**: `POST /assets/init` で画像（`image/png` / `image/jpeg` / `image/webp`）も受理し、`storageKey` の拡張子が `contentType` から決まる（`.png` 等）
- [ ] **A3**: `POST /assets/init` で許可外 MIME（`text/plain` / 不明なもの）を送ると `415` が返る
- [ ] **A4**: `POST /assets/init` で `sizeBytes` が **50MB を超える**指定だと `413` が返る（事前拒否。バイトは送られない）
- [ ] **A5**: 返ってきた `uploadUrl` に PUT すると Supabase Storage 上に object が作られ、`${SUPABASE_URL}/storage/v1/object/public/${storageKey}` で取得可能になる（統合テスト）
- [ ] **A6**: 存在しない `assetId` を `POST /presentations` の `content.elements[].assetId` に指定すると `400`（参照整合性）が返る
- [ ] **A7**: 不正な `storageKey`（`..` / 絶対パス / 想定外文字種）を持つレコードを意図的に挿入したケースで、URL 生成が**ガードで弾かれる**（多層防御テスト）
- [ ] **P1**: `POST /presentations { title, thumbnailAssetId?, slide: { content: { elements: [...] } } }` で `201 { id }` が返り、DB に slide 1 件（`content` jsonb）と `presentations.thumbnailAssetId` が保存される
- [ ] **P2**: `POST /presentations` で `content.elements[].assetId` が `assets` 表に存在しない id を含むと `400` が返る（書き込み時の参照確認）
- [ ] **P3**: `POST /presentations` で存在しない `thumbnailAssetId` を送ると `400`（FK 違反）が返る
- [ ] **P4**: `PUT /presentations/:id` で `content` を送ると、jsonb 全体が**まるごと差し替わり**、`updatedAt` が現在時刻に進む（部分パッチではない）
- [ ] **P5**: `PUT /presentations/:id` で `SlideContentSchema` を満たさない `content`（例: `elements[0].transform.position.x` が文字列、`type` が不明な値、`text` 要素に `assetId` が混入）を送ると `400` が返り、既存値は変更されない
- [ ] **P6**: `GET /presentations/:id` で 1 件取得できる。`packages/contracts` の `PresentationSchema` で parse 通り、`thumbnailUrl` が含まれる（未設定なら `null`）
- [ ] **P7**: `GET /presentations` でタイトル一覧が `created_at desc` で返り、各要素に `thumbnailUrl` が含まれる（未設定なら `null`）
- [ ] **P8**: 紐づくサムネのアセットを削除すると `presentations.thumbnailAssetId` が `NULL` に落ち（`ON DELETE SET NULL`）、`content` は変更されない
- [ ] **T1**: `PUT /presentations/:id` で `thumbnailAssetId` を別アセットに差し替えると `updatedAt` が進み、次の GET で新しい `thumbnailUrl` が返る
- [ ] **T2**: `PUT /presentations/:id` で `thumbnailAssetId: null` を送ると、サムネ未設定状態に戻る（元のアセット自体は削除しない）
- [ ] **E1**: `content.elements` に `text` / `model` / `image` を 1 つずつ含む slide を保存・取得できる（discriminated union の往復）
- [ ] **E2**: `content.elements` に未知の `type`（例: `video`）を含む body を送ると `400` が返る
- [ ] **E3**: `content.elements` 内の要素順序がそのまま保存され、`GET` で同じ順序で返る（配列順序の意味性）
- [ ] **M1**: `GET /presentations/:id/manifest` で `ManifestSchema` を満たすレスポンスが返り、`slides[].elements` 配列が `text` / `model` / `image` を含み、各 `model` / `image` 要素は `assetId` ではなく**解決済みの `asset: { url, mimeType, sizeBytes, filename }` オブジェクト**を持つ
- [ ] **M2**: スライドに `text` 要素しかない場合でも `200` で `elements: [{type:'text',...}]` を返す（要素 0 件も 200）
- [ ] **H1**: 既存の `GET /health` が壊れていない（リグレッション）
- [ ] **C1**: CORS preflight (`OPTIONS`) で `Access-Control-Allow-Origin` が `localhost:5173` に対して返る
- [ ] **C2**: 不正な Zod input は **`packages/contracts/`** 側で reject され、backend の handler に到達しない（境界テスト）

---

## 非機能要件（MVP の範囲で）

- **可用性**: 発表会の 1 PC 上で起動できれば OK。再起動耐性のための daemonize は不要
- **性能**: `.fbx` 100MB のアップロードが ローカル LAN で 10 秒以内に完了
- **整合性**: マイグレーションは Drizzle で生成 → コミット。`db:push` は dev のみ
- **観測性**: 既存 pino で十分。リクエスト ID は MVP では不要
- **セキュリティ**: 認証なし。`storageKey` は入口で正規表現バリデーション、Supabase SDK 呼び出し直前にも再検証（多層防御）。service role key は Worker env のみが保持し、WebApp / MR には絶対に渡さない（ADR-0002）

---

## 実装ステップ（縦スライス・TDD 順）

依存関係に沿った最短経路。各ステップで Red → Green → Refactor の足跡を残す。

1. **B0 / contracts 拡張**
   - `packages/contracts/src/api/{assets,presentations,manifest}.ts` を追加
   - `packages/contracts/src/db/schema.ts` に `assets` / `slides` を追加
   - 各 Zod schema の境界テストを書く（Red → Green）
2. **B1 / DB マイグレーション**
   - `pnpm --filter ./apps/backend db:generate` でマイグレーション SQL を生成しコミット
   - ローカルで `db-migrate` 適用が通ることをログで確認
3. **B2 / アセット API**（A1〜A7）
   - `POST /assets/init` で許可 MIME / `sizeBytes` を検証 → `assets` 行を pending で作成 → Supabase `createSignedUploadUrl` を呼んで `{ assetId, uploadUrl, expiresAt }` を返す
   - WebApp が `uploadUrl` に直接 PUT（Backend は介在しない）
4. **B3 / プレゼン API**（P1〜P8 / T1〜T2 / E1〜E3）
   - `POST /presentations` / `PUT /:id` / `GET /:id` / `GET /`
   - `content.elements[]` の discriminated union バリデーション + `assetId` の参照確認（同一トランザクション）
5. **B4 / マニフェスト**（M1, M2）
   - `GET /presentations/:id/manifest` で `slides.content` と `assets` を join し、`elements[].assetId` を解決済み `asset` オブジェクトに展開
6. **B5 / CORS + 共通エラー**（C1, C2）
   - `hono/cors` 配置と環境変数化
   - 共通エラーハンドラの整備
7. **B6 / OpenAPI 反映確認**
   - `/docs` (Scalar) で全エンドポイントが見える
   - WebApp / MR 側がここを見て統合できる状態

完了後、WebApp 担当（同一人物）に切り替えてアップロード UI を組み、MR 担当（和貴）と疎通会を実施（MVP.md の W1 末タスク）。

---

## Follow-ups

- [ ] テスト基盤（Vitest 設定 / `@cloudflare/vitest-pool-workers`）を `apps/backend/` に追加
- [ ] CI で backend テストを走らせる（既存ワークフローの matrix 拡張）
- [ ] Supabase バケット `assets` の **CORS 設定**にローカル dev / 本番のオリジンを登録
- [ ] **pending 行の GC**: `assets` 表の `pending` 状態のまま N 日経過したレコードを掃除する週次ジョブ（Cloudflare Cron Triggers で実装）
- [ ] Phase α: マルチスライド対応（schema 既に対応済み、UI と manifest だけ調整）
- [ ] Phase α: `DELETE /assets` を出すタイミングで、`content.elements[].assetId` の dangling 整合性をどう守るか決定する（候補: (a) `assets.deletedAt` 論理削除 / (b) `slide_assets` join table 同期。advisor 推奨は (a)）
- [ ] Phase α: 要素タイプ追加（`video` / `audio` / 注釈など）— Zod の `discriminatedUnion` に branch を追加するだけで対応可
- [ ] Phase α: `/assets/:id/finalize`（HEAD 検証）を追加してアップロード完了確認の確実性を上げる
- [ ] Phase β: R2 への乗せ替え時、`storage` 層のインタフェース（`createSignedUploadUrl` / `getPublicUrl`）を抽象化する余地を残す
