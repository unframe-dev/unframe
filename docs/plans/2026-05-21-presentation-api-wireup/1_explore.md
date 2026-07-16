# 1_explore — apps/web ↔ apps/backend 結線の現状把握

---

## モノレポ構成

```
unframe-backend/
├── apps/
│   ├── backend/   (@unframe/backend)   Cloudflare Workers + Hono
│   ├── web/       (@unframe/web)        React + Vite
│   └── mr/        .gitkeep のみ (Unity 用プレースホルダ)
├── packages/
│   └── contracts/ (@unframe/contracts)  Zod スキーマ + Drizzle スキーマ
├── tools/
│   └── notion-sync/
├── pnpm-workspace.yaml
├── package.json   (ルート: scripts は prepare / notion:sync のみ)
├── vite.config.ts (ルート: Vite+ 設定 — staged pre-commit フックのみ)
├── tsconfig.base.json
├── justfile
└── mise.toml      (Node 22, pnpm 9.15.0, just)
```

### パッケージマネージャー / ビルドツール

- **pnpm 9.15.0** (mise 管理)
- **Vite+** (`vite-plus` / `npm:@voidzero-dev/vite-plus-core`) が `vp` コマンドで各操作を統括
- `vitest` は `npm:@voidzero-dev/vite-plus-test` の catalog エントリ (workspace 全体共有)

### スクリプト早見表

| 操作 | コマンド |
|---|---|
| 全パッケージ test | `vp test` / `just test` |
| 全パッケージ typecheck+lint+test | `vp check` / `just check` |
| contracts test | `pnpm -C packages/contracts test` (= `vp test run`) |
| backend test | `pnpm -C apps/backend test` (= `vp test run`) |
| web test | web に `test` スクリプト未定義 — `vp test` のワークスペース一括実行で拾われる想定 |
| backend build (dry-run) | `pnpm -C apps/backend build` (= `wrangler deploy --dry-run`) |
| migration 生成 | `just db-generate` = `pnpm --filter ./apps/backend db:generate` |
| migration 適用 | `just db-migrate` |

### ビルド依存順序

```
packages/contracts  (tsdown でソースのみ; exports は src 直参照)
    ↓
apps/backend        (wrangler, @unframe/contracts = workspace:*)
    ↓
apps/web            (@unframe/backend = workspace:* — AppType 型のみ参照)
```

contracts の `exports` は `"default": "./src/api/index.ts"` のようにソースを直参照しているため、**ビルド成果物は不要**。contracts → backend → web の型依存だけが存在する。

---

## contracts パッケージの現状

### ファイル一覧と責務

| ファイル | 責務 |
|---|---|
| `packages/contracts/src/api/slide-content.ts:1` | `Vec3Schema` / `TransformSchema` / `TextElementSchema` / `ModelElementSchema` / `ImageElementSchema` / `SlideElementSchema` / `SlideContentSchema` |
| `packages/contracts/src/api/presentations.ts:1` | `CreatePresentationRequestSchema` / `UpdatePresentationRequestSchema` / `PresentationSchema` / `PresentationSummarySchema` / `PresentationListResponseSchema` / `PresentationSlideSchema` |
| `packages/contracts/src/api/common.ts:1` | `ErrorCodeSchema` / `ErrorBodySchema` / `ErrorResponseSchema` |
| `packages/contracts/src/api/assets.ts:1` | `InitAssetRequestSchema` / `InitAssetResponseSchema` / `StorageKeySchema` |
| `packages/contracts/src/api/manifest.ts:1` | `ManifestElementSchema` / `ManifestSlideSchema` / `GetManifestResponseSchema` |
| `packages/contracts/src/api/health.ts` | `HealthResponseSchema` |
| `packages/contracts/src/api/index.ts:1` | 上記すべてを re-export (`@unframe/contracts/api`) |
| `packages/contracts/src/db/schema.ts:1` | `assets` / `presentations` / `slides` Drizzle テーブル定義 |
| `packages/contracts/src/db/index.ts:1` | `schema` / 各テーブルを re-export (`@unframe/contracts/db`) |

