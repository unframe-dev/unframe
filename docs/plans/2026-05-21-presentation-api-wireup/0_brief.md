# 0_brief — apps/web ↔ apps/backend のリクエスト経路実装

## 背景
- `apps/web` には Hono RPC クライアント (`src/lib/api.ts`) が定義されているが、コードベース内で `api.` を呼び出している箇所はゼロ。
- 編集状態は `features/slide-editor/store.ts` の zustand ストアに閉じており、サーバ I/O は存在しない。
- `apps/backend` は Cloudflare Workers + Supabase 構成で `/assets`, `/presentations`, `/manifests` の REST API が一通り実装済み。
- contracts (`@unframe/contracts`) と web editor のドメインモデル間にスキーマ乖離があり、そのままでは型が通らない。

## ゴール
SlideEditorPage が **デモデータではなく backend からプレゼンテーションを取得し、編集結果を backend に保存できる**状態にする。
そのために contracts スキーマを web の編集機能と整合する形へ拡張し、backend と web の両側を新スキーマに揃える。

## 確定済の設計判断 (Phase 2 で planner に渡す前提)

| 項目 | 決定 |
|---|---|
| element id | `crypto.randomUUID()` (UUID 統一) |
| 複数スライド DB 表現 | `slides` テーブルを N 行で運用 (migration 不要、既存 schema の `unique(presentationId, orderIndex)` を活用) |
| 要素の座標表現 | `transform: { position: Vec3, rotation: Vec3, scale: Vec3 }` |
| scale の意味 | base = 1。`scale.x` = width, `scale.y` = height, `scale.z` = 厚み (当面 1) |
| rotation | Vec3。web の単一回転は `rotation.z` へ。model の 3D 回転は `rotation` に統合し `modelRotation` フィールドは廃止 |
| 要素種別 | text / model / image / **shape を新規追加** |
| text プロパティ | `text`, `fontSize`, `fontColor`, `fontFamily`, `fontWeight`, `textAlign` |
| image プロパティ | `assetId` (必須), `alt?` |
| model プロパティ | `assetId` (必須), `displayName` |
| shape プロパティ | `shape: "rectangle" \| "ellipse"`, `fillColor`, `strokeColor`, `strokeWidth` |
| src の扱い | contracts では read-only。response 時に backend が `storage.getPublicUrl()` で補完。write は assetId のみ |
| Slide メタ | `background` / `notes` を SlideContent もしくは Slide 単位で保持 |
| API 形 | `GET /presentations/:id` は全 slides を返却、`PUT /presentations/:id` は title/slides 配列を受ける |

## 影響範囲
- `packages/contracts/src/api/slide-content.ts`, `presentations.ts` の書き直し
- contracts のテスト更新
- `apps/backend/src/routes/presentations.ts` の multi-slide 化
- backend テストの更新
- `apps/web/src/features/slide-editor/domain/presentation.ts` の transform 化
- 連動して commands / store / components / demo / 既存テストを更新
- `apps/web/src/lib/api.ts` の React Query hook を実装
- `apps/web/src/main.tsx` で QueryClientProvider を配線

## 非ゴール
- Asset アップロード UI / 認証 / 共有機能 / リアルタイム同期
- Presentation 一覧画面の UI 整備
- 既存 demo データの本番投入
