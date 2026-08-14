# Web Editor POC 実装記録

> **Status: Historical.** この文書は Slide ベース POC の実装記録です。現在の Web architecture と route の正本には [`ARCHITECTURE.md`](./ARCHITECTURE.md) を使用してください。POC の互換性を今後の Group / Step / Cue Editor の制約にしません。

## 目的

`app/web` に、3Dモデルを含むプレゼンテーションを編集し、閲覧者へほぼリアルタイムに反映できるWeb Editorを構築する。

エディタ固有のドキュメント状態、通常のWebアプリケーション状態、描画中の一時状態を分離し、Undo / Redo、保存、将来のAPI接続を安全に拡張できる構成を採用する。

## スコープ

### 今回の対象

- Web Editorの技術基盤
- Web向けドキュメントモデル
- Zodによるruntime validationとversion migration
- serializableなcommandとUndo / Redo
- MUIによるEditor shell
- Three.js / React Three FiberによるGLB表示・編集
- 単一編集者から閲覧者へのほぼリアルタイムな反映
- TanStack Routerによるroot-based routing
- Vitest、Testing Library、Playwrightによるテスト基盤
- Cloudflare Workers Static AssetsによるSPA配信

### 今回の対象外

- Control Plane APIの変更
- Control Plane の D1 schema と migration の変更
- Control Plane / Realtime contract の変更
- 認証・認可
- 複数編集者による同時編集
- YjsなどのCRDT
- WebSocketまたはSSEのserver実装
- asset upload、変換、配信pipeline
- Unity側のGLB対応
- deployment workflow

API接続までは、インメモリfixtureとブラウザ内のadapterを利用する。将来のAPI変更では、本計画で定義するWebドメインモデルを入力として、Control Plane contract、D1、Unity向けprojectionを別途設計する。

## 採用技術

| 領域                  | 技術                             | 方針                                                                         |
| --------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| UI                    | React 19.2 + TypeScript          | `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`を維持する |
| Component             | Material UI v9                   | toolbar、panel、dialog、formなどEditor shellに使用する                       |
| Styling               | MUI Theme + `sx` + `styled()`    | Tailwindは導入しない                                                         |
| Development           | Vite+                            | dev、build、format、lint、testの統合を進める                                 |
| Routing               | TanStack Router                  | route paramsとsearch paramsを型安全に管理する                                |
| Server state          | TanStack Query                   | 将来のAPI取得、保存、cache、再取得に限定する                                 |
| Editor session        | Zustand                          | selection、tool、panel、snap、viewport設定を管理する                         |
| Document validation   | Zod 4                            | document schema、serializer、migration境界を検証する                         |
| Form                  | React Hook Form                  | property panelと設定画面に使用する                                           |
| Immutable update      | Immer                            | command reducerの実装に使用する                                              |
| 3D                    | Three.js + React Three Fiber     | GLBを正規3D形式として表示・編集する                                          |
| 3D helpers            | `@react-three/drei`              | controls、loader、gizmoなど必要な機能に限定して利用する                      |
| Unit / Component test | Vitest + Testing Library         | pure domain logicとReact UIを検証する                                        |
| E2E                   | Playwright                       | 実際の編集操作、Undo / Redo、閲覧同期、deep linkを検証する                   |
| Hosting               | Cloudflare Workers Static Assets | `un-fra.me/*`のLP予約外をroot-based SPAとして配信する                        |

## 依存関係の導入方針

必要な依存関係は最初にまとめて導入する。ただし、Cloudflare Vite pluginはVite+との互換性を最初に検証し、互換性を確認できない場合はpluginを外してWrangler Static Assetsへ切り替える。

### Runtime dependencies

```text
@base-ui/react
@phosphor-icons/react
tailwindcss
@tailwindcss/vite
@tanstack/react-router
@tanstack/react-query
zustand
zod
react-hook-form
@hookform/resolvers
immer
three
@react-three/fiber
@react-three/drei
```

### Development dependencies

```text
@vitejs/plugin-react
vitest
jsdom
@testing-library/react
@testing-library/user-event
@testing-library/jest-dom
@playwright/test
wrangler
@cloudflare/vite-plugin
@cloudflare/workers-types
```

## アーキテクチャ

### 状態の分離

```text
Server State
  TanStack Query
  └─ 将来のAPI取得、保存状態、asset metadata

Editor Document
  React reducer + pure command functions
  └─ presentation、slides、elements、assets、revision、history

Editor Session
  Zustand vanilla store
  └─ selection、tool、panel、snap、preview、viewport設定

Transient 3D State
  Three.js refs / React local state
  └─ drag中のtransform、hover、camera操作、gizmo

Temporary UI State
  React local state / React Hook Form
  └─ dialog、menu、未確定のform入力
```

