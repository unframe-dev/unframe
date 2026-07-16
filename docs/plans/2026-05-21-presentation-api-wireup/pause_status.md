# 中断ステータス (2026-05-21)

apps/web 側の着手を一時保留した時点のメモ。再開時はこのファイルを起点に状態を確認する。

---

## 中断理由

- route 設計 (`/editor/new` 派生 / 一覧画面 / 単独ルート + 自動作成) が未確定。
- バック側の contracts 書き換えが未コミットで進行中のため、新スキーマ依存の作業に踏み込めない。
- 上記 2 件をいったん保留してあとで再開することにした (ユーザー判断)。

---

## 中断時点で確定している事実

### apps/web (main ブランチ時点)

- `src/main.tsx` で `QueryClientProvider` は **既に配線済み**。handover_web.md §5C の「追加」記述は古い情報。
- `src/lib/query-client.ts` は既に存在する。
- `src/router.tsx` は `/` index ルートのみ。`/editor/:presentationId` も `/editor/new` も未配線。
- `src/features/slide-editor/page.tsx` は `createDemoPresentation()` をマウント時にロードする旧経路のまま。
- `src/features/slide-editor/domain/` は旧スキーマ (flat `x/y/z/width/height/rotation`, `createId("el_")` prefix, `modelRotation` フィールド) のまま。書き換えは未着手。

### apps/backend (main ブランチ時点)

- `POST /presentations` は `{ title, thumbnailAssetId?, slide: { content } }` を受け取り `{ id }` を 201 で返す。
- `PUT /presentations/:id` は **単一 slide** の partial 更新 (`title? / thumbnailAssetId? / content?`)。
- `GET /presentations/:id` は単数 `slide` を含む `Presentation` を返す。
- `GET /presentations` は `PresentationSummary[]` を返す。
- いずれも **単一スライド前提**。複数 slides 対応は contracts 書き換え後の追従課題。

### packages/contracts (main ブランチ時点・旧スキーマ)

- `TextElement` は `text` のみ (fontSize/color 等なし)。
- `ImageElement` / `ModelElement` は `assetId` のみ (alt / displayName なし)。
- `ShapeElement` は **存在しない**。
- `SlideContent` は `elements` のみ (`background` / `notes` なし)。
- `Presentation` は **単数 slide** (`slides[]` ではない)。

### バック側セッションの作業状況

- worktree: `C:\Users\takow\Project\github.com\t4ko0522\unframe-backend`
- ブランチ: `feat/api-wireup/contracts` (HEAD: `3ee4f01` — Phase 0 成果物のみ)
- uncommitted: `packages/contracts/src/api/slide-content.ts` を編集中
- untracked: `docs/plans/2026-05-21-presentation-api-wireup/1_explore.md`
- origin への push はまだなし

### worktree

- web 側 worktree (`unframe-web`) は **未作成**。

---

## 再開時のチェックリスト

