# Unframe Web Editor Design Guide

## 目的

この文書は、`app/web/` に実装する Web エディターと閲覧画面のプロダクト設計、情報設計、状態境界、インタラクション、視覚原則を定義するデザインガイドです。

- 対象: `app/web/src/` の Home、Editor、Viewer
- 技術構成と開発手順: 今後作成する `app/web/README.md`
- プロダクト全体の構成: `ARCHITECTURE.md`
- API 契約: `app/server/` の Huma 定義と `packages/contracts/openapi.yaml`
- LP のデザイン: `lp/DESIGN.md`

この文書では、合意済みの目標設計を規範として扱います。現行コードは最小限の scaffold であり、目標との差分は「現行実装との差分」に分離して記載します。

API、Go server、DB、OpenAPI 生成物の変更は、この設計を最初に実装する工程の対象外です。将来 API を再設計するときは、Web のドキュメントモデルを基準に Go/Huma 契約と Unity 向け projection を検討します。

## プロダクトの役割

Web エディターは、空間的なプレゼンテーションを作成し、その結果を閲覧者へほぼリアルタイムに反映するための SPA です。

最初の成果物は、次の縦スライスを成立させます。

- GLB fixture を読み込み、3D Viewport に表示する
- 要素を選択し、移動、回転、拡縮する
- 確定した操作を Undo / Redo する
- 確定した操作を同一 origin の別タブにある Viewer へ反映する
- GLB の読み込み失敗と WebGL の利用不可を明確に表示する

対象とする編集モデルは単一編集者です。閲覧者は読み取り専用であり、編集者の確定操作を受信します。複数編集者間の競合解決は行わず、Yjs や CRDT は導入しません。

## 設計原則

### 作業対象を中心に置く

Editor の主役は 3D Viewport とプレゼンテーション本体です。ツールバー、スライド一覧、プロパティパネルは操作を支える領域として配置し、Canvas を不必要に狭めません。

### 状態の所有者を明確にする

資料本体、編集セッション、サーバー状態、一時的な 3D 状態、未確定 UI 状態を一つの store に集約しません。更新頻度、永続性、共有範囲に応じて所有者を分けます。

### 確定操作をコマンドにする

資料本体への変更は、直列化可能な `EditorCommand` として document reducer に dispatch します。R3F、プロパティ入力、ショートカットは資料本体を直接変更しません。

### ドラッグと永続状態を分離する

3D ドラッグ中は Three.js object の transient state だけを更新します。pointer up で一度だけ transform command を確定し、履歴、revision、Viewer 配信の単位を一致させます。

### 編集状態を隠さない

選択、保存、同期、読み込み、エラー、無効状態を、色だけに依存せず文字、形、アイコン、領域の変化で示します。実行できない操作は disabled にし、必要に応じて理由を説明します。

### LP と役割を混同しない

LP はブランドの思想を伝える編集的な紙面です。Web は長時間の作業と精密な操作を支えるプロダクト UI です。ブランド上の連続性は保ちますが、LP の巨大見出し、大きな余白、装飾的な波形を Editor shell にそのまま持ち込みません。

### 実態と表現を一致させる

未実装の保存、同期、変換、公開機能を利用可能として表示しません。接続確認を行っていない状態を `connected` と表現せず、Viewer に反映されるのは確定済み command だけであることを UI と実装で一致させます。

## 技術構成

合意済みの構成は次のとおりです。

| 領域                  | 採用技術                          |
| --------------------- | --------------------------------- |
| UI runtime            | React 19.2                        |
| 言語                  | TypeScript strict                 |
| Component library     | MUI v9                            |
| Build tool            | Vite+                             |
| Routing               | TanStack Router                   |
| Server state          | TanStack Query                    |
| Editor session        | Zustand vanilla store             |
| Validation            | Zod 4                             |
| Form                  | React Hook Form                   |
| Immutable update      | Immer                             |
| 3D                    | Three.js、React Three Fiber、drei |
| Unit / Component test | Vitest、Testing Library           |
| E2E                   | Playwright                        |
| Canonical 3D format   | GLB                               |