### 状態管理の規則

- API response cacheはTanStack Queryだけが所有する。
- 資料本体はZustandの巨大なstoreへ入れない。
- Editor DocumentはReact Context配下のdocument reducerが所有する。
- ZustandにはEditor Sessionだけを保存する。
- Three.js object、camera、gizmoなどのruntime objectをdocumentへ保存しない。
- drag中のpointer moveごとにReact stateやdocument全体を更新しない。
- hoverのように局所的で短命な状態はcomponent local stateへ置く。
- form入力は確定前の値とdocumentへcommit済みの値を区別する。

## ドキュメントモデル

Web側にAPI DTOから独立したドメインモデルを定義する。

```ts
type PresentationDocument = {
  version: 1;
  id: string;
  revision: number;
  metadata: PresentationMetadata;
  slides: Slide[];
  assets: AssetReference[];
};
```

### モデル規約

- `version`はserializer formatのversionとする。
- `revision`は確定済みcommandごとに単調増加させる。
- presentationは1件以上のslideを持つ。
- elementはdiscriminated unionとして定義する。
- 3D assetの正規形式はGLBとする。
- documentにはasset IDと永続metadataだけを保存する。
- 署名URL、Object URL、loader cacheはdocumentへ保存しない。
- assetの読込URLは`AssetResolver`から取得する。
- Zod schemaからTypeScript型を推論し、型とruntime schemaの二重定義を避ける。

### 3D座標規約

- 単位はメートルとする。
- 右手座標系、Y-upを基準とする。
- 永続rotationはquaternionで保持する。
- property panelではEuler角を表示しても、command確定時にquaternionへ変換する。
- quaternionのcomponent順、forward axis、scaleの制約をschemaと文書で固定する。
- Unityとの座標変換はUnity/API対応時に境界処理として追加する。

### Schemaとmigration

```text
document/schema
├── presentation-document.ts
├── slide.ts
├── element.ts
├── asset.ts
└── transform.ts

document/migrations
├── migrate-document.ts
└── versions/
```

- 読み込み時はunknownをZodで検証する。
- 古いversionは順番にmigrationしてから最新schemaで再検証する。
- 未知のversionは暗黙に読み込まず、明示的なエラーを返す。
- serializerはruntime stateを除外したdocumentだけを出力する。
- migrationはpure functionとしてunit testする。

## CommandとUndo / Redo

commandは関数やclass instanceではなく、直列化可能なdiscriminated unionとして定義する。

```ts
type EditorCommand =
  | { type: "element.add"; slideId: string; element: Element }
  | { type: "element.remove"; slideId: string; elementId: string }
  | { type: "element.transform"; elementId: string; transform: Transform }
  | { type: "element.update"; elementId: string; changes: ElementChanges }
  | { type: "slide.reorder"; slideId: string; toIndex: number };
```

### Command適用規則

- `applyCommand(document, command)`は新しいdocumentとinverse commandを返す。
- Undoはinverse commandを適用する。
- Redoは元commandを再適用する。
- Immerはreducer内部のimmutable updateに使用する。
- Immer patchは外部保存形式やリアルタイム配信形式にしない。
- Undo / Redoも新しいrevisionを生成する編集操作として扱う。
- command適用に失敗した場合はdocumentを部分更新しない。
- commandには適用対象のIDを含め、配列indexだけに依存しない。

### 操作の確定境界

- 3D drag中はThree.js objectとtransient stateだけを更新する。
- pointer up時に1つの`element.transform` commandとして確定する。
- keyboardによる連続移動は適切な時間単位でまとめる。
- property panelの文字入力はblurまたはdebounce境界でまとめる。
- element削除のinverse commandには復元に必要なelementと位置を保持する。

## ほぼリアルタイムな閲覧

初期版は単一編集者と複数閲覧者を想定する。複数writer間のmergeが不要なため、YjsやCRDTは導入しない。

```text
Editor
  committed command + revision
            |
            v
DocumentStream
            |
            v
Viewer reducer
```

### Transport interface

```ts
interface DocumentStream {
  loadSnapshot(id: string): Promise<DocumentSnapshot>;
  publish(event: DocumentEvent): Promise<void>;
  subscribe(id: string, listener: Listener): Unsubscribe;
}
```

### 今回の実装

- `BroadcastChannel`を使い、同一originの別tab間で同期する。
- Editorは確定済みcommandとrevisionだけをpublishする。
- drag中のtransient updateはpublishしない。
- Viewerはread-only reducerでcommandを適用する。
- Viewerは期待revisionと受信revisionが連続しない場合、snapshotを再取得する。
- Viewerにはselection、gizmo、Editor panel、Undo / Redoを持たせない。
- EditorとViewerで3D scene rendererを共有し、編集controlsだけを分離する。

