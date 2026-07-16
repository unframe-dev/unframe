# Impl Review (Codex) — contracts + backend

Status: completed
Branches: feat/api-wireup/contracts + feat/api-wireup/backend

## Codex output

**Findings**

1. `BLOCKER` 0_acceptance をこの 2 ブランチの合同受入条件として見ると、web 結線が未実装です。  
   [router.tsx](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/apps/web/src/router.tsx:14) は `/` しか生やしておらず、[page.tsx](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/apps/web/src/features/slide-editor/page.tsx:9) は backend 取得ではなく `createDemoPresentation()` をロードしています。さらに web 側ドメインは [presentation.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/apps/web/src/features/slide-editor/domain/presentation.ts:15) で旧 `x/y/z/width/height/rotation:number` 形式、[presentation.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/apps/web/src/features/slide-editor/domain/presentation.ts:84) で非 UUID ID を生成しています。  
   backend 契約は [slide-content.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/packages/contracts/src/api/slide-content.ts:27) 以降の UUID + `transform` 形式なので、現状の web は GET/create/save/reload/src 表示の受入条件を満たせません。PUT に流しても要素 ID と element shape が弾かれます。

2. `MUST` `slides` の write 契約が確定スキーマとズレています。  
   handover の request は `slides: { orderIndex, content }[]` ですが、[presentations.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/packages/contracts/src/api/presentations.ts:8) の `SlidePayloadSchema` は `content` しか受けません。backend も [presentations.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/apps/backend/src/routes/presentations.ts:243) と [presentations.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/apps/backend/src/routes/presentations.ts:291) で配列順から `orderIndex: i` を再採番しています。  
   テストも [presentations.test.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/apps/backend/src/routes/presentations.test.ts:70) で `orderIndex` を送らずにその挙動を固定しています。確定判断に従うなら `orderIndex` を request schema に入れて扱いを定義してください。配列順を正とする設計に変えるなら handover 側を更新しないと、web 実装者が別契約を見て実装します。

3. `MUST` web 側の品質ガードが受入条件を満たしていません。  
   [apps/web/package.json](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/apps/web/package.json:7) には `test` script がありません。受入条件の `pnpm -C apps/web test` はこの状態では成立しません。  
   また React Query は provider だけ存在し、実際の presentation 取得 hook はこの状態では見当たりません。`SlideEditorPage` は前述の通り demo load のままなので、要求された React Query hook の Red → Green テストもありません。backend/contracts のテスト追加だけでは acceptance の品質ガードを閉じられていません。

4. `NICE` `src` の read-only 境界は「拒否」ではなく「黙って捨てる」契約になっています。  
   Stored 側 schema は [slide-content.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/packages/contracts/src/api/slide-content.ts:48) と [slide-content.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/packages/contracts/src/api/slide-content.ts:97) の通常 `z.object` なので unknown field を strip します。[slide-content.test.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/packages/contracts/src/api/slide-content.test.ts:220) はテスト名が `rejects` なのに実際は parse 成功を期待しています。  
   DB jsonb と request 型が Stored 側になっている分離自体はできていますが、「write 時は送らない」を API 契約で強制したいなら `.strict()` 等で reject してください。許容して strip する設計なら、仕様文とテスト名をその挙動に合わせた方がよいです。

5. `NICE` content asset 参照の整合性ポリシーが GET と manifest で割れています。  
   [asset-refs.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/apps/backend/src/lib/asset-refs.ts:19) は asset 検証を「書き込みと同一 transaction で呼ぶ前提」と書いていますが、create/update は [presentations.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/apps/backend/src/routes/presentations.ts:225) と [presentations.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/apps/backend/src/routes/presentations.ts:264) で transaction 前に検証しています。JSONB 内 assetId には FK がないので、競合や asset 削除後に dangling ref が残り得ます。  
   そのとき GET は [presentations.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/apps/backend/src/routes/presentations.ts:191) で `src` を付けず返し、manifest は [manifest.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/apps/backend/src/routes/manifest.ts:111) で internal error にします。どちらを正とするか決めてテストを置いた方がよいです。

**確認できた点**

- Stored/response 分離の主線は入っています。request は [presentations.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/packages/contracts/src/api/presentations.ts:8) で `StoredSlideContentSchema`、DB jsonb は [schema.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/packages/contracts/src/db/schema.ts:48) で `StoredSlideContent` です。
- backend の要求経路は概ね実装されています。POST default slide、PUT delete→insert transaction、GET `src` 補完、manifest shape 分岐はコードと route tests にあります。
- `slides` テーブル自体は既存 migration にあり、今回の diff だけを見る限り物理 schema 変更はありません。旧 JSONB row を残す環境があるなら backfill/reset 方針は別途明示が必要です。

**後方互換性**

backend のコミット本文には明示的な `BREAKING CHANGE` があり、contracts 側も reflog 上 `feat(contracts)!` です。破壊的変更であることを示す記述としては足ります。  
ただし backend 側コミット本文自体が「apps/web 側で別ブランチ作業中」と述べているので、0_acceptance をこの合同レビューで閉じるには web 側追従がまだ不足しています。

**Verification**

`pnpm -C packages/contracts typecheck`、`pnpm -C apps/backend typecheck`、`pnpm -C apps/web typecheck`、`pnpm -C apps/web test` は実行を試みましたが、この sandbox policy で拒否されました。静的レビュー結果です。

総評: Block