React 19.2 と MUI v9 は明示的に指定します。依存パッケージは基盤工程でまとめて導入し、Cloudflare Vite plugin は Vite+ との互換性を build で確認します。互換性に問題がある場合は plugin を外し、Wrangler Static Assets を使用します。

### 依存パッケージ

基盤工程では、次の候補をまとめて追加します。

Runtime:

- `@mui/material`
- `@mui/icons-material`
- `@emotion/react`
- `@emotion/styled`
- `@tanstack/react-router`
- `@tanstack/react-query`
- `zustand`
- `zod`
- `react-hook-form`
- `@hookform/resolvers`
- `immer`
- `three`
- `@react-three/fiber`
- `@react-three/drei`

Development:

- `@vitejs/plugin-react`
- `vitest`
- `jsdom`
- `@testing-library/react`
- `@testing-library/user-event`
- `@testing-library/jest-dom`
- `@playwright/test`
- `wrangler`
- `@cloudflare/vite-plugin`
- `@cloudflare/workers-types`

依存は実際に利用する `app/web/` にだけ追加します。既存技術で解決できる機能のために、重複する状態管理、フォーム、3D、テストライブラリを追加しません。

## アプリケーション構造

目標とする責務分離は次のとおりです。

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

ディレクトリは責務が実装される時点で追加します。将来の利用だけを理由に空の抽象や barrel file を先に作りません。

- `document/` は React、Three.js、通信方式から独立したドメインモデルを所有する
- `editor/` は command、history、session、編集専用 UI を所有する
- `viewer/` は read-only reducer と表示専用 UI を所有する
- `features/` は複数画面から利用される具体的な機能単位を所有する
- `shared/ui/` は現に複数箇所で再利用する UI に限定する
- API 接続開始までは `shared/api/` を拡張しない
- 既存 `src/api.ts` は利用を停止するか、将来接続用の境界に限定する

## Routing

Web は `un-fra.me/editor` 配下に SPA として配信します。

| Route                                        | 役割                                      |
| -------------------------------------------- | ----------------------------------------- |
| `/editor/`                                   | Home またはプレゼンテーション選択への入口 |
| `/editor/presentations/$presentationId/edit` | 編集者向け Editor                         |
| `/editor/presentations/$presentationId/view` | 読み取り専用 Viewer                       |

- TanStack Router に `basepath: "/editor"` を設定する
- Vite に `base: "/editor/"` を設定する
- 現在ドメインに存在しない `projectId` を URL に先回りして追加しない
- panel など、共有や再読み込みに意味がある状態だけを search params に入れる
- selection、hover、ドラッグ中の transform は URL に入れない
- edit と view は route と権限の意味を分離し、Viewer に編集用 UI を描画しない
- 直接アクセスと再読み込みでも各 route を表示できる SPA fallback を提供する

## 状態設計

状態は次の所有境界に分けます。

| 状態               | 所有者                                 | 主な内容                                                  |
| ------------------ | -------------------------------------- | --------------------------------------------------------- |
| Server State       | TanStack Query                         | 将来の API 接続、保存状態、asset metadata                 |
| Editor Document    | React reducer + pure command functions | presentation、slides、elements、assets、revision、history |
| Editor Session     | Zustand vanilla store                  | selection、tool、panel、snap、preview、viewport 設定      |
| Transient 3D State | Three.js refs / component local state  | ドラッグ中 transform、hover、camera 操作、gizmo           |
| Temporary UI       | React local state / React Hook Form    | dialog、menu、未確定フォーム入力                          |

### Server State

API 接続後に TanStack Query が remote snapshot、保存処理、asset metadata を管理します。Editor Document の編集中データを Query cache の直接編集だけで表現しません。

### Editor Document

資料本体は React Context 配下の document reducer が所有します。巨大な Zustand store には入れません。reducer と command 適用関数は UI から独立した純粋なロジックとしてテストします。

