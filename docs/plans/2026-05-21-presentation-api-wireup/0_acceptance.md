# 0_acceptance — 受入条件

## 機能面
1. `apps/web` を起動して `/editor/:presentationId` (もしくは同等のルート) を開くと、backend から該当 presentation を取得して編集 UI が表示される。
2. presentation が無い場合 (初回・指定 ID が無効) は新規作成フローが動き、作成後にそのまま編集できる。
3. SlideEditorPage 上でスライドを編集し、保存アクションで `PUT /presentations/:id` が呼ばれて backend が更新される。再リロードしても直前の編集状態が復元される。
4. image / model 要素は `assetId` 経由で backend が返す src URL を表示できる (asset 自体のアップロード UI 実装は本作業では不要、固定アセットでの結線確認まで)。
5. 既存の Undo/Redo・要素の追加削除・スライド並び替えなど slide-editor の主要操作が、新スキーマ下でも回帰なく動作する。

## 非機能面
1. `pnpm -C apps/web typecheck` (もしくは同等のスクリプト) と `pnpm -C apps/backend typecheck` が緑。
2. `pnpm -C apps/web test` と `pnpm -C apps/backend test` および contracts のテストが緑。
3. backend `vp run build` (wrangler dry-run) が成功する。
4. contracts は **後方互換性を持たない破壊的変更**になるため、影響を受ける全パッケージで型エラーが残らないこと。
5. 新 schema 変更によって drizzle migration が必要になった場合は `apps/backend/drizzle/` 配下に新規 SQL を追加する (実 DB への apply は本作業では不要)。

## 品質ガード
- contracts / backend / web の各単体テストが新スキーマで通る。
- web の slide-editor ストアテスト (`store.test.ts`) と commands テスト (`commands.test.ts`) は transform 化後もカバレッジを維持する。
- React Query hook には Red → Green のテスト (msw もしくは fetch モック) を最低 1 本付ける。

## 明示的に範囲外
- Asset アップロード UI、ファイル選択 UI、storage 連携の改修
- 認証 / 認可 / マルチユーザー
- リアルタイム同期 / Yjs / 共同編集
- presentation 一覧画面の本格 UI
- E2E (Playwright) テストの追加 (今回は単体 + integration まで)
