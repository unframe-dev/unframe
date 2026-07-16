# Frontend (apps/web) 引き継ぎ書

backend + `packages/contracts/` は別セッション (このリポの main worktree → `../unframe-backend` worktree で作業) が担当する。
このドキュメントだけ読めば apps/web 側を着手できるよう、必要情報を全部ここに集約してある。

---

## 1. 役割分担

| 担当 | スコープ |
|---|---|
| **別セッション (バック側)** | `packages/contracts/` のスキーマ書き直し + `apps/backend/` のルート/テスト/migration |
| **このセッション (あなた)** | `apps/web/` の domain 書き直し + React Query 結線 + page/router 配線 |

`packages/contracts/` は両者から参照される共有パッケージ。**スキーマ確定はバック側が先に PR1 を出して固める。** あなたはそのコミットをベースに作業する。

---

## 2. ブランチ / worktree 運用

```
main
 └─ feat/api-wireup/contracts  ← バック側がここで contracts を書く (PR1)
     ├─ feat/api-wireup/backend ← バック側が backend を書く (PR2, base=PR1)
     └─ feat/api-wireup/web     ← あなたがここで web を書く (PR3, base=PR1)
```

### 推奨手順 (あなた側)

```powershell
# 1. worktree B を作成 (まだ存在しない)
cd C:\Users\takow\Project\github.com\t4ko0522\unframe
git fetch
# contracts ブランチが push されたら origin から、まだなら local ref から:
git worktree add C:\Users\takow\Project\github.com\t4ko0522\unframe-web -b feat/api-wireup/web feat/api-wireup/contracts

# 2. worktree B に入って作業
cd C:\Users\takow\Project\github.com\t4ko0522\unframe-web
pnpm install
```

PR3 は GitHub 上で base ブランチを `feat/api-wireup/contracts` に指定する **stack PR**。
PR1 が main にマージされたら、PR3 の base を main に変更すれば自動 rebase される。

### 同期ポイント

- バック側が `feat/api-wireup/contracts` の最終コミットを push したら、
  あなたは `git fetch && git rebase origin/feat/api-wireup/contracts` で取り込む。
- contracts が確定する前は **新 schema 非依存の作業 (router / QueryClientProvider 配線)** だけ進めるのが安全。
- contracts 確定後の SHA はバック側が `docs/plans/2026-05-21-presentation-api-wireup/3_contract.md` に書く想定。

---

## 3. 確定済の設計判断 (動かない前提)

| 項目 | 決定 |
|---|---|
| element id | `crypto.randomUUID()` (UUID 統一) |
| 複数スライド DB 表現 | `slides` テーブルを N 行で運用 (orderIndex で並び順) |
| 要素の座標表現 | `transform: { position: Vec3, rotation: Vec3, scale: Vec3 }` |
| scale の意味 | **base = 1**。`scale.x` = width(px), `scale.y` = height(px), `scale.z` = 厚み (当面 1) |
| rotation | Vec3。web の単一回転は `rotation.z` に。model の 3D 回転も同じ rotation に統合し `modelRotation` フィールドは廃止 |
| 要素種別 | text / model / image / **shape** |
| text プロパティ | `text`, `fontSize`, `fontColor`, `fontFamily`, `fontWeight`, `textAlign` |
| image プロパティ | `assetId` (必須), `alt?` |
| model プロパティ | `assetId` (必須), `displayName` |
| shape プロパティ | `shape: "rectangle" \| "ellipse"`, `fillColor`, `strokeColor`, `strokeWidth` |
| src の扱い | contracts では read-only。response 時に backend が `storage.getPublicUrl()` で補完。write は assetId のみ |
| Slide メタ | `background` / `notes` を Slide 単位で保持 |

---

## 4. バック側が公開する API 形 (確定スキーマ)

contracts ブランチが固まると、以下の型が `@unframe/contracts/api` から export される予定。
**この型と完全一致**するように web 側 domain を書き直すこと (mapper は最薄、ほぼ identity を狙う)。

### 4.1 Vec3 / Transform / SlideElement

