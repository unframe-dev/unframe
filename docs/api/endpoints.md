# Unframe Backend — エンドポイント一覧

> **注意**: この文書は旧Hono / Supabase実装の記述を含む歴史資料であり、現行APIの正本ではありません。現行契約は [`packages/contracts/openapi.yaml`](../../packages/contracts/openapi.yaml) を参照してください。

`app/server/` が提供する HTTP API の一覧。リクエスト / レスポンスの詳細スキーマは
[`packages/contracts/openapi.yaml`](../../packages/contracts/openapi.yaml) を正本とする。旧MVPの判断履歴は
[ADR-0001](../decisions/archived/0001-backend-mvp-design.md) /
[ADR-0002](../decisions/archived/0002-supabase-storage-and-db.md) を参照。

実行中ドキュメント (Scalar UI / OpenAPI) は `wrangler dev` 起動後:

- `http://localhost:8787/docs`
- `http://localhost:8787/openapi.json`

## 共通事項

- **Base URL** (例): `http://localhost:8787`
- **Content-Type**: 受理する body は `application/json`、レスポンスも `application/json; charset=UTF-8`
- **Origin**: `CORS_ORIGINS` 環境変数で許可 (デフォルト `http://localhost:5173,http://localhost:3000`)
- **時刻フィールド**: ISO 8601 / UTC (`...Z`)
- **UUID**: バージョン 4

### 共通エラー形

| code | HTTP | 用途 |
| --- | --- | --- |
| `validation_error` | 400 | Zod パース失敗、参照不整合 (`assetId` が存在しない等) |
| `not_found` | 404 | 指定 ID のリソースなし |
| `conflict` | 409 | `UNIQUE (presentation_id, order_index)` 違反など整合性エラー |
| `payload_too_large` | 413 | `sizeBytes > 50MB` |
| `unsupported_media_type` | 415 | 許可外 `contentType`、または `application/octet-stream` で末尾が `.fbx` でない |
| `internal_error` | 500 | 想定外 |

## エンドポイント

### システム

| Method | Path | 概要 |
| --- | --- | --- |
| GET | `/health` | プロセスの liveness。DB / Supabase の到達確認はしない |

### アセット (`/assets`)

| Method | Path | 概要 |
| --- | --- | --- |
| POST | `/assets/init` | アップロード前のメタ申告。許可 MIME / サイズを検証し、`assets` 表に pending 行を作って Supabase Storage の signed upload URL を発行する (バイトは Worker を経由しない) |

> Step 2 のバイト本体 PUT は Supabase Storage への直接アップロードで、Backend のエンドポイントではない。

### プレゼン (`/presentations`)

| Method | Path | 概要 |
| --- | --- | --- |
| POST | `/presentations` | タイトル + 1 スライド + 任意のサムネで新規作成。`assetId` / `thumbnailAssetId` は同一トランザクションで存在確認 |
| GET | `/presentations` | WebApp 一覧 UI 用。`created_at desc` で並び、各要素に `thumbnailUrl` を含む |
| GET | `/presentations/{id}` | WebApp の編集再開用。`thumbnailUrl` は Supabase Public URL の絶対 URL (未設定なら `null`) |
| PUT | `/presentations/{id}` | `title` / `thumbnailAssetId` / `content` を任意で更新 (`content` は全置換、部分パッチ不可)。最低 1 フィールド必須 |

### マニフェスト

| Method | Path | 概要 |
| --- | --- | --- |
| GET | `/presentations/{id}/manifest` | MR (Unity) が消費する統合ビュー。`slides.content` と `assets` を join し、`content.elements[].assetId` を解決済み `asset` (URL 付き) に展開する。サムネは含まれない |

## E2E フロー (WebApp 視点 / ADR-0001 §「2 段階アップロード」)

```
1. WebApp →  POST /assets/init                          ← 201 { assetId, uploadUrl, expiresAt, storageKey }
2. WebApp →  PUT  <uploadUrl>  (Supabase 直 / Backend 経由しない)  ← 200
3. WebApp →  POST /presentations                        ← 201 { id }
4. WebApp →  PUT  /presentations/{id}                   ← 200 (編集中の保存)
5. MR     →  GET  /presentations/{id}/manifest          ← 200
6. MR     →  GET  <asset.url>  (Supabase Public URL 直) ← 200 .fbx / image bytes
```

サムネを差し替える / 外すときは `PUT /presentations/{id}` で `thumbnailAssetId` を上書きする。
アセット本体 (`assets` 行 / Storage 内のオブジェクト) は **MVP では削除しない**
(ADR-0001 §FK ルール再定義)。