### Editor Session

Zustand は頻繁に参照される一時的な編集セッションを管理します。Document に保存しない selection、現在の tool、panel の開閉、snap、preview、viewport 設定を扱います。

### Transient 3D State

毎フレーム変化する camera やドラッグ中 transform は React の document state に反映しません。Three.js refs または局所 state で保持し、確定境界だけを command に変換します。

### Temporary UI

dialog、menu、未確定入力は利用箇所に近い local state で所有します。検証を伴うフォームは React Hook Form と Zod schema を使用し、blur、submit、または debounce 境界で document command にまとめます。

## ドキュメントモデル

`PresentationDocument` は Web 側の独立したドメインモデルとして定義します。

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

型の正本は Zod schema とし、TypeScript 型は schema から推論します。ネットワーク response、fixture、保存データ、BroadcastChannel の snapshot は同じ trust boundary validation を通します。

### 座標と Transform

- 正規 3D 形式は GLB とする
- 単位はメートルとする
- 座標系は右手系とする
- up axis は Y とする
- 永続 transform は `position`、quaternion `rotation`、`scale` とする
- UI で Euler 角を表示しても、保存時は quaternion に変換する
- quaternion の成分順、角度の表示単位、軸ごとの編集規約を schema と実装で統一する

### Asset Reference

- document には asset の永続 ID を保存する
- 署名 URL、Object URL、Three.js object、loader の runtime state を保存しない
- 読み込み URL は `AssetResolver` から取得する
- GLB の読み込み状態と失敗理由は document ではなく runtime state として扱う

### Versioning と Serialization

- document は必ず `version` を持つ
- version ごとの migration chain を用意する
- parser は validation 後に現在 version へ migration する
- serializer は runtime 値を排除してから保存する
- migration は入力を破壊せず、fixture を使って単体テストする
- 未知の新しい version を暗黙に読み込まず、回復可能なエラーとして扱う

## Command と履歴

command は関数ではなく、直列化可能な discriminated union とします。

```ts
type EditorCommand =
  | { type: "element.add"; slideId: string; element: Element }
  | { type: "element.remove"; slideId: string; elementId: string }
  | { type: "element.transform"; elementId: string; transform: Transform }
  | { type: "element.update"; elementId: string; changes: ElementChanges }
  | { type: "slide.reorder"; slideId: string; toIndex: number };
```

`applyCommand(document, command)` は新しい document と inverse command を返します。

- Undo は inverse command を適用する
- Redo は元 command を再適用する
- Undo / Redo も新しい revision として扱う
- Immer は reducer 実装の簡略化に使用する
- Immer patch 自体を保存形式や外部配信形式にしない
- command は履歴、操作ログ、Viewer 配信で共通利用する
- command は対象 ID と適用条件を検証し、不正な対象へ部分適用しない
- property 入力は blur または debounce 境界で一つの command にまとめる
- 3D drag は pointer up で一つの transform command にまとめる

履歴には document 全体の runtime object や closure を保存しません。履歴上限と保存済み revision との関係は、永続化を実装する工程で定義します。

## リアルタイム閲覧

単一 writer を前提とし、Editor の確定 command と revision を Viewer の read-only reducer へ配信します。

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

Web 側は通信方式から UI を分離するため、次の抽象を持ちます。

```ts
interface DocumentStream {
  loadSnapshot(id: string): Promise<DocumentSnapshot>;
  publish(event: DocumentEvent): Promise<void>;
  subscribe(id: string, listener: Listener): Unsubscribe;
}
```

最初の実装は BroadcastChannel adapter を使用します。

- 同一 origin の別タブ間で同期する
- Editor は確定 command だけを publish する
- Viewer は selection、gizmo、editor panel を持たない
- Viewer は受信 event を read-only reducer に適用する
- revision が連続しない場合は event を推測適用せず snapshot を再取得する
- snapshot 取得中、再同期中、復旧失敗を Viewer 上で区別する
- adapter の交換で WebSocket または SSE に移行できる境界を保つ