### 将来のAPI接続

後続タスクで`BroadcastChannelDocumentStream`をWebSocketまたはSSE実装へ交換する。外部transportへImmer patchを送らず、versionedなdocument eventを使用する。

## UI設計

### MUIを使用する範囲

```text
AppBar
Toolbar
Drawer
Menu
Dialog
Tabs
Properties panel
Asset library
Project settings
Snackbar
```

### MUIを使用しない範囲

```text
3D viewport
scene rendering
selection outline
transform gizmo
pointer drag処理
camera render loop
```

既存のglobal CSSが`button`、`input`などへ直接指定しているstyleは、MUI導入時にTheme、CssBaseline、layout用CSSへ整理する。MUIとTailwindの併用は行わない。

## 3D Viewport

最初のvertical sliceで次を実現する。

- fixtureからGLBを読み込む
- sceneへGLB modelを配置する
- OrbitControlsでcameraを操作する
- pointer操作でelementを選択する
- TransformControlsで移動、回転、拡縮する
- gizmo操作中はOrbitControlsを無効化する
- pointer upでtransform commandを確定する
- transformをUndo / Redoする
- 確定commandをViewer tabへ反映する
- GLB load失敗時にfallbackとエラー内容を表示する
- WebGLを利用できない場合にEditor全体を壊さずエラーUIを表示する

GLBのloader cacheとresource disposalを考慮し、同じassetをslide切り替えごとに再取得しない。

## Routing

初期版では未定義のproject domainをURLへ先行導入しない。

```text
/
/presentations/$presentationId/edit
/presentations/$presentationId/view
/device
```

### Routing規則

- TanStack Routerに`basepath`を設定しない。
- Viteに`base: "/"`を設定する。
- route paramsとsearch paramsはschemaで検証する。
- panel表示など共有・再読み込みに意味がある状態だけをsearch paramsへ入れる。
- selection、hover、drag状態はURLへ入れない。
- Viewer routeはEditor moduleを遅延loadしない構成を目指す。

## ディレクトリ構成

```text
app/web/src/
├── app/
│   ├── router/
│   ├── providers/
│   └── theme/
├── routes/
│   ├── home/
│   ├── editor/
│   └── viewer/
├── document/
│   ├── schema/
│   ├── model/
│   ├── migrations/
│   ├── serializer/
│   └── fixtures/
├── editor/
│   ├── commands/
│   ├── history/
│   ├── session/
│   ├── viewport/
│   ├── panels/
│   └── shortcuts/
├── viewer/
│   ├── stream/
│   └── presentation/
├── features/
│   ├── asset-library/
│   ├── properties/
│   └── export/
└── shared/
    ├── ui/
    └── utils/
```

API integrationが始まるまでは`shared/api`を拡張しない。現在の`src/api.ts`は実通信を表していないため、UI上の接続状態には使用しない。

## Cloudflare配信

Editorはroot-based Workerとして配信する。同一ホストの本番ではLPの明示的なパスをTerraformのRouteで先に確保し、それ以外のパスをEditor Workerが所有する。

### SPA routing

- Wrangler Static Assetsの`not_found_handling`を`single-page-application`にする。
- root routeを登録する。
- deep linkから直接開いても`index.html`を返す。
- Viteが出力するasset URLは`/`をbaseとする。

Worker entryはroot-based requestをそのままAssets bindingへ渡す。LPの`/`、`/news/*`、`/docs/*`、静的アセットは同一ホスト上のより具体的なRouteでLP Workerへ渡される。

```text
/assets/... -> static asset
/foo        -> SPA index fallback
```

Cloudflare Vite pluginはVite+との最小構成でdev/buildを検証する。peer dependency、build、previewのいずれかに問題がある場合はpluginを使用せず、Vite+ buildとWrangler Static Assetsを分離する。

## テスト戦略

開発は`Explore -> Red -> Green -> Refactor`の順で進める。

### Unit test

- Zod schemaの正常系と異常系
- serializer round trip
- document migration
- command適用
- inverse command
- Undo / Redo
- revision更新
- 存在しないIDへのcommand拒否
- `AssetResolver`
- revision欠番検出

### Component test

- MUI Editor shell
- route paramsとsearch params
- selectionとproperty panelの連動
- form validation
- Viewerのread-only表示
- GLB/WebGL error fallback

WebGLそのものはjsdom unit testで再現せず、R3F境界をmockする。実際のCanvas操作はPlaywrightで検証する。

### E2E test

- Editor routeを直接開ける
- GLB modelが表示される
- modelを選択できる
- gizmo操作をcommandとして確定できる
- Undo / Redoできる
- EditorとViewerの2ページ間で変更が反映される
- revision欠番からsnapshotへ復旧できる
- Viewer routeをdeep linkから開ける
- mobile viewportでViewerを利用できる
- GLB load失敗時にfallbackが表示される

