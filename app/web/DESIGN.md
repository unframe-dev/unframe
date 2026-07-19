# Unframe Application Design Guide

## 目的と対象

`app/web/` は Unframe のアプリケーション層である。LP のようにプロダクトを説明する場所ではなく、ユーザーがログインし、プレゼンテーションを選び、編集し、閲覧するための状態を持つ React アプリケーションとして設計する。

| 領域 | URL の責務 | 役割 |
| --- | --- | --- |
| LP / Site | `un-fra.me/`、`/news`、`/docs` | ブランド、価値、更新情報、ドキュメントを伝える |
| Application | `un-fra.me/signup`、`/signin`、`/home`、`/editor` など | 認証後の作業、資料管理、編集、閲覧を提供する |

LP の詳細は `lp/DESIGN.md` に定義する。LP とアプリはロゴ、ブランドカラー、文章の温度を共有するが、視覚的な役割は分ける。

- LP: 余白、大きな display heading、波形、非対称グリッドを使う編集的な紙面
- Application: MUI の明確な境界、情報密度、状態表示、キーボード操作を優先する作業環境

### 現在の実装範囲

ルートの対象範囲と現在利用できる機能を混同しない。

- `app/web/` は現在、fixture を使った Home、Editor、read-only Viewer の WIP scaffold である。
- `/signup`、`/signin`、本格的な `/home`、presentation CRUD、upload、認証、認可は対象範囲だが、現在は未実装である。
- 現在の router は `/editor/` を basepath とし、`/editor/`、`/editor/presentations/$presentationId/edit`、`/editor/presentations/$presentationId/view` を提供する。
- 未実装の機能を利用可能な CTA、保存済み状態、接続済み状態として表示しない。

## プロダクトモデル

Web アプリは空間的なプレゼンテーションを作成し、確定した変更を read-only Viewer へ反映する SPA である。

最初の縦スライスは次を満たす。

- GLB fixture を 3D Viewport に表示する
- 要素を選択し、移動、回転、拡縮する
- 確定した操作を Undo / Redo する
- 確定した操作を同一 origin の別 Viewer へ反映する
- GLB 読み込み失敗と WebGL 利用不可を復旧可能な状態で表示する

編集者は単一 writer とし、Viewer は read-only とする。複数編集者の競合解決は現在の対象外である。

## 設計原則

### 作業を最短距離にする

アプリの Home は marketing page ではなく、次に開く資料を選ぶ workspace である。Editor は 3D Viewport を主役にし、ツールバー、スライド一覧、プロパティは操作を支える。

### 情報密度を制御する

アプリは LP より高い情報密度を許容する。ただしすべての機能を常時表示せず、現在の資料、選択対象、tool、同期状態に必要な情報を優先する。

### 状態を隠さない

loading、empty、saving、saved、syncing、error、disabled、selected を文字、形、境界、アイコン、領域の変化で示す。色だけで状態を伝えない。

### 既存の操作モデルを守る

React、MUI、TanStack Router、Zustand、React Hook Form、Three.js の責務を維持する。LP の Svelte コンポーネントや LP 専用の装飾を React UI の抽象へ持ち込まない。

### 実装済みの実態だけを表示する

保存、認証、変換、公開、クラウド同期など未実装の機能を、見た目だけ先に実装しない。fixture、local preview、BroadcastChannel など、実際の仕組みをラベルにも反映する。

## アプリケーションシェル

### Header / App bar

- デスクトップはおおむね `64〜72px`、モバイルは `56〜64px` とする。
- 左にブランドマークと現在のページまたはドキュメント名を置く。
- 右に undo / redo、tool、grid、同期状態、viewer への導線を置く。
- ドキュメント名が省略されても revision や同期状態を隠さない。
- LP の絶対配置 Header を流用せず、scroll と画面状態に対して安定した位置にする。

### Home / Dashboard

Home はアプリの入口であり、次の作業を選ぶ画面である。

- ページタイトルと workspace の文脈を最初に示す。
- 最近使った資料、資料数、revision、保存や同期の状態を優先する。
- 新規作成、検索、filter は機能が実装された後に追加する。
- 一覧が未実装の段階では fixture / preview と明示し、存在しない資料を表示しない。
- LP の抽象的なメッセージや巨大な Hero は、Home の作業導線を置き換えない。

### Editor

デスクトップの基本構成は次の 3 ペインである。

| 領域 | 役割 |
| --- | --- |
| 左 panel | slide、layer、asset のナビゲーション |
| 中央 | 最も広い 3D Viewport |
| 右 panel | 選択対象の property、transform、状態 |

上部の toolbar は presentation 名、Undo / Redo、select / translate / rotate / scale、grid、同期状態、Viewer 導線を持つ。

