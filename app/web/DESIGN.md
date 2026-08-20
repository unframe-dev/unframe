# Unframe Web Design Guide

## Purpose

`app/web` は、ユーザーが空間プレゼンテーションを管理・編集するための作業環境です。ブランドとプロダクトの価値を伝える LP とは役割を分けつつ、色、タイポグラフィ、言葉の温度は [`lp/DESIGN.md`](../../lp/DESIGN.md) と一貫させます。

| Surface           | Responsibility                                          |
| ----------------- | ------------------------------------------------------- |
| LP / Site         | ブランド、価値、ニュース、ドキュメントを伝える          |
| Web Application   | 認証、Presentation 管理、編集、アカウント設定を提供する |
| Unity Application | Presentation の実行、Session、Realtime 操作を提供する   |

Web の責務と技術境界は [`ARCHITECTURE.md`](./ARCHITECTURE.md) を正本とします。この文書は画面全体に共通する視覚・操作方針を定義し、Editor 固有の情報設計は確定させません。

## Design Principles

### 作業を最短距離にする

Home は marketing page ではなく、次に開く Presentation を選ぶ workspace です。認証画面は本人確認を、Settings はアカウント管理を、Editor は制作を主目的とし、各画面の主要 action を一つに絞ります。

### 状態を隠さない

`loading`、`empty`、`saving`、`saved`、`error`、`disabled`、`selected` を、文字、形、境界、アイコン、領域の変化で示します。色だけで状態を伝えません。サーバーで確認していない状態を `saved` や `connected` と表示しません。

### 情報密度に階層をつける

LP より高い情報密度を許容しますが、機能を常時並べません。現在の作業、選択対象、次の action に必要な情報を優先し、詳細操作は段階的に開示します。

### 実装の事実だけを見せる

未実装の保存、共有、変換、公開を利用可能な action として表示しません。機能を無効なボタンで予告するのではなく、利用できる段階で導入します。

### PoC を設計制約にしない

現行の Slide fixture と `localStorage` persistence は移行中の fixture adapter です。これらのデータ構造と保存フローとの互換性を新しい UI の要件にしません。

## Information Architecture

### Routes

| Route                      | Purpose                | Authentication |
| -------------------------- | ---------------------- | -------------- |
| `/login/`                  | ログイン               | Public         |
| `/signup/`                 | アカウント作成         | Public         |
| `/recover/*`               | アカウント復旧         | Public         |
| `/device/`                 | Device Authorization   | Public         |
| `/home/`                   | Presentation 一覧      | Required       |
| `/editor/:presentationId/` | Presentation 編集      | Required       |
| `/settings/profile/`       | プロフィール設定       | Required       |
| `/settings/security/`      | 認証・セキュリティ設定 | Required       |

本番の `/` は LP が所有します。認証必須 route で session が確認できない場合は `/login/` ではなく `/` へ戻します。ログイン後に元の route へ戻す導線は、認証画面の実装時に安全な return URL の契約として設計します。

### Global Navigation

認証後の共通 navigation は、少なくとも Home、Profile、Security、Logout への経路を提供します。Editor では制作領域を優先し、サイト全体の navigation を常時大きく表示しません。

モバイルでは desktop navigation を縮小表示せず、menu や drawer に置き換えます。現在地は見た目だけでなく、見出しと accessible name でも識別できるようにします。

### Authentication

Login、Signup、Recovery は一つの目的に集中した狭い layout とします。

- form の先頭で現在の手続きを明示する
- validation error は該当 field と summary の双方から到達可能にする
- email verification、MFA、recovery の違いを曖昧な「認証エラー」にまとめない
- Google login と email/password の境界を視覚的に分ける
- Device Authorization は device code、承認対象、承認・拒否の結果を明示する

### Home

Home は Presentation 一覧を主役にします。

- 最近更新した Presentation を優先する
- タイトル、更新日時、所有・編集権限、必要な状態を一覧で比較できるようにする
- 新規作成、検索、絞り込みは実 API とともに導入する
- empty state には空である理由と、実行可能な次の action を置く
- marketing Hero や架空の利用実績で一覧を置き換えない

### Settings

Profile と Security は URL と見出しを分けます。保存単位、未保存状態、成功、再認証が必要な操作を明示し、security action を一般的な profile form に混ぜません。

### Editor

Editor の Group / Step / Cue の用語、navigation、空間配置と進行設計の関係、Asset panel、preview は未決定です。次回の Editor 設計で、Control Plane の `PresentationDefinition` と Unity Runtime の対応を確認して決定します。

現時点で共通方針として固定するのは次だけです。

- 3D Viewport を制作の主要 surface とする
- Canvas 以外にも対象を選択・編集できる経路を設ける
- drag 中の一時状態と保存対象の Definition を区別する
- Undo / Redo、保存、revision conflict の状態を隠さない
- Asset URL や runtime session state を編集データとして見せない
- desktop の3ペイン構成や Web preview routeを、PoCだけを根拠に固定しない