### 現在の主要スキーマ構造

**slide-content.ts (抜粋)**

```ts
// packages/contracts/src/api/slide-content.ts:3-50
Vec3Schema = { x, y, z: number }
TransformSchema = { position: Vec3, rotation: Vec3, scale: Vec3 }

TextElementSchema  = { id: uuid, type: "text",  transform, text: string }
ModelElementSchema = { id: uuid, type: "model", transform, assetId: uuid }
ImageElementSchema = { id: uuid, type: "image", transform, assetId: uuid }
SlideElementSchema = discriminatedUnion("type", [Text, Model, Image])
SlideContentSchema = { elements: SlideElement[] }
```

- **shape 要素は現在存在しない** (0_brief で追加予定)
- text 要素に `fontSize` / `fontColor` / `fontFamily` / `fontWeight` / `textAlign` がない
- image 要素に `alt` がない
- model 要素に `displayName` がない

**presentations.ts (抜粋)**

```ts
// packages/contracts/src/api/presentations.ts:4-64
CreatePresentationRequestSchema = { title, thumbnailAssetId?, slide: { content: SlideContent } }
UpdatePresentationRequestSchema = { title?, thumbnailAssetId?, content? }   // at-least-one 制約あり
PresentationSlideSchema = { id: uuid, orderIndex: int, content: SlideContent }
PresentationSchema = { id, title, thumbnailUrl, slide: PresentationSlide, createdAt, updatedAt }
```

**重要**: 現在の `PresentationSchema.slide` は **単数形** (`slide`) で 1 スライドのみ。  
0_brief の設計判断では `slides` 配列化が必要。

### db/schema.ts の主要テーブル・制約

```ts
// packages/contracts/src/db/schema.ts:15-63
assets(id PK, filename, mimeType, sizeBytes, storageKey UNIQUE, createdAt)
presentations(id PK, title, thumbnailAssetId FK→assets ON DELETE SET NULL, createdAt, updatedAt)
slides(id PK, presentationId FK→presentations ON DELETE CASCADE,
       orderIndex, content jsonb NOT NULL, createdAt, updatedAt,
       UNIQUE(presentationId, orderIndex),  -- multi-slide は既に対応済み
       CHECK(orderIndex >= 0))
```

`slides` テーブルは既に `UNIQUE(presentationId, orderIndex)` 制約を持ち、複数スライドを N 行で運用できる構造になっている。**migration は不要** (0_brief の確定済み判断と一致)。

`SlideContent` 型が `jsonb` カラムの型パラメータとして使われているため、スキーマ変更時は DB マイグレーションは不要だが既存の jsonb データとの互換性は考慮が必要。

### テストの場所と実行方法

```
packages/contracts/src/api/slide-content.test.ts    — TransformSchema / SlideElementSchema / SlideContentSchema
packages/contracts/src/api/presentations.test.ts    — Create/Update/Summary/PresentationSchema
packages/contracts/src/api/assets.test.ts           — InitAsset / StorageKey
packages/contracts/src/api/manifest.test.ts         — ManifestElement / GetManifest
```

実行: `pnpm -C packages/contracts test` (= `vp test run`)

### export 経路と consumer

| エクスポートパス | 型ファイル | consumer |
|---|---|---|
| `@unframe/contracts/api` | `src/api/index.ts` | backend (`routes/*.ts`) / web (`src/lib/api.ts`) |
| `@unframe/contracts/db` | `src/db/index.ts` | backend (`lib/db.ts`, `routes/*.ts`, `test/setup-db.ts`, `test/factories.ts`) |

### 影響範囲 (スキーマ拡張時に触る箇所)

1. `packages/contracts/src/api/slide-content.ts` — 要素型追加/変更
2. `packages/contracts/src/api/presentations.ts` — `PresentationSchema.slide` → `slides` 配列化、`CreatePresentationRequest` の `slide` → `slides` 化
3. `packages/contracts/src/api/manifest.ts` — shape 要素対応 (manifest にも shape 追加が必要な場合)
4. `packages/contracts/src/api/slide-content.test.ts` — shape / 拡張 text テスト追加
5. `packages/contracts/src/api/presentations.test.ts` — `slides` 配列テスト