- 3D Viewport は `night` または `night-soft` の暗色面にする。
- 左右 panel は `Paper`、`Divider`、`List`、`TextField` など MUI の意味のある部品で作る。
- panel をカードの連続にせず、surface、divider、見出し階層、余白で分ける。
- selected は薄い背景だけに頼らず、左線、境界線、focus、名前で示す。
- editor の主役は canvas だが、canvas だけを唯一の選択・編集手段にしない。

### Viewer

Viewer は Editor と明確に区別する read-only surface である。

- `night` を基底にし、presentation 名、revision、同期状態、slide 移動を表示する。
- selection、gizmo、editor tool、property panel を表示しない。
- Viewer から Editor へ戻る導線を持つ。
- 古い内容を無言で最新として表示せず、再同期中と復旧失敗を区別する。
- mobile viewport、touch 操作、WebGL / asset failure を対象にする。

## 視覚デザイン

### 共通ブランドトークン

LP とアプリで値を共有する。ただしアプリではブランド色の意味を限定し、作業性を優先する。

| トークン | 値 | アプリでの用途 |
| --- | --- | --- |
| `background` | `#f7f7f5` | ページの基底 |
| `foreground` | `#15171d` | 主要文字 |
| `muted` | `#747780` | 補助文字、meta |
| `line` | `#dedfe2` | panel、input、list の境界 |
| `night` | `#0b0e14` | Viewport、Viewer |
| `night-soft` | `#11151d` | Viewport 補助面、fallback |
| `brand-blue` | `#7187f5` | primary、selection、focus |
| `brand-purple` | `#9a80d0` | secondary、panel の強調 |
| `brand-red` | `#df7b80` | error、限定的な注意 |

実装上の共通値は `app/web/src/app/theme/theme.ts` の `brandColors` を正本とする。`lp/src/app.css` の値と変更時に同期する。

### MUI の表現

- MUI の component feeling を保つ。Google 系 UI のような予測可能な control、入力、focus、disabled を優先する。
- shape は小〜中程度（おおむね `8〜14px`）とし、全要素を pill にしない。
- 主要 action は solid button、補助 action は outlined / text button とする。
- 通常の control に Blue -> Purple -> Red のグラデーションを使わない。
- elevation は弱い影、または divider で表現し、影だけに情報階層を依存しない。
- brand-blue / purple / red は選択、focus、primary、error など意味のある状態に使う。
- グラデーション、noise、波形、大きな装飾モチーフはアプリ shell に常設しない。

### タイポグラフィ

```css
"Inter", "Noto Sans JP", "Helvetica Neue", Arial, sans-serif
```

- page title: `20〜32px`、weight `600〜700`
- section title: `14〜18px`、weight `600`
- UI label: `12〜14px`、weight `500〜600`
- meta / helper: `11〜13px`。コントラストを下げすぎない
- 長い marketing heading 用の `clamp()` を toolbar、panel、form に使わない
- 日本語の操作ラベルを簡潔にし、英語の meta は意味がある場合だけ使う

## 色と状態

| 状態 / 対象 | 表現 |
| --- | --- |
| primary action | `brand-blue` の solid button + 明確なラベル |
| selected | Blue / Purple の薄い surface、左線または境界線、名前 |
| focus | 3px 程度の focus ring と offset |
| disabled | MUI の disabled style + 実行できない状態 |
| loading | 対象領域内の progress / skeleton + 説明 |
| empty | 空である理由と実行可能な次の導線 |
| syncing | `syncing` などの明示的な label |
| error | error 色、説明、retry / recovery |
| read-only | Viewer の表示と編集導線の分離 |

`success` の色だけで保存済みや同期済みを表現しない。API や同期を確認していない場合は `connected`、`saved` と表示しない。

## 技術境界

| 領域 | 責務 |
| --- | --- |
| `app/` | providers、router、theme、application-wide UI |
| `routes/` | Home、Editor、Viewer の route composition |
| `document/` | presentation、slide、element、asset の domain model |
| `editor/` | command、history、session、editor-only UI |
| `viewer/` | read-only reducer、stream、presentation canvas |
| `features/` | 複数画面で利用する具体的な機能 |
| `shared/` | 現に複数箇所で使う最小限の UI / utility |

MUI は app bar、toolbar、panel、form、dialog、menu、feedback に使う。Canvas 内の scene object、selection、TransformControls、camera controls には使わない。

### 状態の所有

| 状態 | 所有者 |
| --- | --- |
| Server state | TanStack Query（API 接続後） |
| Editor document | React Context + reducer + pure command |
| Editor session | Zustand vanilla store |
| transient 3D | Three.js ref / component local state |
| temporary UI | React local state / React Hook Form |

資料本体への変更は serializable な `EditorCommand` に変換する。drag 中は transient state だけを更新し、pointer up で一つの command として確定する。

## ルーティングと hosting

アプリケーションの将来の URL 責務は次のとおりである。