> **重要 (実装確定時の改訂)**: `image` / `model` の `src?` は、当初の単一型 (`ImageElement` に `src?` を直付け) ではなく、**Stored (write/DB) と Response (read) の二系統スキーマ**で表現することに確定した。`src` は backend が response 組み立て時に `storage.getPublicUrl()` で補完する read-only フィールドで、**型レベルで** write 経路に漏れない作りになっている。web 側は read で `SlideElement` / `SlideContent` を受け、write で `StoredSlideElement` / `StoredSlideContent` を送る。`omit("src")` ヘルパは不要 (Stored 型を直接組み立てればよい)。

```ts
// packages/contracts/src/api/slide-content.ts (確定スキーマ)
type Vec3 = { x: number; y: number; z: number };
type Transform = { position: Vec3; rotation: Vec3; scale: Vec3 };

type TextElement = {
  id: string;                // uuid
  type: "text";
  transform: Transform;
  text: string;
  fontSize: number;          // positive
  fontColor: string;         // CSS color (min length 1)
  fontFamily: string;        // min length 1
  fontWeight: "normal" | "bold";
  textAlign: "left" | "center" | "right";
};

// --- image / model は Stored (write/DB) と Response (read) の二系統 ---
// 共通フィールドを Core として共有し、Response 系のみ read-only `src?: string` を持つ。
// この分離により「`src` は backend がレスポンスで埋める」が型で強制される。

type StoredImageElement = {
  id: string;                // uuid
  type: "image";
  transform: Transform;
  assetId: string;           // uuid
  alt?: string;
};
type ImageElement = StoredImageElement & { src?: string /* http(s) URL */ };

type StoredModelElement = {
  id: string;                // uuid
  type: "model";
  transform: Transform;
  assetId: string;           // uuid
  displayName: string;
};
type ModelElement = StoredModelElement & { src?: string /* http(s) URL */ };

type ShapeElement = {
  id: string;                // uuid
  type: "shape";
  transform: Transform;
  shape: "rectangle" | "ellipse";
  fillColor: string;         // min length 1
  strokeColor: string;       // min length 1
  strokeWidth: number;       // nonnegative
};

// --- discriminated union も二系統 ---
// 読み取り (GET /presentations/:id 等) で使う型
type SlideElement =
  | TextElement
  | ModelElement
  | ImageElement
  | ShapeElement;

// 書き込み (POST / PUT body の slides[].content.elements[]) で使う型
type StoredSlideElement =
  | TextElement
  | StoredModelElement
  | StoredImageElement
  | ShapeElement;

// --- SlideContent も同じ理由で二系統 ---
type SlideContent = {            // response 用
  elements: SlideElement[];
  background: string;            // CSS color, default "#ffffff"
  notes: string;                 // default ""
};

type StoredSlideContent = {      // write 入力 / DB jsonb 永続化形
  elements: StoredSlideElement[];
  background: string;
  notes: string;
};
```

#### web 側での使い分け早見表

| 場面 | 使う型 | 備考 |
|---|---|---|
| `GET /presentations/:id` の response パース | `Presentation` (内部に `SlideContent`) | `image` / `model` 要素は `src` 付きで返る可能性あり |
| store にロードする内部表現 | 任意 (`SlideContent` をそのまま保持 or 自前 ViewModel に詰め替え) | `src` をプレビュー描画にそのまま使える |
| `POST /presentations` の body | `StoredSlideContent` を含む `slides[]` (省略可) | `slides` を省略するとサーバが空 1 枚を自動生成 |
| `PUT /presentations/:id` の body | `slides?: { content: StoredSlideContent }[]` | 全置換セマンティクス。`src` は型レベルで送れない |
| MR 配信用 (`GET /presentations/:id/manifest`) | manifest 専用シェイプ (`asset` を埋め込んだ別形) | §4.3 とは別の最終形。web からは読まない |

### 4.2 Presentation

```ts
// packages/contracts/src/api/presentations.ts (確定スキーマ)
type PresentationSlide = {
  id: string;            // uuid
  orderIndex: number;    // 0-based
  content: SlideContent;
};

type Presentation = {
  id: string;            // uuid
  title: string;
  thumbnailUrl: string | null;
  slides: PresentationSlide[]; // 必ず 1 件以上
  createdAt: string;     // ISO 8601 with offset
  updatedAt: string;
};

type PresentationSummary = {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
};
```

### 4.3 リクエスト/レスポンス