## Visual Language

### LP との関係

LP の neutral background、濃い foreground、細い line、Blue / Purple / Red のブランド色を共有します。一方、巨大な display heading、広い marketing spacing、GradientWave、noise を application shell に常設しません。

### Color Tokens

| Token          | Value     | Usage                       |
| -------------- | --------- | --------------------------- |
| `background`   | `#f7f7f5` | ページの基底                |
| `foreground`   | `#15171d` | 主要文字                    |
| `muted`        | `#747780` | 補助文字、metadata          |
| `line`         | `#dedfe2` | panel、input、list の境界   |
| `night`        | `#0b0e14` | 3D Viewport                 |
| `night-soft`   | `#11151d` | Viewport の補助面、fallback |
| `brand-blue`   | `#7187f5` | primary、selection、focus   |
| `brand-purple` | `#9a80d0` | secondary accent            |
| `brand-red`    | `#df7b80` | error、危険な操作           |

値の Web 側の正本は `src/styles.css` の CSS custom properties とします。LP の token を package として共有せず、変更時に両アプリの意図を確認して同期します。

### Typography

```css
"Inter", "Noto Sans JP", "Helvetica Neue", Arial, sans-serif
```

- page title: `20–32px`, weight `600–700`
- section title: `14–18px`, weight `600`
- UI label: `12–14px`, weight `500–600`
- metadata / helper: `11–13px`。コントラストを下げすぎない
- toolbar、panel、form に marketing heading 用の大きな `clamp()` を使わない

### Shape, Border, Elevation

- corner radius は小〜中程度とし、すべてを pill にしない
- surface の階層は border、background、spacing を優先する
- shadow は浮遊や overlay の意味がある場合に限定する
- panel を独立した card の連続にせず、見出しと separator で構造化する

### Motion

motion は状態変化と空間関係の理解に使います。装飾のための常時 animation は避け、`prefers-reduced-motion` では不要な transition と camera animation を停止します。

## Component System

- Tailwind CSS v4 を token と layout の基盤にする
- shadcn/ui の Base UI variant を使用する
- icon は `@phosphor-icons/react` に統一する
- shadcn/ui component は必要になった時点で source を追加し、`src/shared/ui/` で所有する
- route 固有の component を汎用 primitive に昇格させない
- LP の Svelte component を React 用 abstraction へ移植しない

一般 control は shadcn/ui を使いますが、Three.js scene object、TransformControls、camera controls には適用しません。icon-only button は accessible name と tooltip を持ち、装飾 icon は assistive technology から隠します。

## Responsive Behavior

- mobile first で主要 action と content の順序を決める
- desktop layout を単に縦積みするのではなく、作業の優先順位に応じて navigation と inspector を切り替える
- touch target は原則 `44px` 四方以上とする
- viewport の最小操作領域を守り、panel のために Canvas を極端に縮めない
- panel を閉じても selection や未確定 input を意図せず失わない
- `320px`、`375px`、`768px`、`1024px`、`1440px` で確認する

Editor の breakpoint と panel behavior は Editor 設計時に決定します。

## Accessibility

- route ごとに意味のある `h1` を一つ持つ
- `header`、`nav`、`main`、`aside`、`section` を情報構造に合わせる
- skip link と明確な `focus-visible` indicator を提供する
- 通常文字は `4.5:1`、大きな文字と UI 境界は `3:1` を最低基準にする
- loading、saving、selected、error を色だけで伝えない
- dialog、menu、drawer は Escape、focus 移動、focus 復帰を扱う
- Canvas を唯一の操作経路にしない
- `forced-colors` でも focus、selection、control の境界を認識可能にする

## Prohibited Patterns

- LP の装飾を application shell にそのままコピーする
- 通常操作を gradient、pill、hover animation だけで表現する
- 実装されていない機能を有効な CTA として見せる
- `#` だけの link、処理のない button、存在しない anchor を置く
- status、focus、selection、error を色だけで伝える
- 署名 URL、Object URL、Three.js object、runtime state を Definition に保存する
- PoC の Slide schema を新 Editor の互換要件にする
- Session や Realtime の操作を Web Editor に追加する

## Validation

画面変更では desktop と mobile の実表示、keyboard 操作、focus、loading、error、empty state を確認します。機能追加と不具合修正は Explore、Red、Green、Refactor の順で進めます。

```bash
pnpm --filter @unframe/web run check
pnpm --filter @unframe/web run test
pnpm --filter @unframe/web run build
pnpm --filter @unframe/web run test:e2e
nix run .#check
```

Playwright を実行できない環境では、未実行の理由と代替確認を分けて報告します。