---

## backend (apps/backend) の現状

### ルート定義

`apps/backend/src/app.ts:19` の `createApp()` が `OpenAPIHono` を構築し、以下の sub-app をマウント:

| サブアプリ | パス | ファイル |
|---|---|---|
| healthApp | `GET /health` | `src/routes/health.ts` |
| assetsApp | `POST /assets/init` | `src/routes/assets.ts` |
| presentationsApp | `GET /presentations`, `GET /presentations/:id`, `POST /presentations`, `PUT /presentations/:id` | `src/routes/presentations.ts` |
| manifestApp | `GET /presentations/:id/manifest` | `src/routes/manifest.ts` |

`AppType` は `apps/backend/src/index.ts:2` で re-export → web の `hc<AppType>` が参照。

**presentationsApp の現状 (`apps/backend/src/routes/presentations.ts`)**

- `POST /presentations`: 単一スライドを `slides` テーブルに `orderIndex: 0` で挿入
- `GET /presentations/:id`: `loadPresentationWithSlide()` が `slides` を `.limit(1)` で 1 件だけ取得し、`PresentationSchema.slide` (単数) として返す
- `PUT /presentations/:id`: `body.content` で `slides` テーブルの単一行を上書き
- `GET /presentations`: 一覧 (サマリーのみ)

**multi-slide 化の影響点**:

- `loadPresentationWithSlide()` — `.limit(1)` を外し全件取得
- `presentationResponse()` — `slide: {...}` を `slides: [...]` 配列に変更
- `POST /presentations` body — `slide: { content }` → `slides: [{ content }]` に変更
- `PUT /presentations/:id` body — `content` → `slides` 配列に変更
- contracts の `PresentationSchema` / `CreatePresentationRequestSchema` / `UpdatePresentationRequestSchema` の変更に連動

### DI / 環境変数

`apps/backend/src/middleware/context.ts:9` の `ContextDeps` インターフェース:

```ts
interface ContextDeps {
  dbFactory: (url: string) => DB;
  storageFactory: (env: AppEnv["Bindings"]) => Storage;
}
```

テスト時は `createApp({ deps: { dbFactory: () => db, storageFactory: () => storage } })` でオーバーライド。

`Bindings` (`apps/backend/src/lib/env.ts:3`):

| 環境変数 | 必須/任意 | デフォルト |
|---|---|---|
| `DATABASE_URL` | 必須 | — |
| `SUPABASE_URL` | 必須 (URL) | — |
| `SUPABASE_SERVICE_ROLE_KEY` | 必須 | — |
| `SUPABASE_STORAGE_BUCKET` | 任意 | `"assets"` |
| `CORS_ORIGINS` | 任意 | `"http://localhost:5173,http://localhost:3000"` |
| `SIGNED_UPLOAD_URL_TTL_SECONDS` | 任意 | `3600` |

wrangler.toml で `[vars]` に `SUPABASE_STORAGE_BUCKET`, `CORS_ORIGINS`, `SIGNED_UPLOAD_URL_TTL_SECONDS` を定義。`DATABASE_URL` / `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` はシークレット (`wrangler secret put`)。

`apps/backend/.dev.vars.example` にローカル開発用変数のひな形がある (内容は未確認だがファイルとして存在)。

### DB スキーマ・migration

- migration ディレクトリ: `apps/backend/drizzle/`
- 現在の migration: `0000_colorful_sleeper.sql` のみ (`meta/_journal.json` で確認)
- ソーススキーマ: `packages/contracts/src/db/schema.ts` (`drizzle.config.ts:14` 参照)
- 新 migration 追加: `just db-generate` → `apps/backend/drizzle/` に SQL が自動生成される
- テスト環境は `meta/_journal.json` の `entries` を順に読み込み自動適用 (`test/setup-db.ts:28-39`)

**migration が必要になるケース**: `slides.content` の jsonb 型を変えるだけなら migration 不要。新カラム追加や新テーブルが必要な場合は migration が必要。0_brief 確定判断では「migration 不要」だが、もし `Slide` に `background`/`notes` カラムを追加する場合は migration が必要になる。