| Route | 役割 | 状態 |
| --- | --- | --- |
| `/signup` | アカウント作成 | 未実装 |
| `/signin` | サインイン | 未実装 |
| `/home` | 資料を選ぶ workspace | 対象。現在は `/editor/` の fixture Home |
| `/editor` | プレゼンテーション編集 | 実装中 |
| `/editor/presentations/:id/view` | read-only 閲覧 | 実装中 |

現在の Vite `base` と TanStack Router `basepath` は `/editor/` である。route、asset、worker の prefix を二重化しない。hosting の最終構成は実装と Cloudflare 設定を確認して更新する。

## レスポンシブ

- 1024px 以上: 左 navigator、viewport、右 properties の 3 ペイン
- 768px 以上: viewport を優先し、左右 panel の幅を固定・制限
- 768px 未満: panel を縦積み、drawer、または明示的な切り替えへ移行
- viewport の最小操作領域を守り、入力欄を無理に潰さない
- panel を閉じても selection や未確定 input を意図せず失わない
- 320px、375px、768px、1024px、1440px で title、toolbar、CTA、form、canvas が欠けないことを確認する
- touch target は原則 `44px` 四方以上とする

## アクセシビリティ

- route ごとに意味のある `h1` を一つ持つ。
- `header`、`nav`、`main`、`aside`、`section` の landmark を情報構造に合わせる。
- skip link と明確な `focus-visible` indicator を提供する。
- 通常文字は `4.5:1`、大きな文字と UI 境界は `3:1` を最低基準にする。
- selection、tool、saving、sync、error を色だけで伝えない。
- icon-only control に accessible name と tooltip を付ける。
- dialog、menu、drawer は Escape、focus 移動、focus 復帰を扱う。
- Canvas 以外に slide navigator と properties panel から同じ対象を操作できる経路を持つ。
- `forced-colors` でも focus、selection、control の境界を認識できるようにする。
- `prefers-reduced-motion` では不要な transition、camera animation、常時アニメーションを停止する。

## 禁止事項

- LP の Hero、巨大 display heading、GradientWave、noise、大きな marketing spacing を app shell にコピーする。
- アプリの通常操作をグラデーション、pill、hover animation だけで表現する。
- 実装されていない signup、signin、CRUD、upload、cloud save を利用可能な CTA として見せる。
- `#` だけのリンク、処理のないボタン、存在しない anchor を作る。
- 資料本体を巨大な Zustand store に入れる。
- R3F や UI component から document を直接書き換える。
- drag 中に毎フレーム command や revision を生成する。
- 署名 URL、Object URL、Three.js object、runtime state を document に保存する。
- Viewer に selection、gizmo、editor panel を持たせる。
- Canvas だけを唯一の選択・編集手段にする。
- status、focus、selection、error を色だけで伝える。

## 現行実装との差分

確認時点での `app/web/` は WIP である。

- Home は fixture の `Spatial story` を開く入口で、資料一覧や新規作成は未実装である。
- Editor は GLB fixture、slide navigator、properties panel、transform command、Undo / Redo を持つ。
- Viewer は read-only で、BroadcastChannel による同一 origin の確定操作同期を持つ。
- API 接続、認証、認可、永続保存、複数ユーザー編集は未実装である。
- signup / signin の画面はまだ存在しない。
- `app/web/src/app/theme/theme.ts` は LP と共通するブランド値を定義するが、control はアプリ向けの solid、compact、MUI 表現を採用する。
- `app/web/src/styles.css` はアプリ全体の reset、focus、viewport fallback の基礎だけを持つ。画面固有の見た目は route / component と MUI theme で管理する。

## テストと QA

機能追加と不具合修正は Explore、Red、Green、Refactor の順で進める。

### Unit / Component

- schema、parser、serializer、migration
- `applyCommand`、inverse command、Undo / Redo、revision
- quaternion / Euler 変換
- router の Home / Editor / Viewer 表示
- toolbar、panel、properties、keyboard 操作
- loading、empty、error、retry、WebGL / GLB fallback

### E2E

- presentation を開いて要素を選択、transform、Undo / Redo する
- Editor と Viewer の間で確定 command を同期する
- revision 欠番から snapshot へ復旧する
- Viewer を mobile viewport で操作する
- GLB 読み込み失敗と WebGL 利用不可の fallback を表示する
- deep link と `/editor/` の直接アクセスを確認する

画面変更では、デスクトップとモバイルの実表示、Tab / Shift+Tab / Enter / Space / Escape、focus、loading / error / empty state を確認する。Three.js の変更では WebGL が利用できない場合も確認する。

```bash
pnpm --filter @unframe/web check
pnpm --filter @unframe/web test
pnpm --filter @unframe/web build
```

リポジトリ全体の gate は `nix run .#check` を使う。LP 側の確認は `lp/DESIGN.md` に記載したコマンドを使う。