## 画面構成

### Home

Home は Editor への入口です。API 統合前は、実装済み fixture または明示的な開発用導線だけを表示します。存在しない presentation 一覧やクラウド保存を模倣しません。

### Editor

Editor は次の領域で構成します。

| 領域              | 役割                                                             |
| ----------------- | ---------------------------------------------------------------- |
| App bar / Toolbar | presentation 名、主要 tool、Undo / Redo、preview、保存・同期状態 |
| Slide navigator   | slide の選択、追加、並べ替え                                     |
| 3D Viewport       | scene 表示、選択、camera、gizmo 操作                             |
| Properties panel  | 選択対象の検証付き属性編集                                       |
| Status / Feedback | loading、error、同期、ショートカット結果の通知                   |

領域の具体的な幅、色、spacing は MUI theme と Editor のプロトタイプ検証後にトークンとして定義します。初期 scaffold のハードコード値を正式トークンとして引き継ぎません。

### Viewer

Viewer は presentation の閲覧に必要な Canvas と最小限のナビゲーションだけを表示します。

- editor tool、selection outline、gizmo、properties panel を表示しない
- mobile viewport でも閲覧可能にする
- 同期中断時に古い内容を無言で最新として扱わない
- WebGL または asset の失敗時に復旧方法を示す
- presentation 操作に必要なキーボードとタッチ操作を提供する

## 視覚デザイン原則

### 情報密度

Editor は LP より高い情報密度を許容します。ただし、すべての機能を常時表示せず、現在の selection と tool に必要な操作を優先します。パネルの区切りはカードの乱用ではなく、surface、divider、余白、見出し階層で表します。

### ブランドとの連続性

ブランドカラーは選択、focus、主要 action、同期状態など意味のある箇所に限定します。Blue、Purple、Red のグラデーションを大面積の Editor 背景や多数の control に適用しません。

色、タイポグラフィ、shape、elevation の具体値は MUI theme に集約します。コンポーネント内で理由なく色値をハードコードしません。

### Theme

- MUI `ThemeProvider` と `CssBaseline` をアプリケーション境界で適用する
- palette は背景、surface、divider、text、primary、error、warning、success、selection を区別する
- light / dark mode の採否は未決定とし、現行 scaffold の dark theme を既定方針にしない
- Canvas 背景と HTML UI のコントラストを別々に検証する
- status は success 色だけで表現せず、明示的な label を添える

### Typography

- UI label、数値入力、階層名は長時間読めるサイズと行間を優先する
- presentation title と panel heading の階層を明確にする
- 小さな label に過度な letter spacing や低コントラスト色を使用しない
- 数値、単位、軸名は桁と符号を比較しやすく表示する
- フォントを配信する場合は、ライセンス、読み込みコスト、日本語 glyph を確認する

### Icon

MUI Icons は toolbar、panel、dialog など HTML UI に限定して使います。

- icon-only button には accessible name と tooltip を付ける
- active、disabled、destructive の状態を icon の形だけに依存させない
- 3D gizmo と toolbar icon で同じ軸色・操作概念を使う
- Canvas 内の制御には MUI component を配置しない

## MUI と Canvas の境界

MUI は app bar、toolbar、drawer、panel、form、dialog、menu、feedback に使用します。Canvas 内の scene object、selection、TransformControls、camera controls には使用しません。

- MUI component の状態は Editor Session または local state を更新する
- document 更新が必要な操作は command に変換する
- Canvas overlay を使う場合も、DOM と WebGL の focus / pointer event 境界を明示する
- dialog や menu を閉じた後は起点となった control へ focus を戻す
- panel の開閉で Canvas の描画サイズを再計算する

## 3D Viewport

最初の Viewport は GLB 表示、OrbitControls、selection、TransformControls を提供します。

### Selection

- pointer 選択とキーボードでの代替選択を同じ Editor Session に反映する
- selected、hovered、locked、hidden を区別する
- selection outline は scene の色や明るさだけに依存しない
- 空領域の操作と object の操作が競合しない event priority を定義する