### テスト構成

| ファイル | 内容 |
|---|---|
| `apps/backend/src/app.test.ts` | health / CORS / OpenAPI spec |
| `apps/backend/src/routes/presentations.test.ts` | POST/PUT/GET 各ルートの契約テスト (P1〜P8, E1〜E3, T1〜T2) |
| `apps/backend/src/routes/assets.test.ts` | POST /assets/init |
| `apps/backend/src/routes/manifest.test.ts` | GET /presentations/:id/manifest |
| `apps/backend/src/lib/storage.test.ts` | `getPublicUrl` のセキュリティガード |

**テストインフラ**:

- `test/setup-db.ts` — **PGlite** (in-memory Postgres) + Drizzle。`setupTestDb()` がマイグレーション SQL を自動適用
- `test/fake-storage.ts` — `Storage` インターフェースの fake 実装
- `test/app.ts` — `createTestApp(db, storage)` で createApp へ deps インジェクション
- `test/factories.ts` — `insertAsset()`, `textElement()`, `modelElement()`, `imageElement()` のファクトリ関数

実行: `pnpm -C apps/backend test`

### エラーハンドリング

`apps/backend/src/lib/errors.ts:15` の `ApiError` クラス + `errorResponseBody()` で統一。HTTP ステータスは `StatusByCode` マップから決定。

---

## web (apps/web) の現状

### editor ドメイン型と現在の I/O 経路

`apps/web/src/features/slide-editor/domain/presentation.ts:1` のドメイン型:

```ts
// 現在の ElementBase
interface ElementBase {
  id: string;
  type: string;
  x: number; y: number; z: number;  // ← 座標がフラット
  width: number; height: number;
  rotation: number;                   // ← 単一スカラー
}

interface TextElement extends ElementBase {
  type: "text";
  content: string;     // ← contracts では "text" フィールド名
  fontSize: number; fontColor: string; fontFamily: string;
  fontWeight: "normal"|"bold"; textAlign: "left"|"center"|"right";
}

interface ImageElement extends ElementBase {
  type: "image";
  assetId: AssetId;
  src: string;   // ← contracts には src なし (read-only, backend が補完)
  alt?: string;
}

interface ModelElement extends ElementBase {
  type: "model";
  assetId: AssetId;
  src: string;   // ← 同上
  displayName: string;
  modelRotation?: { x, y, z };  // ← 廃止予定 (0_brief)
}

interface ShapeElement extends ElementBase {
  type: "shape";   // ← contracts に存在しない → 追加必要
  shape: "rectangle"|"ellipse";
  fillColor: string; strokeColor: string; strokeWidth: number;
}
```

**contracts との主な乖離点**:

| 項目 | web (domain/presentation.ts) | contracts (slide-content.ts) |
|---|---|---|
| 座標表現 | `x, y, z, width, height, rotation` (フラット) | `transform: { position, rotation, scale }` (Vec3) |
| text フィールド名 | `content` | `text` |
| text の追加props | `fontSize` / `fontColor` / `fontFamily` / `fontWeight` / `textAlign` | なし |
| image の `src` | あり | なし |
| model の `src` | あり | なし |
| model の `displayName` | あり | なし |
| model の `modelRotation` | あり | なし |
| shape 要素 | あり | なし |
| element id 生成 | `createId("el")` — `${prefix}_${Date.now().toString(36)}${random}` | `crypto.randomUUID()` (UUID) |
| Slide 型 | `{ id, order, background, elements, notes }` | DB: `slides` テーブルに `background`/`notes` カラムなし |

`createId()` の実装は `apps/web/src/features/slide-editor/domain/presentation.ts:84-88`。UUID ではなくプレフィックス付きランダム文字列を生成しており、contracts の `z.string().uuid()` バリデーションを通過しない。

### ページとデータ I/O の現状

`apps/web/src/features/slide-editor/page.tsx:1`:

```ts
export default function SlideEditorPage() {
  useEffect(() => {
    if (!useEditorStore.getState().presentation) {
      editorActions.loadPresentation(createDemoPresentation());  // ← デモデータをロード
    }
  }, []);
  // backend への HTTP 呼び出しは一切ない
}
```

`apps/web/src/router.tsx:14-18`:

```ts
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",       // ← presentationId パラメータなし。`/editor/:presentationId` は存在しない
  component: SlideEditorPage,
});
```

### Hono RPC クライアントの現状

`apps/web/src/lib/api.ts:1-6`:

```ts
import { hc } from "hono/client";
import type { AppType } from "@unframe/backend";

const BASE_URL = import.meta.env.VITE_API_URL;
export const api = hc<AppType>(BASE_URL);
```

`api` を呼び出している箇所はコードベースにゼロ (0_brief 記載通り)。

### React Query / Router の刺さり方

- `apps/web/src/main.tsx:3-19`: `QueryClientProvider` は **すでにマウント済み**
- `apps/web/src/lib/query-client.ts:3`: `staleTime: 30_000`, `refetchOnWindowFocus: false`
- React Query hook は未実装。`usePresentationQuery` 等は存在しない
- Router は `@tanstack/react-router` v1.95。ルートは `/` のみ

### テスト構成

| ファイル | 内容 |
|---|---|
| `apps/web/src/features/slide-editor/store.test.ts` | zustand store の統合テスト (addElement / updateElement / undo / addSlide / removeSlide) |
| `apps/web/src/features/slide-editor/domain/commands.test.ts` | コマンドパターン + HistoryManager 連動 (add/remove/update element) |
| `apps/web/src/features/slide-editor/domain/history.test.ts` | HistoryManager 単体 (execute/undo/redo/capacity/clear) |

**web の `package.json` に `test` スクリプトがない**。`vp test` ワークスペース一括実行で動作する前提と推測される。テストは pure TS (DOM API 不使用)、`@testing-library` 依存なし。

### UI フレームワーク

- **shadcn/ui** (style: new-york) + **Tailwind CSS v4** (`@tailwindcss/vite`)
- エイリアス: `@/` = `src/`
- icon: `lucide-react`
- 3D: `@react-three/fiber` + `@react-three/drei` + `three`

---

## 既存規約・パターン

### 命名規則

- ファイル: `kebab-case.ts`、クラス/型: `PascalCase`、関数/変数: `camelCase`
- Zod スキーマ名: `XxxSchema` → 型: `Xxx` (`z.infer<typeof XxxSchema>`)
- DB テーブル: `snake_case` (Drizzle `casing: "snake_case"`)
- テスト ID: 英数字コード (`P1`, `E1`, `T1` など)

### 型ユーティリティ