1. バック側 worktree (`../unframe-backend`) の最新コミットと差分を確認。`feat/api-wireup/contracts` が push 済みか、新スキーマが固まったかを見る。
2. handover_web.md §3 (確定済の設計判断) と、実際の `packages/contracts/src/api/slide-content.ts` / `presentations.ts` の最新を突き合わせる。乖離があればバック側にエスカレーション。
3. 新規プレゼンテーション導線の route 設計を確定する。候補:
   - **A. `/editor/new` で即時作成 → `/editor/:id` へ replace** (推奨。最小実装で acceptance #2 を満たす)
   - **B. `/` index で一覧 + 新規作成ボタン** (acceptance §「明示的に範囲外」に一覧 UI とあるため範囲外寄り)
   - **C. `/editor/:id` 単独 + マウント時自動作成** (URL に id がない場合の挙動が曖昧になりやすい)
4. contracts が確定したら worktree B を作成して着手:
   ```powershell
   git fetch
   git worktree add C:\Users\takow\Project\github.com\t4ko0522\unframe-web -b feat/api-wireup/web feat/api-wireup/contracts
   cd C:\Users\takow\Project\github.com\t4ko0522\unframe-web
   pnpm install
   ```
5. 着手順は handover_web.md §5 (A → B → C → D) に従う。

---

## 中断中に進めてもよい (非依存) 作業

- handover_web.md §3 の確定判断と最新 contracts のレビュー (Read のみ)。
- route 設計案 (A/B/C) に対するユーザー合意取り。
- `el_*` / `slide_*` prefix の埋め込み箇所を grep で洗い出して書き換え対象を見積もる。

---

## 中断中に **進めない** 作業

- domain (`presentation.ts` / `commands.ts` / `demo.ts`) のスキーマ書き換え。
- `store.ts` の mutator 変更。
- `api/` 配下の React Query hook 新規作成 (型が確定していないため)。
- worktree B の作成 (contracts 確定前に作っても rebase コストだけ増える)。

---

## 調査結果 (2026-05-21 追記)

中断後、進められる非依存タスクを実施した結果。

### バック側の contracts 進捗 (uncommitted)

`../unframe-backend/packages/contracts/src/api/slide-content.ts` を確認した時点で、**ほぼ書き換え完了**。

- `TransformSchema` (position / rotation / scale = Vec3) 完成
- `TextElementSchema` に `fontSize` / `fontColor` / `fontFamily` / `fontWeight` / `textAlign` 追加完了
- `ImageElementSchema` に `alt` 追加完了
- `ModelElementSchema` に `displayName` 追加完了
- `ShapeElementSchema` 新規追加完了
- `SlideContentSchema` に `background` / `notes` 追加完了

ただし `presentations.ts` (単数 `slide` → 複数 `slides[]` 化) は **まだ未着手**。

### handover_web.md §4.1 と実装の乖離

handover §4.1 では `ImageElement` / `ModelElement` 単一型に `src?: string` を持たせる形だったが、実装は **Stored / Response 分離** で表現している:

```ts
// write/DB 用 (src なし)
StoredImageElementSchema = z.object({ id, type:"image", transform, assetId, alt? })
StoredModelElementSchema = z.object({ id, type:"model", transform, assetId, displayName })
StoredSlideElementSchema = discriminatedUnion(...Stored...)

// response 用 (src? を含む)
ImageElementSchema = StoredImage + { src?: z.string().url().optional() }
ModelElementSchema = StoredModel + { src?: ... }
SlideElementSchema = discriminatedUnion(...response 系...)
```

つまり「`src` は backend がレスポンス時にしか付与しない」が **型レベルで強制**される設計。
web 側 mapper は **read 時に `SlideElementSchema` を入力に受け、write 時に `StoredSlideElementSchema` を送る** 形で書くべき。handover §6 #3 の「`omit("src")` ヘルパ」は不要 (Stored 型を直接使えばよい)。

### バック側 1_explore.md の重要な追加情報

`../unframe-backend/docs/plans/2026-05-21-presentation-api-wireup/1_explore.md` (untracked) を読んで判明:

1. **manifest API も shape 対応必要** — `apps/backend/src/routes/manifest.ts:96-107` が要素型で分岐しており、`shape` 追加で型エラー。
2. **factories.ts に `shapeElement()` 追加必要** — backend テストファクトリ (`apps/backend/test/factories.ts`)。
3. **`collectElementAssetIds`** — `el.type === "model" || el.type === "image"` の分岐のみ。shape 追加でも変更不要。
4. **`Slide.background/notes` の保存場所** — contracts は jsonb 内 (option A) を採用済み。`slides` テーブルへのカラム追加 (option B) ではないので **migration 不要**。

### apps/web 側の prefix 埋め込み

`el_` / `slide_` 文字列リテラル埋め込みの grep 結果は **1 件のみ**:

```
apps/web/src/features/slide-editor/domain/commands.test.ts:13:    id: "slide_1",
```

UUID への置換コストはほぼゼロ。fixture 由来でテストロジックに本質的依存はない (機械置換で OK)。

### 依存関係 / インフラ

- `@tanstack/react-query` は `apps/web/package.json` で **prod deps** に既登録 (`^5.62.0`)。問題なし。
- `query-client.ts` は `staleTime: 30_000`, `refetchOnWindowFocus: false` で配線済み。手を加える必要なし。
- `apps/web/package.json` に `test` スクリプトなし → 全体は `vp test` で拾われる前提 (要 ws-level 実行)。

### 再開時のアクションへの示唆

- contracts 確定後の web 側 mapper は **`StoredSlideElementSchema` を web ドメインから直接生成** する形が最薄になる。handover §6 #3 の「omit ヘルパ」は不要と判断できる。
- `commands.test.ts:13` の `"slide_1"` は UUID リテラルに置換するだけで対応可能。
- バック側は `presentations.ts` の単数 → 複数 slides 化が残作業。これが終わるまで web の API hook 着手はやはり待ち。

---

## バック側 worktree 完了確認 (2026-05-21 後追い)

`../unframe-backend` worktree で contracts / backend の書き換えが完了 (origin 未 push、local commit のみ)。

### ブランチ位置

- `feat/api-wireup/contracts` HEAD = `12c550f` (PR1 相当)
- `feat/api-wireup/backend` HEAD = `7592efe` (PR2 相当、contracts の上に積まれている)

### 取り込まれたコミット

| SHA       | 種類             | 内容                                                                                                                                                                                            |
| --------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2fe2a17` | docs             | `1_explore.md` (464 行) と `handover_web.md` (249 行) を Phase 0/1 成果物として追加                                                                                                             |
| `12c550f` | feat(contracts)! | SlideContent を transform / multi-slide / shape 対応に再設計。`Presentation.slide` (単数) → `slides` (min 1 配列)、Stored/Response 二系統で `src` を read-only 型強制、manifest にも shape 対応 |
| `7592efe` | feat(backend)!   | multi-slide 化、PUT は全置換 (delete→insert in transaction)、`expandSlidesForResponse` で `src` 補完、shape 対応、factories 拡張                                                                |

### テスト / 型チェック (`unframe-backend` で実行)

| 対象                                           | 結果                     |
| ---------------------------------------------- | ------------------------ |
| `pnpm -C packages/contracts test`              | 4 ファイル / 71 tests 緑 |
| `pnpm -C apps/backend test`                    | 5 ファイル / 45 tests 緑 |
| `pnpm -C apps/backend typecheck`               | 緑                       |
| `pnpm -C packages/contracts exec tsc --noEmit` | 緑                       |

### 仕様の確定点 (handover との差異を含む)

- `POST /presentations` の body は **`slides` 省略時にサーバが空 1 枚 (orderIndex=0) を自動生成**。
- `PUT /presentations/:id` の `slides` は **全置換セマンティクス** (delete → insert を transaction で実行)。
- `GET /presentations/:id` は **全スライドを orderIndex 昇順で返却**。
- response 側は `expandSlidesForResponse` が `assets.storageKey` から `storage.getPublicUrl()` で `src` を補完。
- contracts は **Stored / Response 二系統** に分離 (`StoredSlideElementSchema` が write/DB 用、`SlideElementSchema` が response 用)。
- handover_web.md §4.1 は `src?: string` 単一型表現だったが、実装は型レベルで Stored/Response を別物扱いにする **より強い形**。

### 残課題 (バック側)

- `reviews/3_impl.codex.md` は本文ゼロ (Codex CLI 不在 or 未実行)。Codex 二票化は欠落しているが、Opus レビューが回っていれば許容範囲。
- origin への push (PR 作成準備)。

### web 側に伝える影響

- web の mapper は `StoredSlideElementSchema` を web ドメインから直接生成する形が最薄。`omit("src")` ヘルパは不要。
- PUT は **slides 全置換**。store の slides をそのまま全件送る形でよい。
- POST は **`slides` 省略 → 空 1 枚** という挙動なので、`/editor/new` で `POST /presentations` を `{ title }` のみで投げ、返ってきた `id` で navigate するだけで初期化が完結する。

---

## 中断中に実施した実コード変更 (2026-05-21)

### `apps/web/package.json` に `test` スクリプト追加

- 現状: `pnpm -C apps/web test` が `Missing script: "test"` で落ちる状態だった (1_explore §「web の `package.json` に `test` スクリプトがない」と整合)。
- 対応: backend と同じく `"test": "vp test run"` を追加。
- 検証: `pnpm -C apps/web test` を実行し、3 ファイル / 13 テストすべて緑を確認。
- 影響: handover §7 DoD の `pnpm -C apps/web test` 緑要件を満たす素地ができた。スキーマ書き換え後にこのコマンドで Red → Green の確認ができる。
- 他に手を付けなかった理由: `createId()` の UUID 化など他の独立タスクは demo.ts 等の呼び出し側書き換えと不可分なため、スキーマ書き換えと同時にやる方が衝突しない。