### Transform

- translate、rotate、scale の現在 tool を明示する
- drag 中は Three.js object だけを更新する
- pointer up で document の現在値と比較し、変更がある場合だけ command を dispatch する
- Escape による drag cancel と開始値への復帰を提供する
- property panel と gizmo は同じ transform 変換関数を利用する
- snap の有効状態と刻みを視覚的に示す

### Camera

- OrbitControls と object transform の pointer 操作を競合させない
- Editor の camera 設定と presentation に保存する camera を混同しない
- Viewer の初期 camera は document から再現可能にする
- camera 操作だけで document revision を増やさない

### Failure State

- GLB 読み込み中は対象領域に progress または skeleton を表示する
- GLB 読み込み失敗時は asset 名、失敗状態、再試行または置換導線を示す
- WebGL 利用不可時は空白 Canvas にせず、要件と復旧方法を説明する
- runtime error の詳細を presentation 本文や signed URL とともにログ出力しない

## インタラクション

### Keyboard

Editor は最低限、次の操作体系を持ちます。ブラウザや OS の標準操作と競合する組み合わせは避け、実装時にプラットフォーム差を確認します。

- Undo / Redo
- selection の移動または解除
- tool の切り替え
- 選択要素の削除
- drag または未確定入力の cancel
- dialog、menu、panel 内の focus 移動

ショートカットは input、textarea、contenteditable での文字編集を妨げません。操作一覧を確認できる UI を提供し、shortcut だけを唯一の実行手段にしません。

### Property Input

- 入力中の文字列と確定済み document 値を分離する
- Zod と React Hook Form で範囲、形式、必須値を検証する
- 不正値を無言で丸めたり `NaN` として document に保存しない
- blur、Enter、または debounce で一つの command に確定する
- Escape で未確定値を破棄し、確定値へ戻せるようにする
- quaternion は UI 上で必要に応じて Euler 角へ変換する

### Feedback

- hover で示す状態は focus-visible または選択状態でも認識できるようにする
- command 完了ごとに toast を乱発しない
- 保存、再同期、破壊的操作など、注意が必要な結果だけを明示的に通知する
- motion は状態遷移の理解を補助する短いものに限定する
- `prefers-reduced-motion: reduce` では不要な transition と camera animation を停止する

## レスポンシブ

Editor と Viewer は同じ responsive 戦略を持ちません。

### Editor

デスクトップでは Viewport を中心に navigation と properties を並べます。狭い画面では補助 panel を drawer または切り替え表示にし、Viewport の最小操作領域を守ります。

- DOM の意味的な順序を visual positioning のために崩さない
- panel を閉じても選択や未確定入力を意図せず失わない
- pointer、touch、keyboard の各入力方法を区別して検証する
- 狭い画面で編集機能を限定する場合は、非表示にするだけでなく理由を示す

### Viewer

Viewer は mobile viewport を正式な対象とします。

- Canvas を利用可能な viewport 高に合わせる
- browser chrome と safe area を考慮する
- touch gesture とページ scroll の競合を避ける
- orientation change 後に camera と Canvas size を更新する
- overlay が presentation の主要内容を覆い続けないようにする

具体的な breakpoint と panel 寸法は MUI theme の設計時に決定します。最低でも 320px、375px、768px、1024px、1440px で確認します。

## アクセシビリティ

- route ごとに一意な `h1` を持ち、landmark と見出し順序を保つ
- Editor shell の前に本文または Viewport へ移動する skip link を提供する
- すべての HTML control に accessible name と明確な focus indicator を付ける
- 通常文字は WCAG AA の `4.5:1`、大きな文字と UI 境界は `3:1` を最低基準にする
- touch target は原則 44px 四方以上にする
- selection、tool、保存、同期、error を色だけで伝えない
- dialog、menu、drawer は focus trap、Escape、focus 復帰を正しく扱う
- Canvas だけを唯一の操作手段にせず、slide navigator と properties panel から対象を選択・編集できるようにする
- 3D scene の意味ある内容には、少なくとも要素名、階層、選択状態へアクセスできる DOM 表現を用意する
- status 更新は重要度に応じて `aria-live` を使い、drag 中の連続値を読み上げ続けない
- `forced-colors` でも focus、selection、control の境界を認識できるようにする
- 自動回転、速い点滅、大きな視差効果を使用しない