- contracts はビルド成果物なし、ソース直参照
- `strictest` TS 設定 (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`)
- エラーは `ApiError(code, message, details?)` でラップし `errorResponseBody()` で JSON 化

### エラーハンドリング

- backend: `ApiError` / `ZodError` / `HTTPException` を `app.onError` で統一処理 (`apps/backend/src/app.ts:46`)
- contracts: `ErrorCodeSchema` ("validation_error" | "not_found" | ... ) で型付け

### gitmoji / コミット規約

- 形式: `<type>(<scope>): <日本語概要>`
- gitmoji は pre-commit hook が自動付与 (手動不要)
- scope: `web` / `backend` / `contracts` / `docs` / `repo`
- type: `feat` / `fix` / `refactor` / `test` / `docs` / `build` / `ci` / `chore` / `remove`

---

## 影響を受ける既存テスト一覧

contracts 変更時に確実に書き直し/追加が必要なテストファイル:

1. `packages/contracts/src/api/slide-content.test.ts` — shape 要素追加、text 拡張 props、id が UUID
2. `packages/contracts/src/api/presentations.test.ts` — `PresentationSchema.slide` → `slides` 配列化、`CreatePresentationRequest.slide` → `slides`

backend 変更時:

3. `apps/backend/src/routes/presentations.test.ts` — multi-slide 対応 (POST/PUT/GET)。factoriy 関数も連動

web 変更時:

4. `apps/web/src/features/slide-editor/store.test.ts` — transform 化後の `x/y/z/width/height/rotation` → `transform` 書き換え、`TextElement.content` → `text`、`createId` → UUID
5. `apps/web/src/features/slide-editor/domain/commands.test.ts` — `makeText()` ファクトリの型変更
6. `apps/web/src/features/slide-editor/domain/history.test.ts` — コマンド型依存なし、変更少

新規追加が必要:

7. React Query hook のテスト (msw または fetch モック) — ファイルはまだ存在しない

---

## 次フェーズへの引き継ぎ事項

### planner が知っておくべき制約

1. **migration は原則不要** — `slides.content` は jsonb なので型変更はコード側のみ。ただし `Slide` に `background`/`notes` カラムを DB に持たせる場合は migration が必要。現在の `slides` テーブルは `content jsonb` のみで `background`/`notes` を持っていないため、これらをどこに持つかを確定させる必要がある。
   - 選択肢A: `SlideContent` の jsonb 内に含める (`content: { elements, background, notes }`)
   - 選択肢B: `slides` テーブルに `background text` / `notes text` カラムを追加 → migration 必要

2. **Cloudflare Workers の制約** — Node.js API は限定的 (compatibility_flags: ["nodejs_compat"] で緩和済み)。`postgres-js` は `prepare: false` 必須 (Supavisor pooler 非互換)。

3. **element id の乖離** — 現在 web の `createId()` は UUID 形式でない。contracts の `z.string().uuid()` に通らないため、web 側で `crypto.randomUUID()` に統一する必要がある。既存デモデータも影響を受ける。

4. **`src` フィールドの扱い** — web の `ImageElement.src` / `ModelElement.src` は contracts にない。0_brief の決定通り「contracts では read-only、response 時に backend が補完」するため、web ドメイン型の `src` は「backend から取得した場合に設定される」フィールドとして存在させるか、あるいは contracts の response schema に `src?: string` を追加するかを planner が判断する必要がある。

5. **`router` に presentationId パラメータ未定義** — `/editor/:presentationId` ルートを新設する必要があり、TanStack Router の file-based か手動 `createRoute` かを選択する。現状は手動 `createRoute`。

6. **`PresentationSchema.slide` (単数) → `slides` (複数) の破壊的変更** — backend / web / contracts の全テストが一斉に壊れる。TDD の Red→Green サイクルで影響範囲を一箇所ずつ確認する必要がある。

7. **manifest API の shape 対応** — `apps/backend/src/routes/manifest.ts:96-107` が要素型で分岐しており、shape 要素を contracts に追加した場合 manifest も対応が必要。manifest は MR 向けのため、shape の可視化が不要なら省略可能だが型エラーになる。

### スキーマ拡張時に注意すべき相互依存

```
packages/contracts/src/api/slide-content.ts
  ↓ re-export
packages/contracts/src/api/index.ts
  ↓ import
apps/backend/src/routes/presentations.ts      (SlideContent, PresentationSchema等)
apps/backend/src/routes/manifest.ts           (SlideElement の型分岐)
apps/backend/src/lib/asset-refs.ts            (collectElementAssetIds — element.type 分岐)
apps/backend/test/factories.ts                (SlideContent["elements"][number] 型)
apps/web/src/lib/api.ts                       (AppType 経由で間接参照)
```

`collectElementAssetIds` (`apps/backend/src/lib/asset-refs.ts:11`) は `el.type === "model" || el.type === "image"` の分岐のみ。shape 追加時は変更不要だが、将来的に shape が assetId を持つ場合は修正が必要。

`factories.ts` の `textElement()` / `modelElement()` / `imageElement()` は `SlideContent["elements"][number]` 型で作られており、contracts 型変更で型エラーが出る。shape 用ファクトリ `shapeElement()` を追加する必要がある。

### contracts ↔ web のドメイン型変換層

現在、contracts 型と web ドメイン型の変換を行うモジュールは存在しない。実装時に変換層 (mapper) を設けるか、web ドメイン型を contracts と共用するかを planner が判断する必要がある。