| Method | Path | Request | Response |
|---|---|---|---|
| `GET` | `/presentations` | – | `{ presentations: PresentationSummary[] }` |
| `GET` | `/presentations/:id` | – | `Presentation` |
| `POST` | `/presentations` | `{ title, thumbnailAssetId?, slides?: { content: StoredSlideContent }[] }` (slides 省略時はサーバが空の 1 枚を自動生成) | `{ id: string }` (201) |
| `PUT` | `/presentations/:id` | `{ title?, thumbnailAssetId?, slides?: { content: StoredSlideContent }[] }` (slides を渡すと全置換) | `Presentation` (200) |

**orderIndex の扱い**: write request では `orderIndex` を送らない。**配列順がそのまま順序**として解釈され、サーバが `0..N-1` で再採番する。response (GET) は `slides[].orderIndex` 込みで返るが、PUT 時に往復させる必要はない。

**StoredSlideContent**: response 用の `SlideContent` から image/model の read-only `src` を抜いたもの。`@unframe/contracts/api` から型 export 済み。

エラーレスポンスは **envelope 形式**で返る:

```ts
type ErrorResponse = {
  error: {
    code: "validation_error" | "not_found" | "internal_error";
    message: string;
    details?: unknown;
  };
};
```

スキーマは `@unframe/contracts/api` の `ErrorResponseSchema`、HTTP ステータスは backend `apps/backend/src/lib/errors.ts` の `StatusByCode` に従う (validation_error → 400 / not_found → 404 / internal_error → 500)。

---

## 5. apps/web で書き換える / 新規作成するファイル

### A. domain 書き換え (必須・大物)

| 対象 | 変更内容 |
|---|---|
| `src/features/slide-editor/domain/presentation.ts` | 型を transform 構造に置換。`createId()` を `crypto.randomUUID()` に。`shape` 要素を追加。`modelRotation` を廃止し `rotation` に統合。`Slide` に `background` / `notes` を持たせる |
| `src/features/slide-editor/domain/commands.ts` | `addElement` / `removeElement` / `updateElement` / `addSlide` / `removeSlide` / `reorderSlides` が新ドメインで動くよう書き換え。`Partial<SlideElement>` の patch 型は transform を含むため discriminated union の取り回しに注意 |
| `src/features/slide-editor/domain/history.ts` | おそらく不変 (Command パターンに依存) |
| `src/features/slide-editor/domain/demo.ts` | 新スキーマのデモデータに作り直す。**本番では使わないので最小限で OK** |

### B. ストア / コンポーネント連動 (必須)

| 対象 | 変更ポイント |
|---|---|
| `src/features/slide-editor/store.ts` | mutator の patch は `transform.position` 等を idiomatic に扱う形に。`addSlide()` の初期値は `background:"#ffffff", notes:""` |
| `src/features/slide-editor/components/PlaneEditor.tsx` | 要素を `transform.position.x/y` と `transform.scale.x/y` で描画 |
| `src/features/slide-editor/components/PlaneElement.tsx` | 同上、`transform.rotation.z` で CSS transform を組む |
| `src/features/slide-editor/components/PropertyPanel.tsx` | 入力欄を transform 構造にバインド |
| `src/features/slide-editor/components/SlideListPanel.tsx` | 並び順 reorder で store の `slides` 配列順を入れ替える。PUT 時は **配列順がそのまま順序**として送られ、backend が `orderIndex` を `0..N-1` で再採番する (web 側で orderIndex を計算/送信する必要なし) |
| `src/features/slide-editor/components/ModelPreview3D.tsx` | `transform.rotation` (Vec3) を Three.js に渡す。modelRotation は撤廃 |

### C. API 結線 (新規)