完全な 3D 編集操作のアクセシブルな代替は、縦スライスの実装と同時に検証します。未検証の Canvas 操作をアクセシブルと断定しません。

## エラーと回復

エラーは発生元と回復方法に応じて表示場所を分けます。

| エラー                    | 表示と回復                              |
| ------------------------- | --------------------------------------- |
| Route / presentation 不明 | page-level error と有効な戻り先         |
| Snapshot 読み込み失敗     | main content 内の retry                 |
| revision 欠番             | 再同期中表示後に snapshot 再取得        |
| GLB 読み込み失敗          | Viewport 内 fallback と retry / replace |
| WebGL 利用不可            | Viewport の代替説明                     |
| Property validation       | field 単位の error と未確定値保持       |
| Publish 失敗              | Editor の同期状態と再試行方針           |

予期しない例外は route または主要領域の error boundary で捕捉します。エラー時に document を初期値で上書きせず、保存されていない変更がある場合はその状態を明示します。

## Hosting

Web は `/editor` prefix を所有する独立 SPA として配信します。

- `un-fra.me/editor` と `un-fra.me/editor/*` は LP より具体的な Worker route とする
- Worker が `/editor` prefix を除去して Assets binding へ渡す
- `/editor/assets/...` は `/assets/...` として asset を解決する
- `/editor/foo` は `/foo` として解決し、見つからない場合は SPA index fallback を返す
- asset URL、router basepath、Vite base の prefix を二重化しない
- local preview で deep link と静的 asset の両方を確認する

Cloudflare plugin を利用する場合も、この path contract を build と preview で検証します。デプロイ構成そのものは、互換性スパイクと hosting 工程で確定します。

## テスト戦略

機能追加と不具合修正は Explore、Red、Green、Refactor の順で進めます。

### Unit Test

- Zod schema の valid / invalid data
- parser、serializer、version migration
- `applyCommand` と inverse command
- Undo / Redo と revision
- quaternion と Euler の変換
- revision 欠番の判定
- AssetResolver の URL 非永続化

### Component Test

- provider と route の初期化
- toolbar、panel、dialog の keyboard 操作
- selection と properties の連動
- validation と command 確定境界
- loading、empty、error、retry
- WebGL / GLB fallback UI

Vitest と Testing Library は DOM 上の利用者操作を基準にします。Three.js の内部実装を過度に mock して、実際の pointer event や Canvas lifecycle の問題を隠しません。

### E2E

Playwright Chromium で最低限、次を確認します。

- presentation を開き、要素を選択して transform する
- transform を Undo / Redo する
- Editor と Viewer の二つの page 間で確定 command が同期される
- revision 欠番から snapshot へ復旧する
- `/editor/presentations/$presentationId/view` へ直接アクセスする
- mobile viewport で Viewer を操作する
- GLB 読み込み失敗と WebGL 利用不可の fallback を表示する

WebGL に依存する E2E は実行環境を固定し、利用できない環境で無言の skip にしません。

## 実装順序

1. 基盤と互換性スパイク
2. Document Core
3. Command / History
4. App Shell
5. 3D Vertical Slice
6. 閲覧同期
7. Hosting
8. E2E と CI

各工程は後続の UI を先に模倣せず、成立した機能だけを画面に表示します。依存関係は最初の工程でまとめて導入し、基盤の互換性を確認してからドメイン実装へ進みます。

## 禁止事項