## 実装フェーズ

### Phase 1: 基盤と互換性検証

- 依存関係を一括導入する。
- React 19.2とMUI v9を明示する。
- React Vite pluginを追加する。
- Vitest、jsdom、Testing Libraryを設定する。
- 既存のNode testをVitestへ移行する。
- Cloudflare Vite pluginとVite+の最小dev/buildを検証する。
- `nix run .#web`のcheck、test、buildを維持する。

### Phase 2: Document Core

- Zod v1 schemaを定義する。
- coordinate systemとtransform規約を定義する。
- serializer、parser、migration runnerを実装する。
- GLBを参照するasset modelを定義する。
- fixture documentとfixture assetを用意する。

### Phase 3: CommandとHistory

- serializableなcommand unionを定義する。
- command reducerとinverse command生成を実装する。
- Undo / Redo stackを実装する。
- revision管理を実装する。
- command適用エラーを型付きで扱う。

### Phase 4: App Shell

- MUI ThemeProviderとCssBaselineを導入する。
- TanStack Routerを導入する。
- TanStack Query Providerを導入する。
- ZustandによるEditor Session storeを実装する。
- toolbar、slide panel、property panel、viewport layoutを構築する。

### Phase 5: 3D Vertical Slice

- R3F CanvasとGLB loaderを導入する。
- camera、lighting、OrbitControlsを構成する。
- selectionとTransformControlsを実装する。
- drag中のtransient更新とpointer up時のcommand確定を分離する。
- property panelからtransformを編集できるようにする。
- Undo / Redoをviewportへ反映する。

### Phase 6: Viewer同期

- Editor routeとViewer routeを分離する。
- `DocumentStream` interfaceを定義する。
- `BroadcastChannelDocumentStream`を実装する。
- commandとrevisionをViewerへ反映する。
- revision欠番時のsnapshot再取得を実装する。

### Phase 7: Hosting

- Viteの`/` baseを設定する。
- Wrangler Static Assetsを設定する。
- root-based requestをAssets bindingへ渡すWorker entryを追加する。
- LPの明示的なパスとEditorの`un-fra.me/*` fallback routeを設定する。
- SPA fallbackとdeep linkをlocal previewで検証する。

### Phase 8: E2EとCI

- Playwright Chromium testを追加する。
- EditorとViewerの複数page testを追加する。
- GitHub Actionsでbrowserを準備する。
- E2EをWebの品質ゲートとして実行する方法を確定する。
- format、lint、typecheck、unit test、build、E2Eの責務を明文化する。

## 最初のVertical Slice

最初の利用可能な成果物は、次の一連の操作を成立させる。

1. `/presentations/demo/edit`を開く。
2. fixtureのGLB modelを表示する。
3. modelを選択する。
4. gizmoでmodelを移動する。
5. pointer upでtransform commandを確定する。
6. Undo / Redoする。
7. `/presentations/demo/view`を開いた別tabへ変更を反映する。

## 検証コマンド

実装中は狭いcheckから実行し、完了前にrepository全体を検証する。

```bash
pnpm --filter @unframe/web run check
pnpm --filter @unframe/web run test
pnpm --filter @unframe/web run build
pnpm --filter @unframe/web run test:e2e
nix run .#web
nix run .#check
```

Cloudflare設定を追加した後は、Wrangler local previewで`/`、Editor deep link、Viewer deep link、static asset取得を確認する。

## 完了条件

- React 19.2、MUI v9、Vite+を基盤としてEditorが起動する。
- document、session、transient 3D state、temporary UI stateが分離されている。
- Zodでdocumentを検証し、serializerとmigrationをtestできる。
- GLB modelを表示、選択、移動、回転、拡縮できる。
- drag中にdocument全体を毎frame更新しない。
- transformを1つのcommandとしてUndo / Redoできる。
- Editorの確定操作が別tabのViewerへ反映される。
- revision欠番からsnapshotへ復旧できる。
- root-based deep linkがCloudflare SPA配信で機能する。
- Vitest、Testing Library、Playwrightの関連testが通る。
- `nix run .#web`と`nix run .#check`が通る。
- API、Control Plane、D1、contract に意図しない差分がない。

## 後続検討事項

- Webドメインモデルを基準としたControl Plane APIの再設計
- optimistic concurrencyとserver-side revision
- autosaveとsnapshot保存
- WebSocketまたはSSEによるViewer配信
- 認証、編集権限、共有token
- asset upload finalizeと変換pipeline
- FBXなどの入力形式からGLBへの変換
- Unity runtimeでのGLB読み込み
- draftとpublished snapshotの分離
- 複数編集者が必要になった場合のCRDT再評価
