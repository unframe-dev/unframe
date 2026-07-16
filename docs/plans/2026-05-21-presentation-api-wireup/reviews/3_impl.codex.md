# Impl Review (Codex) — Round 2 — contracts + backend

Status: completed
Scope: packages/contracts + apps/backend (apps/web は別 PR)

## Codex output

**指摘**

`BLOCKER` はありません。

1. `MUST` エラー応答の引き継ぎ契約が `contracts` / backend 実装と一致していません。  
   [handover_web.md](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/docs/plans/2026-05-21-presentation-api-wireup/handover_web.md:175) はエラーを `{ code, message, details? }` と書いていますが、共有契約は [common.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/packages/contracts/src/api/common.ts:14) で `{ error: { code, message, details? } }`、backend も [errors.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/apps/backend/src/lib/errors.ts:25) でその envelope を返しています。  
   `POST` / `PUT` / `GET` の route schema も `ErrorResponseSchema` を使っているため、コード側は wrapped 形で揃っています。PR3 側が handover を正としてエラー処理を書くと 400/404 の parse がずれます。handover を直すか、エラー契約を変えるかを決めて揃えてください。

2. `NICE` asset 参照検証のトランザクション境界が、ヘルパ自身の前提と一致していません。  
   [asset-refs.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/apps/backend/src/lib/asset-refs.ts:19) は `verifyAssetsExist` を「書き込みと同一トランザクションで呼ぶ前提」としていますが、`POST` は検証後に [presentations.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/apps/backend/src/routes/presentations.ts:228) から transaction に入り、`PUT` も [presentations.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/apps/backend/src/routes/presentations.ts:269) で同じ構造です。  
   現 MVP は `DELETE /assets` を API 表面に出していないので即時の破綻確率は低いですが、`slides.content.elements[].assetId` は FK で守られていないため、将来の削除/GC と並行すると dangling 参照を保存できます。ヘルパ前提どおり `tx` 内へ寄せるか、前提コメントを緩めるべきです。

3. `NICE` 前回の `orderIndex` 契約齟齬は主線では解消していますが、handover に古い文言が残っています。  
   [handover_web.md](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/docs/plans/2026-05-21-presentation-api-wireup/handover_web.md:171) の §4.3 は「write request では送らない」で backend と一致しています。一方で [handover_web.md](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/docs/plans/2026-05-21-presentation-api-wireup/handover_web.md:199) はまだ web 側で `orderIndex` を振り直して送る趣旨に読めます。PR3 の実装者向け文書としては消しておいた方がよいです。

**再評価**

- 前回 `MUST` の handover write 契約は、§4.3 と実装で整合しています。`SlidePayloadSchema` は `content` のみを受け、backend は配列順から `0..N-1` を採番しています。  
  [presentations.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/packages/contracts/src/api/presentations.ts:8)  
  [presentations.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/apps/backend/src/routes/presentations.ts:243)

- Stored / Response 分離は機能しています。write request は `StoredSlideContentSchema`、DB jsonb 型も `StoredSlideContent`、GET response は backend が `src` を補完して `SlideContent` に展開しています。  
  [presentations.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/packages/contracts/src/api/presentations.ts:8)  
  [schema.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/packages/contracts/src/db/schema.ts:48)  
  [presentations.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/apps/backend/src/routes/presentations.ts:163)

- 前回 `NICE` の `src` strip テストは再評価上問題ありません。model / image とも「reject ではなく silently strip」としてテスト名と期待値が揃っています。  
  [slide-content.test.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/packages/contracts/src/api/slide-content.test.ts:220)

**対象範囲の判定**

- `POST /presentations`: `slides` 省略時の default slide、multi-slide 採番、asset 参照検証まで route/test があります。
- `PUT /presentations/:id`: slides 全置換、枚数増減、空配列 reject、title/thumbnail 更新経路が押さえられています。
- `GET /presentations/:id`: multi-slide order、image/model `src` 補完のテストがあります。
- manifest 拡張: `shape` schema と route 分岐、route test があります。  
  [manifest.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/packages/contracts/src/api/manifest.ts:35)  
  [manifest.ts](C:/Users/takow/Project/github.com/t4ko0522/unframe-backend/apps/backend/src/routes/manifest.ts:96)

**BREAKING CHANGE**

明示は概ね十分です。reflog 上、contracts と backend のコミット subject はそれぞれ `feat(contracts)!` / `feat(backend)!` で破壊的変更を示しており、受入文書にも後方互換なしが明記されています。

**検証**

`pnpm -C packages/contracts typecheck`、`pnpm -C apps/backend typecheck`、両パッケージの `test` は実行を試しましたが、この環境では shell policy によりコマンド実行が拒否されました。今回は静的レビュー判定です。

総評: contracts/backend の実装主線は通っていますが、handover のエラー応答契約不一致は PR3 に波及するので先に直すべきです。