- 資料本体を巨大な Zustand store に入れること
- R3F や UI component から document を直接書き換えること
- ドラッグ中に毎フレーム command や revision を生成すること
- 関数、closure、Immer patch を履歴や配信形式にすること
- 署名 URL、Object URL、Three.js object を document に保存すること
- UI 表示用 Euler 角を永続 rotation の正本にすること
- Viewer に selection、gizmo、editor panel を持たせること
- selection、hover、drag state を URL に入れること
- 存在しない `projectId` や将来機能を先回りしてモデルへ追加すること
- MUI component を Canvas 内の scene object として扱うこと
- API 接続前に保存済み、同期済み、connected と表示すること
- 未実装機能を利用可能な CTA として表示すること
- focus、selection、error、同期状態を色だけで伝えること
- Canvas だけを唯一の選択・編集手段にすること
- 初期 scaffold の色や寸法を検証なしに正式 token とすること
- API、Go server、DB、OpenAPI 生成物を最初の Web 実装に合わせて変更すること

## 現行実装との差分

以下はガイドの推奨事項ではなく、確認時点の `app/web/` scaffold と目標設計との差分です。

1. React と React DOM は package 上 `^19.1.0` であり、React 19.2 を明示していません。
2. MUI、TanStack Router / Query、Zustand、Zod、React Hook Form、Immer、Three.js、R3F、drei は未導入です。
3. Router と `/editor/` basepath は未設定です。
4. Vite の `base: "/editor/"` と React plugin は未設定です。
5. 画面は単一 `App` で、Home、Editor、Viewer route に分離されていません。
6. editor state は `title` と `slideCount` の `useState` だけで、document model、command、history、revision は未実装です。
7. slide は件数だけで、ID、要素、asset、transform を持ちません。
8. 3D Viewport、GLB 読み込み、selection、TransformControls は未実装です。
9. BroadcastChannel と `DocumentStream` は未実装です。
10. `src/api.ts` は localhost の client object を生成するだけで、接続確認をせず `API: connected` と表示しています。
11. 現行 CSS は色と寸法をハードコードしており、MUI theme や正式な design token ではありません。
12. hover、focus-visible、disabled、error、loading、reduced motion の UI state は未定義です。
13. 明示的な responsive layout と mobile Viewer は未実装です。
14. テストは `node:test` による純粋関数の 2 件だけで、Vitest、Testing Library、Playwright は未導入です。
15. `app/web/README.md` は未作成です。

## QA チェックリスト

- [ ] React 19.2、MUI v9、Vite+ の組み合わせで development と production build が動作する
- [ ] TypeScript strict、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` を維持する
- [ ] `/editor/` base と各 deep link が直接アクセス、再読み込みで表示できる
- [ ] document が Zod schema で検証され、serializer に runtime 値が混入しない
- [ ] GLB、メートル、右手系、Y-up、quaternion の規約が実装と fixture で一致する
- [ ] drag 中は document が更新されず、pointer up で一つの command が生成される
- [ ] Undo / Redo ごとに revision が進み、Viewer に反映される
- [ ] revision 欠番時に snapshot を再取得し、不連続な event を推測適用しない
- [ ] Viewer に editor 専用 state と UI が表示されない
- [ ] GLB 読み込み失敗と WebGL 利用不可に回復可能な fallback がある
- [ ] 320px、375px、768px、1024px、1440px で主要領域が操作可能である
- [ ] Viewer が mobile viewport と touch 操作で利用できる
- [ ] Tab、Shift+Tab、Enter、Space、Escape と定義済み shortcut で操作できる
- [ ] input 編集中に editor shortcut が文字操作を妨げない
- [ ] hover、focus、selection、disabled、error、同期状態を色以外でも識別できる
- [ ] `prefers-reduced-motion` と `forced-colors` で操作情報が失われない
- [ ] Vitest unit / component tests が成功する
- [ ] Playwright Chromium E2E が成功する
- [ ] `nix run .#web` が成功する
- [ ] `nix run .#check` が成功する
- [ ] production build が `/editor/` base で asset を解決する
- [ ] Wrangler local preview で deep link と SPA fallback が動作する
- [ ] API、server、DB、generated contract に意図しない差分がない