| 対象 | 内容 |
|---|---|
| `src/lib/api.ts` | 既存。`hc<AppType>(BASE_URL)` のまま、AppType の export は backend 側に依存。**変更なし**で OK のはず |
| `src/main.tsx` | `QueryClientProvider` で `queryClient` を渡すよう **追加** |
| `src/router.tsx` | `/editor/:presentationId` および新規プレゼンテーション作成用の `/editor/new` (もしくは index で list) を追加 |
| `src/features/slide-editor/api/usePresentationQuery.ts` (新規) | `useQuery({ queryKey: ["presentation", id], queryFn: () => api.presentations[":id"].$get(...) })` |
| `src/features/slide-editor/api/useSavePresentationMutation.ts` (新規) | `useMutation` で `PUT /presentations/:id`。slides 全置換で送る |
| `src/features/slide-editor/api/useCreatePresentationMutation.ts` (新規) | `useMutation` で `POST /presentations`。成功後 `navigate(/editor/:id)` |
| `src/features/slide-editor/page.tsx` | `useParams()` で id を受け、`usePresentationQuery` で fetch → `editorActions.loadPresentation()`。Loading / Error 表示を入れる |

### D. テスト (必須)

| 対象 | 変更 |
|---|---|
| `src/features/slide-editor/store.test.ts` | 新ドメインで全パスを書き直し |
| `src/features/slide-editor/domain/commands.test.ts` | 同上 |
| `src/features/slide-editor/domain/history.test.ts` | おそらく不変、念のため通すこと |
| 新規: `src/features/slide-editor/api/*.test.ts` | msw もしくは fetch mock で `usePresentationQuery` / `useSavePresentationMutation` を Red → Green で確認 |

---

## 6. 注意点 / 落とし穴

1. **scale = 絶対 px**: scale.x / scale.y は base=1 前提の絶対寸法。1 倍ではなく **400 とか 800 とか直接入る**。proportional scaling (drag で aspect 比固定) を実装するときは scale.x / scale.y を独立に持つ意味を忘れない。
2. **rotation は Vec3 だが UI は z だけ操作**: 平面エディタは `rotation.z` のスライダー、3D モデルだけ x/y/z 全部触れる UI にする (PropertyPanel の中で要素タイプで切替)。
3. **src は draft 状態にのみ存在**: backend からは src 付きで返るが、書き込むときは送らない。`useSavePresentationMutation` の中で `omit("src")` するヘルパを作って徹底する。
4. **slides は全置換**: PUT で `slides` を渡すと配列丸ごと置換になる予定。差分パッチではない。web 側は store の slides を毎回そのまま PUT で送る。
5. **元の `Presentation` から削れる項目**: `proto` の `useEditorStore` には無い `createdAt` / `updatedAt` が backend response に乗ってくる。store では保持しなくて良いが、`useSavePresentationMutation` 後の invalidate のために query を再取得することで自然に取れる。
6. **`createId()` 廃止に伴い prefix が消える**: `el_xxx` / `slide_xxx` といった prefix 付き id は **デバッグログ / テストの fixture に文字列リテラルとして埋め込まれている可能性**がある。`grep -rn 'el_'` / `grep -rn 'slide_'` で当たりを取って機械的に置換するか、test 側を UUID 前提に書き直す。
7. **QueryClientProvider の二重ラップ禁止**: `src/main.tsx` で 1 回だけ。Router の子に置く方が無難。
8. **CORS**: backend の `wrangler.toml` の `CORS_ORIGINS` に `http://localhost:5173` (Vite dev) が入っていることを確認。入っていなければバック側に依頼。

---

## 7. 完了条件 (PR3 の DoD)

- [ ] `pnpm -C apps/web typecheck` 緑
- [ ] `pnpm -C apps/web test` 緑 (store / commands / history / api hooks)
- [ ] Vite dev server (`pnpm -C apps/web dev`) で `/editor/new` から新規作成 → `/editor/:id` で再ロード → スライド編集 → 保存 → リロードで復元できる
- [ ] Undo / Redo / 要素追加削除 / スライド並び替えがレグレッションなく動く
- [ ] PR3 の base が `feat/api-wireup/contracts` (or rebase 後 main)
- [ ] gitmoji 規約に従って commit (`feat(web): ✨ ...` 等)

---

## 8. 連絡 / 同期

- バック側が contracts の確定スキーマを push したらこの handover の §4 と齟齬がないか念のため diff を取る。
- バック側 API の挙動が §4 と違ったらバック側にエスカレーション (silent な実装変更は NG)。
- 困ったらバック側セッションの作業ディレクトリ `C:\Users\takow\Project\github.com\t4ko0522\unframe-backend` を覗けば最新の `packages/contracts/src/api/*.ts` が見える。
