# Local Editor の Preview 中心アーキテクチャ再設計

状態: 2026-10-22 に実装を進行。以下は採用した設計と受け入れ条件であり、検証済み範囲・未確認事項は [実装記録](local-editor-preview-ui-refactor-notes.md) を参照。
作業ブランチ: `refactor/local-editor-ui-ux`。起点は `origin/main` の `a5f57c0`。

成立性の検証結果は [Cue 単位シークの初期検証](local-editor-cue-seek-validation.md) を参照。既存 Unity 試験10件と追加 probe 5件で、既存 wire による前後移動・一時停止・複数 Run／crossfade の状態適用を確認した。適用途中の例外では状態と sequence が部分更新され、新しい sequence での再送だけでは復旧しない故障も再現した。初期検証時点では以下の復旧処理と統合シークは未実装であり、EditMode の結果は UI／HTTP 統合や実 WebGL／Quest の描画確認を代替しない。

## 目的と合意した範囲

コードで制作したプレゼンの表示・動き・進行を確認する画面にする。編集は公開 Props の調整に絞る。`app/local-editor` は有用な表示変換・境界処理・テストを再利用し、画面、状態所有、非同期制御、スタイルをほぼ書き直す。既存 `EditorApp` を部品に切り出すだけの改修にはしない。

- VODAI のエディターを参考に、shadcn/ui を意識したコンパクトな操作部、細い境界線、ニュートラルな色面にする。
- 左端のアイコン列は設けない。左の Group／Step／Cue 一覧は残す。
- 中央に Unity Preview、その直下に時間軸と再生操作、右に選択項目の詳細と公開 Props を置く。
- ヘッダーにライト／ダーク切り替え、開発 Preview／公開前確認の切り替え、公開導線を置く。
- 選んだ Cue の発火を0秒とするシークを新設する。プレゼン全体の総時間や任意 Step へのジャンプは対象外。

VODAI は外観・寸法・配置の参照とし、メディア管理、チャット、動画編集機能は持ち込まない。LP の色より VODAI のエディター用配色を優先する。

## Rewrite の範囲と技術構成

### 現状と置き換える単位

現状は React 19／TypeScript／Vite+ の SPA。`src/features/editor/editor-app.tsx` が project の定期取得、Props／Transform draft、保存・再試行・Undo／Redo、Dev／Dist build、Preview 選択と表示記録をまとめて扱う。`publication-panel.tsx` も認証・build の非同期処理を持つ。Preview の load／playback controller は React 非依存だが、結果を複数の state／ref に橋渡ししている。

Rewrite の対象はこの UI と制御の組み合わせ全体とする。CLI の filesystem・保存・build・公開、Core の進行規則、Unity の共通描画は引き継ぎ、Cue 確認・復旧とブラウザー側の境界整備に必要な契約・処理を拡張する。これらまで別実装に置き換える計画ではない。

| 対象                                                    | 扱い                                                                     | 引き継ぐもの                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `editor-app.tsx`、`publication-panel.tsx` と各パネル    | 新しい責務分担で書き直す                                                 | 保存競合、外部更新、公開条件などの振る舞いと回帰ケース                             |
| `editor.css` と Timeline／Cue の CSS                    | token と部品のスタイルから作り直す                                       | 時間座標・スクロール等の必要な制約                                                 |
| `model/timeline-view.ts`、`model/cue-presentation.ts`   | 純粋な変換として再利用する                                               | 進行図、Cue／Timeline の整形と対応する unit test                                   |
| `model/preview-session.ts`、`model/preview-playback.ts` | controller の実装素材にする。現行 callback 構造の維持は条件にしない      | 最新要求の優先、prepare／commit、直列配送、sequence 照合の規則とテスト             |
| `api.ts`、`infra/unity-preview.ts`                      | 境界 adapter として再構成する                                            | token の扱い、HTTP error、Unity loader／メッセージ配送。検証・取消・故障通知を補強 |
| Timeline／進行図の JSX・SVG 計算                        | 表示ロジックを選別して移す                                               | 必要な座標変換・描画計算。現行 DOM／CSS には合わせない                             |
| 既存 UI／component test・E2E                            | rewrite 時に削除し、保存・非同期制御等の保証を必要なロジックテストへ移す | 保存・履歴・外部保存・Dev／Dist・公開・表示交換の業務ルール                        |

既存実装を残すための互換 wrapper や旧 UI の恒久的な切り替え機構は作らない。移植先で動作を確認した単位から旧コードと不要な依存を削除する。

### 技術の採用案

React SPA＋CLI Host のプロセス境界を維持する案を基準にする。新しい技術は Local Editor の直接依存へ追加し、既存 workspace にある依存は導入時の整合を確認する。以下は機能単位の選定であり、最新版への一括更新指示ではない。

| 領域             | 採用案                                        | 理由・使う範囲                                                                                                 |
| ---------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 実行環境         | React 19、TypeScript、Vite+、pnpm、Nix を維持 | CLI が静的配信する単一 workspace。SSR や常駐する別 Web server は不要                                           |
| 状態の購読       | Zustand の vanilla store＋React selector      | React 外の controller から更新でき、パネルが必要な snapshot だけを購読する。store は workspace ごとに生成する  |
| 状態遷移         | TypeScript の判別 union と純粋な遷移関数      | 保存・表示・復旧の許可操作を定義する。Zustand は保持と購読に使い、業務ルールは store API に埋め込まない        |
| UI primitive     | `@base-ui/react`                              | Dialog、Tabs、Menu、Tooltip、Number Field 等の操作・focus 管理を利用し、Editor 用の薄い部品を所有する          |
| スタイル         | Tailwind CSS 4＋CSS custom properties         | layout／一般部品は utility、意味を持つ色・寸法は token。Timeline の座標・track・SVG は局所 CSS と style で表す |
| アイコン         | `@phosphor-icons/react`                       | 管理 Web と同じアイコン体系を使い、必要なアイコンだけを import する                                            |
| パネル           | `react-resizable-panels`                      | 横・縦分割、開閉、最小幅、キーボードによるサイズ変更を扱う。サイズの保持は UI 設定に限定する                   |
| HTTP             | 既存 fetch adapter＋CLI 所有の contract       | AbortSignal と実行時の応答検証を追加する。共有型を UI 内に複製しない                                           |
| Timeline／進行図 | DOM＋SVG                                      | 現在の閲覧・選択・シークに必要な表現を持つ。動画編集 SDK や汎用ノードエディターは導入しない                    |
| テスト           | Vitest の Node 環境                           | 各層の `tests/` でロジックのみを検証する。E2E・UI・component test は設けない                                   |

Zustand は [vanilla store と React 外の購読](https://github.com/pmndrs/zustand#using-zustand-without-react)、Base UI は [unstyled primitive](https://base-ui.com/react/overview/quick-start)、Tailwind は [theme variables](https://tailwindcss.com/docs/theme)、分割パネルは [公式 README](https://github.com/bvaughn/react-resizable-panels) を選定根拠とする。導入時に React 19、固定 Browser、CSP、キーボード操作との適合を小さい縦断実装で確認し、採用バージョンを lockfile に固定する。

次の選択肢は今回の採用案に含めない。

- Next.js／別 SPA framework への移行、Electron／Tauri 化: 現在必要なのはローカル Host と Unity WebGL の操作であり、配布 runtime や native IPC を増やす要件はない。ブラウザーからの filesystem 操作も引き続き CLI が所有する。
- TanStack Query: project 取得は既存契約では polling、playback の `poll` は進行を伴う POST。今回は controller が順序と取消を一括管理する。[既定の再取得・retry](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults) を別系統で制御する cache を追加する利点が薄い。管理 Web と同じ構成に揃えることを目的にしない。
- XState／Redux と複数の状態管理基盤: 初期版は workspace 内の明示的な遷移関数で扱う。採用する Zustand だけで副作用や順序制御が解決するとは扱わない。
- Router、React Hook Form、全面的な shadcn/ui 取り込み: 単一 workspace と scalar Props に必要な範囲を越える。shadcn/ui は見た目の参考とし、Base UI と Editor 自身の部品を使う。

## アプリケーションアーキテクチャ

### 境界と依存方向

```text
React panels ── intent ──> workspace commands
      ▲                         │
      │ selector                ▼
workspace stores <── snapshot ─ controllers
                                │
                       ┌────────┴────────┐
                       ▼                 ▼
                  Host API port     Preview driver port
                       │                 │
                  fetch adapter     Unity WebGL adapter
                       │                 │
                    CLI Host        Unity WebGL
                       │
              filesystem / build / Core / publish
```

React は表示、入力中の値、focus／pointer 操作を担当する。commands は `saveProps`、`undo`、`selectPreviewChannel`、`inspectCue`、`seekCue`、`publish` 等の意図を受ける。controller が前提の確認、HTTP／Unity の呼び出し、結果の採否と snapshot 更新を所有する。panel は `fetch`、build polling、Unity の `SendMessage` を直接呼ばない。Unity の通知は driver から controller に戻し、controller が Host API を通して表示結果を報告する。

Host が保存 revision、generation、再生 state、発火記録、確認 session、表示成功記録と復旧・公開可否の正本を持つ。ブラウザーは入力 draft、UI 選択、配送中の要求、Host／Unity と照合した表示結果を持つ。Core の進行規則や Unity の補間をブラウザーに再実装しない。

### モジュール構成案

配置先は `app/local-editor/src/`。以下を実装時の具体的な配置案とする。空の層や各 feature の一律な `model/api/ui` テンプレートは作らない。ロジックテストは各層の `tests/` に配置する。実装ファイルの隣に `.test.ts` を置かず、E2E・UI・component test は設けない。表示だけの層に空の `tests/` は作らない。

```text
src/
├── app/
│   ├── main.tsx                    # token 取得・起動
│   └── workspace-provider.tsx      # workspace の参照を React に渡す
├── workspace/
│   ├── create-workspace.ts         # controller・store・adapter の組み立てと破棄
│   ├── commands.ts                 # UI 操作の入口
│   ├── ui-store.ts                 # 閲覧選択・パネル状態・テーマ
│   ├── workspace-shell.tsx         # header／3列／下部／status の配置
│   ├── workspace-header.tsx
│   ├── workspace-status.tsx
│   └── tests/
│       └── commands.test.ts        # feature 間の接続と操作可否
├── project/
│   ├── project-controller.ts       # snapshot 同期・外部更新・保存・Undo/Redo
│   ├── project-store.ts            # snapshot・draft・保存状態・履歴
│   ├── edit-state.ts               # 保存と競合の遷移規則
│   ├── props-inspector.tsx
│   ├── props-field.tsx
│   └── tests/
│       ├── edit-state.test.ts
│       └── project-controller.test.ts
├── preview/
│   ├── preview-controller.ts       # 表示交換と復旧の統括
│   ├── playback-controller.ts      # 再生・入力・シークの直列配送
│   ├── preview-store.ts            # 表示状態・再生状態
│   ├── preview-state.ts            # 状態遷移と通知の採否
│   ├── preview-driver.ts           # Unity 境界の型
│   ├── preview-viewport.tsx        # 固定 canvas の接続・切断
│   ├── playback-controls.tsx
│   └── tests/
│       ├── preview-state.test.ts
│       ├── preview-controller.test.ts
│       └── playback-controller.test.ts
├── publication/
│   ├── publication-controller.ts  # 本番 build・device 認証・固定 Dist 公開
│   ├── publication-store.ts
│   ├── publication-panel.tsx
│   └── tests/
│       └── publication-controller.test.ts
├── flow/
│   ├── flow-model.ts               # 既存の進行構造変換を移植
│   ├── cue-presentation.ts         # 既存の表示変換を移植
│   ├── flow-tree.tsx               # Group / Step / Cue 一覧
│   ├── step-transition-graph.tsx
│   ├── cue-details.tsx
│   └── tests/
│       ├── flow-model.test.ts
│       └── cue-presentation.test.ts
├── timeline/
│   ├── timeline-model.ts          # track・時間座標の導出
│   ├── timeline-panel.tsx
│   ├── timeline-ruler.tsx
│   ├── timeline-track.tsx
│   ├── timeline-playhead.tsx
│   ├── timeline.css
│   └── tests/
│       └── timeline-model.test.ts
├── diagnostics/
│   └── diagnostics-panel.tsx
├── ui/
│   ├── button.tsx                 # Editor 用の薄い部品
│   ├── dialog.tsx
│   ├── tabs.tsx
│   ├── resizable.tsx
│   ├── theme.ts                    # 初期値の解決・明示設定の読書き・DOM 反映
│   ├── tokens.css
│   ├── global.css
│   └── tests/
│       └── theme.test.ts           # 初期値解決・設定値の検証
└── infra/
    ├── host-api.ts                 # fetch・認証・応答検証・AbortSignal
    ├── unity-preview.ts            # browser loader・canvas・Unity 接続の組み立て
    ├── unity-exchange.ts           # 通知照合・waiter・timeout・取消・解放
    └── tests/
        ├── host-api.test.ts
        └── unity-exchange.test.ts  # 通知照合・timeout・終了処理のロジック
```

`workspace` が組み立てを所有し、feature 間の操作はここで接続する。たとえば Props 保存完了から Dev 更新、Preview 確定から公開状態の再評価、Source 更新から選択の再照合を接続する。feature 同士で可変 store を直接書き換えない。`infra` は port の実装を担当し、React や UI 選択を知らない。型だけでよい境界には新しい package や汎用 DI framework を作らない。

### Controller・store・UI の責務

| 担当                                 | 責務                                                                          | 境界                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `create-workspace.ts`／`commands.ts` | 依存の組み立て、UI 操作の振り分け、feature 間の接続、全体の終了               | 保存や再生の業務ルールを再実装しない                                                                       |
| `project-controller.ts`              | project 監視、draft 更新、保存の直列化、競合処理、保存済み履歴の操作          | Dev build は workspace を介して依頼する                                                                    |
| `preview-controller.ts`              | Dev build、channel 切替、prepare／commit／Host 確認、表示の失効、復旧と再構築 | playback controller の開始・停止を統括し、Host の再生 state や復旧判断を同期する                           |
| `playback-controller.ts`             | 通常再生・Cue 確認の命令と poll、シーク集約、Unity 適用結果の照合             | 表示要求の有効期間内だけ動く。故障は preview controller へ渡し、独自の復旧 loop を持たない                 |
| `publication-controller.ts`          | 本番 build と中止、device 認証の polling、明示公開と結果管理                  | Dist 表示は workspace 経由で preview controller に依頼し、公開受付の最終判定は Host が行う                 |
| 各 store                             | controller が確定した snapshot の保持と selector 向けの購読                   | I/O・timer・Unity instance を所有しない。保存・表示の遷移規則は `edit-state.ts`／`preview-state.ts` に置く |
| 各 panel／field                      | snapshot の表示、入力、focus／pointer、commands の呼び出し                    | draft の正本は project controller が所有し、component は入力途中の文字列表現など短命な状態だけを持つ       |
| `infra` の adapter                   | HTTP／Unity の接続、境界検証、取消・通知待ち・接続資源の解放                  | UI 選択や自動再試行・復旧の方針を判断しない                                                                |

Props 保存から Preview 更新までの流れは次の通りとする。

1. Inspector が `commands.saveProps()` を呼ぶ。
2. project controller が基準 revision と draft を検証し、Host API へ保存する。
3. 保存成功後に project snapshot と Undo／Redo 履歴を更新する。
4. workspace が保存済み revision を preview controller に渡す。Dev 選択中だけ自動 build を要求し、Dist 選択中は固定 Dist の表示を維持する。
5. preview controller が Dev build、Unity prepare／commit、Host の表示確認を進める。
6. UI は保存済み revision と表示済み build を別々に示す。表示更新が失敗しても保存を巻き戻さない。

### 状態の所有と寿命

| 状態                                      | 所有者・寿命                                               | 更新規則                                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 保存済み project、diagnostics、revision   | project controller。workspace の接続中                     | 保存応答と外部取得を同じ入口で採用する。revision は不透明な値として扱い、取得開始時の世代で遅延応答を拒否する |
| Props draft、保存状態、Undo／Redo         | project controller。選択 Instance と基準 revision に紐づく | 未保存値を project snapshot に混ぜない。保存は直列、外部変更で履歴を失効し、draft は競合として保持する        |
| 選択 Group／Step／Cue／keyframe／Instance | workspace の UI store                                      | 閲覧用の選択であり、実行位置と分離。snapshot 更新時に存在を照合し、削除済みの選択を解除する                   |
| build／load／表示成功と receipt の写し    | preview controller。channel と要求世代に紐づく             | `savedRevision`、`buildingRevision`、表示 build を分離。成功確定は Unity と Host の確認後だけ                 |
| 通常再生／Cue 確認／復旧の状態            | Host が正本、preview controller が同期                     | request／inspection／sequence と配送世代を照合し、古い通知から復活させない                                    |
| 認証／本番 build／公開処理                | publication controller                                     | device 認証の polling は pending 中だけ。公開は明示操作で Host が receipt と固定 Dist を再検証する            |
| テーマ、パネル寸法・開閉                  | UI 設定。明示設定のみローカル保持                          | token、Source、Props draft、receipt、認証情報、再生 session は永続化しない                                    |
| hover、drag 中の座標、入力 focus          | 対象 component                                             | drag 中の指定時刻と表示成功時刻を別々に表示する。毎 frame の座標を workspace 全体へ配信しない                 |

テーマの実行時状態は `workspace/ui-store.ts` だけが持つ。`ui/theme.ts` はシステム設定からの初期値解決、明示設定のローカル保存・読込、DOM への反映を担い、独自の store は持たない。

store は project、preview、publication、UI の寿命に沿って分け、workspace の Context には生成済みの参照だけを渡す。各 panel は selector で必要な部分だけを購読する。プレイヘッドの更新で Props、左一覧、Unity canvas の全体を再描画しない。Unity instance は workspace 内の固定 viewport に一つだけ保持し、タブ・テーマ・パネル開閉で再生成しない。

保存状態は少なくとも `clean / dirty / saving / conflict / failed` を区別する。保存成功まで履歴を確定せず、結果不明の保存は同じ `commandId`・基準 revision・`expectedIrHash`・command を保ち、既存 Host の再送規則に従う。409 は最新値を勝手に上書きして解決しない。未保存状態で Instance を変更する場合は保存・破棄・取消を選べるようにし、外部変更時も draft を無言で消さない。Props metadata がない場合は draft 自体を生成しない。

Preview の表示交換は `idle / building / preparing / committing / confirming / ready / failed`、復旧は `healthy / restoring / reloadRequired` として表す。前の正常 scene が残る状態と、現在の公開用 receipt が有効な状態は区別する。再生の通常／Cue 確認は別の判別 union にし、復旧中の再生・入力・シーク・公開を commands の入口でも拒否する。UI の disabled 表示だけに依存しない。

### 非同期処理と資源管理

- project 監視、build job、playback 配送、device 認証の各 loop に所有 controller を一つ置く。現行の取得間隔を初期値に使い、React effect ごとに polling を増やさない。playback は HTTP と Unity acknowledgement が完了してから次を送る。
- 保存は直列、Dev build／load は最新要求優先、シークは未送信分を最新の絶対時刻へ集約する。input／publish／認証開始のような副作用を同じ規則で自動再送しない。
- 更新・取消ではまず要求世代を進める。AbortController は通信待ちを止める補助とし、abort 後でも Host の処理が確定し得るため、request identity と revision／sequence の照合を残す。
- build 完了・Unity commit・Host の表示確認は別のイベントとして扱う。成功も失敗も対象 request／sequence に結び付ける。通知期限切れ、適用途中の例外、後続 Unity frame の故障は後述の復旧管理へ渡す。
- `createWorkspace` は HTTP controller 群を所有し、viewport 接続時に driver を登録する。`dispose` は再入可能とし、timer・購読・通信・Unity waiter を解除し、candidate を破棄して Unity を終了する。canvas の接続／切断、開発時の再 mount で二重起動・処分済み store への反映を起こさない。
- HTTP JSON、Unity event は境界で検証する。CLI 所有 schema がブラウザー利用可能なら再利用し、Node 専用依存が混入する場合は CLI の browser-safe contract export を整える。型 assertion だけで成功応答を信用しない。Proto の正本・生成経路は維持する。

### ロジックテストの方針

Local Editor の自動テストはロジックテストだけとし、各層の `tests/*.test.ts` に配置する。E2E、UI、React component の render／DOM 操作／snapshot test は追加・維持しない。表示の確認が必要な場合は手動で行い、ロジックテストの成功を描画や画面配線の検証結果とは扱わない。

| 対象               | 検証する振る舞い                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| workspace commands | 保存成功から Dev 更新への接続、Dist 選択中の表示維持、復旧中の操作拒否、終了時の controller 解放       |
| project            | 保存・競合の遷移、draft 保護、Undo／Redo、同じ command の再試行、外部取得と保存応答の競合              |
| preview            | 最新要求の採否、prepare／commit／Host 確認の順序、直列配送、シーク集約、通知照合、復旧、timeout と取消 |
| publication        | 本番 build の完了・中止、認証 polling の開始・停止、表示記録に応じた操作可否、公開の重複実行防止       |
| flow／timeline     | 進行構造・Cue 表示の変換、track と時間座標、keyframe の選択対象、更新後の選択整合                      |
| UI 設定のロジック  | テーマの初期値解決・保存値の検証。DOM の見た目は対象にしない                                           |
| infra              | HTTP 応答の検証・error 変換、Unity 通知の request／sequence 照合、waiter の timeout・取消・解放        |

controller は Host API／Preview driver の port と時計を test double に置き換え、公開操作から観測できる状態・呼び出し順序を検証する。adapter は fetch・通知・timer 等の境界を差し替える。実ブラウザー・Unity instance をテストから起動せず、DOM の存在を前提にしない。単純な store の getter／setter、ライブラリ自体の動作、実装をなぞるだけのテストは作らない。

Unity adapter では、`unity-preview.ts` が `window`／`document`／canvas と Unity loader の接続を所有し、`unity-exchange.ts` がメッセージ送信・通知購読・時計を引数で受け取って request／sequence 照合、waiter、timeout、取消・解放を扱う。後者はブラウザー API を直接参照せず Node 上で検証する。loader と DOM 配線自体のテストは設けない。

各層専用の fixture／fake はその層の `tests/` に置く。複数層で同じテスト用境界が必要になった場合だけ `src/tests/support/` に集約し、最初から汎用 mock 基盤は作らない。

rewrite 時に既存ロジックテストを各層の `tests/` に移し、UI／component test、`e2e/`、Playwright 設定、`src/test/setup.ts` を削除する。Vitest は `environment: "node"`、対象は `src/**/tests/**/*.test.ts` とし、DOM 用 setup を外す。Local Editor の package scripts・直接依存から E2E と Testing Library／jsdom／Playwright を外し、関連する CI／Nix task／文書の Local Editor 向け呼び出しも整合させる。他アプリのテスト基盤は変更しない。

### 移行の方針

新しい workspace と縦断処理を組み立て、既存回帰条件を新入口で満たしてから `index.html` の entry を切り替える。一時的な開発 entry は許容するが、完成時は起動経路を一つにし、旧 `src/features/editor/` の移植済み実装・CSS・不要テストを削除する。共通の API／driver は移行中も一つの実装にし、新旧 UI が同時に同じ Host／Unity を操作しない。

切り替えの前提は Props の保存・履歴・外部更新、Dev／Dist と固定 Dist 公開、および下記のシーク／復旧が新 controller 経由で通ること。旧 UI に戻せることを完成条件にはしない。新 UI へ移す際に必要な CLI／Core／Unity の差分も同じ振る舞いの縦断試験で確認する。

## 機能の取捨選択

| 現行機能                                                              | 方針                                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Unity Preview、再生／一時停止／リセット、実行可能な入力               | 維持。通常再生の操作としてまとめる                                        |
| Group／Step／Cue の閲覧、遷移図                                       | 維持。左一覧と中央下部の進行図に整理                                      |
| Cue の trigger／guard／actions／遷移先                                | 維持。選択時に右の詳細へ表示                                              |
| Timeline 表示、keyframe 選択、値／easing の参照、ズーム／横スクロール | 維持。中央下部へ配置し、選択 Cue のシークと連動。値やキーの編集は行わない |
| Instance 選択と公開 scalar Props の保存                               | 維持。右の Props 内で対象を選べるようにする                               |
| Transform の入力・保存 UI                                             | 削除。Source の Transform や通常描画、CLI の編集契約自体は削除しない      |
| Undo／Redo、保存再試行、外部保存への追従                              | 維持。Props の操作に整理し、既存の競合検出を保つ                          |
| Dev Preview／Dist Preview、本番 build／中止                           | 維持。開発確認と公開前確認を明示的に分ける                                |
| 公開用認証と表示済み Dist の公開                                      | 維持。公開前確認フローへまとめる                                          |
| Diagnostics、revision／build identity、再読込                         | 維持。問題パネル・状態欄・表示情報へ整理                                  |
| 左端アイコン列、プレゼン全体の秒数軸、Timeline 編集                   | 設けない                                                                  |

Props 編集 metadata のない Source も閲覧・診断・Preview の対象にする。編集不可の理由を表示し、コード制作を妨げない。

## 画面と操作

配置は合意した方向を示す。以下の操作詳細、パネル調整、狭い画面での扱いは実装提案であり、動作確認で調整する。

```text
┌───────────────────────────────────────────────────────────────────┐
│ Project   開発 / 公開前確認     状態     ライト / ダーク     公開  │
├─────────────────┬──────────────────────────────┬──────────────────┤
│ Group / Step    │ Unity Preview                │ 詳細 / Props     │
│   Cue 一覧      │                              │ Cue・キーの詳細  │
│                 │ 通常再生 / Cue 確認          │ Instance 選択    │
│                 ├──────────────────────────────┤ 公開 Props 調整  │
│                 │ 時間軸 / 進行図 / 問題       │                  │
│                 │ 再生操作・時刻・ズーム       │                  │
│                 │ 選択 Cue の Timeline         │                  │
├─────────────────┴──────────────────────────────┴──────────────────┤
│ Source / build / 表示状態                         表示情報         │
└───────────────────────────────────────────────────────────────────┘
```

- 左一覧の選択は閲覧対象を変える操作とし、それだけで Cue を発火しない。実行中の Step／Cue と閲覧選択を区別する。
- 右の詳細は選択した Cue または keyframe に追従する。Props は Instance の選択と公開項目だけを表示する。
- 通常再生と Cue 確認は同じ Preview を使うが、モードを常に表示する。入力ボタンは通常再生中だけ使える。
- 記録のある Cue で「この Cue を確認」を実行すると時間軸が操作可能になる。未記録なら再生・発火が必要な理由を表示する。
- keyframe 選択は詳細を表示し、Cue 確認中であればその時刻へシークする。通常再生や記録のない Cue では表示中の Preview を動かさない。
- 左右パネルは開閉・幅調整、Preview と下部パネルは高さ調整に対応する。狭い画面はパネルを切り替えて使い、Preview の幅を確保する。
- エラー発生と Source／表示の不一致は常時分かるようにする。技術的な ID の全文や診断詳細は必要時に開く。
- 開発 Preview は保存済み Source の自動 build を維持する。未保存の Props を表示済みと扱わない。
- 公開前確認は「本番 build → 固定 Dist を表示確認 → 認証・公開」。Dist Preview の選択だけでは再 build せず、公開も自動実行しない。

### 視覚仕様

VODAI の `frontend/src/app/styles/_editor.css`、layout、共通 Button／Tabs を参照する。以下の値・寸法・テーマ保持方法は実装時の調整基準で、最終値を確定する受け入れ条件ではない。アプリ本体に VODAI への依存やファイルコピー経路を作らない。

| 役割                 | ライト    | ダーク    |
| -------------------- | --------- | --------- |
| 基本背景             | `#f7f8fb` | `#0d0e11` |
| Preview 周辺・操作面 | `#ffffff` | `#15171b` |
| 補助面               | `#eef1f6` | `#1d2026` |
| 主文字               | `#111827` | `#f9fafb` |
| 補助文字             | `#64748b` | `#b5bfce` |
| 境界線               | `#d7deea` | `#313742` |
| 操作アクセント       | `#2190ff` | `#5ba8ff` |

Noto Sans JP 系の本文、時間は等幅・桁揃えとする。ヘッダー48px、パネルタブ36px、時間軸操作バー40px、通常操作32px前後、アイコン14〜16px、小さめの角丸を基準に調整する。タッチでは操作領域を拡大する。文字・選択・フォーカスのコントラストは実際の合成背景で確認する。

テーマは初回にシステム設定を使い、明示選択をローカルに保持する。UI テーマの変更で Unity の scene の色や保存済み Source は変えない。

## Cue 単位シークの初期仕様

以下は今回の合意を実装可能にするための採用案。既存機能ではなく、追加実装が必要。

### 記録と時間の基準

- 通常再生で実際に受理された Cue の発火を記録する。閲覧選択や入力候補の試行評価では記録しない。
- `requestId` と build に紐づけ、Group／Step／Cue、Step entry、発火 occurrence を識別する。Cue ID だけで記録を照合しない。
- 各 Cue について最新の発火記録だけを保持し、履歴一覧は作らない。通常再生のリセット、Preview の再 load／無効化、Dev／Dist 切り替えで破棄する。
- 0ms は「その Cue の actions 適用後、次 Step／Group への遷移前」。Core でこの境界を取得し、通常再生の遷移結果から逆算しない。
- シーク範囲は、その Cue が開始する描画 Run（Timeline／Surface 遷移）の最長 duration まで。Surface 遷移も時間軸上で識別できるようにする。時間を持つ Run がなければ0msの状態確認のみとし、シーク操作は無効にする。
- Group exit を伴う Cue も遷移前の状態として確認する。これは通常再生での遷移後の表示を再現するモードではないことを表示する。

### 通常再生との分離

- Cue 確認に入る時点の通常再生 state と時計を退避し、一時停止する。確認操作で本来の入力履歴、消費済み Cue、variables、Step、通常再生時計を変更しない。
- 確認専用 state に記録済み actions／node／surface／active runs を使い、時計を `Cue 発火時刻 + offset` にする。戻るシークごとに同じ記録から再評価する。
- 発火時に既に走っていた Run を含め、描画対象の active runs を共通時計で評価する。選択 Timeline だけをずらして crossfade や他 Run と時間を不整合にしない。
- 確認中は timer、completion による後続 Cue と Step／Group 遷移を実行しない。blocking／nonBlocking は表示するが、確認中の進行を発生させない。
- 確認中の「再生」はこの範囲だけを進め、終端で一時停止して terminal pose を保持する。「0秒へ」は発火時に戻す。
- 「通常再生に戻る」で退避した位置を復元し、一時停止で戻る。再開は明示操作とする。

### 更新・競合・Dist

- 表示 build と時間軸の definition が一致するときだけ確認を開始できる。Source 更新で一致しなくなった選択はシーク不可とし、現在表示している build を明示する。
- Dev は表示 revision と保存 revision を照合する。Dist は現在の Source と同一と推測しない。初期版は一致を検証できる場合だけ時間軸を連動させ、検証できなければ Dist の通常再生・公開確認を継続し、Cue 確認を無効にする。
- シーク要求は絶対時刻とし、未送信の中間要求を最新のものへまとめる。古い request／確認 session／選択の応答を UI と Unity に適用しない。
- 指定時刻と実際に表示完了した時刻を区別し、Unity の適用成功通知で request／sequence を確認するまで表示成功としない。HTTP での state 取得成功だけでは表示成功としない。
- 入力検証で適用前に拒否された場合と、適用途中の失敗・表示結果不明を分ける。後者では直前の正常表示が保たれていると保証せず、下記の復旧手順へ移る。
- Cue 確認では Source、`dist`、公開対象を変更しない。公開は引き続き現在の固定 Dist と表示 commit の一致を Host が検証する。

### 例外時の復旧手順

復旧は「同じ scene への正常 state 再適用」と「新しい request での scene 再構築」に分ける。再適用で壊れた描画資源まで直るとは扱わない。

1. **直前の表示成功を保持する。** Host は Unity の成功通知と照合できた state・clock・active runs、表示時刻、request／build／確認 session／sequence を保持する。退避した通常再生 state とは分け、未確認の要求で上書きしない。配送 sequence の採番と表示成功の記録を分離し、復元時も消費済み sequence を戻さない。
2. **失敗を検出し、復旧中へ移る。** 現在有効な request の playback 適用、復元、後続の Unity 更新で、部分適用を伴う失敗・例外や結果不明を同じ復旧管理へ渡す。成功通知が期限内に得られない場合も結果不明として扱う。古い request／sequence の拒否は破棄し、最新要求の入力検証拒否は診断として扱い、これらだけで復旧を起動しない。描画資源の喪失など scene の健全性を失った失敗は、適用前の拒否でも復旧対象とする。通知は対象 request／sequence と照合し、Host に適用結果を伝える契約を縦断実装で定義する。復旧中は再生・入力・シーク・公開を停止し、保留シークを破棄する。部分更新された Preview を正常表示として見せず、エラー表示で覆う。
3. **正常 state の再適用を一度試す。** 有効な同一 request／build の表示成功記録がある場合だけ、その state を一時停止の clock と新しい sequence で適用する。Cue の actions や通常再生の入力は再実行しない。復旧中は Unity 側の通常更新も停止し、再適用後の成功通知を待つ。利用可能な記録がなければ再読込が必要な状態へ進む。
4. **成功確認後に Host と同期する。** 復元対象の request／session／sequence に一致する成功通知と Host の照合が完了したら「復元済み」とし、一時停止で操作を戻す。Host の確認 offset と表示成功 state を復元先に合わせ、退避した通常再生 state は変更しない。失敗したシークは自動再送しない。表示時刻は復元した時刻を示し、通常再生への復帰と再開はそれぞれ明示操作にする。
5. **復元不能なら再構築へ切り替える。** 復元の失敗・例外・通知期限切れでは、Host が旧 request の表示 receipt、確認 session、発火記録、保留要求を無効化し、「再読込が必要」とする。再読込操作で新しい request の prepare／commit と初期 playback 適用を確認し、通常再生の一時停止状態で戻す。再構築後の確認位置への自動復帰は初期版に含めない。再構築にも失敗した場合は無効な状態を保ち、無制限に再試行しない。

復旧中の表示 receipt は確認待ちとし、公開判定に利用しない。同じ scene の復元成功時のみ Host が再確認でき、復元不能時は旧 receipt を失効する。UI は回復可能な失敗だけで独自に `requestId` を破棄せず、Host の復旧状態に追従する。再構築へ進んだ場合は、新 request の成功が確認できるまで表示正常・公開可能と扱わない。

復旧中の Source 更新、再 load、Dev／Dist 切り替えは旧復旧処理を失効させ、新しい request を優先する。古い要求・通知・復旧完了で新しい表示や公開可否を変更しない。表示成功を待つ期限と失敗理由はテスト可能な形で定義し、通常の入力を自動再送して回復を試みない。

## 実装境界と契約

| 所有者                            | 変更内容                                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app/local-editor`                | ワークスペース、テーマ、選択、Props、状態表示、確認操作。Unity の適用結果の橋渡しと復旧中の操作制限。表示と非同期制御を分ける                                                                    |
| `packages/unframe-core`           | 実発火境界の opt-in capture。seek／時計巻き戻しを本番 Runtime の操作として追加しない                                                                                                             |
| `packages/unframe-cli/src/author` | 発火記録と確認 session の保持、コマンド検証、通常再生の退避・復帰、wire state への投影。表示成功 state・復旧状態・表示 receipt の管理と失効                                                      |
| `packages/contracts`              | Preview wire で不足する場合だけ正本 proto を変更し、関連生成物と drift check を同期                                                                                                              |
| `app/unity`                       | 既存の Preview playback state／clock 適用経路で前後シークと復帰を保証する。適用・更新の例外を捕捉し、故障後の更新停止、復元適用、新 request の再構築と結果通知を扱う。Preview 専用の差分だけ追加 |

UI 部品は Local Editor が所有し、前述の技術構成を使って新しく作る。`app/web/src/shared/ui` は Base UI の利用例として参照するが、共有 UI package の新設や Web の内部 import は行わない。Tailwind は Editor の token と部品の実装に使い、VODAI のファイルや Next.js／Radix 構成をコピーしない。

### Preview HTTP 契約の拡張案

既存の `POST /api/preview-playback`、Bearer／Origin 検証、strict な Zod schema、`{ code, message }` エラーを維持する。追加操作はこの契約の discriminated union にまとめ、新しい公開 API は作らない。

| command 案        | 追加フィールド                     | 挙動                                      |
| ----------------- | ---------------------------------- | ----------------------------------------- |
| `inspectCue`      | `occurrenceId`, `inspectionId`     | 記録を検証し、通常再生を退避して0msへ移る |
| `seekCue`         | `inspectionId`, `timeMilliseconds` | 確認 session の絶対時刻を表示する         |
| `leaveInspection` | `inspectionId`                     | 退避した通常再生へ一時停止で戻る          |

全要求に既存の `requestId` が必要。これは load／commit／playback を結び付ける表示要求 ID で、各 command の冪等性キーではない。`inspectionId` はブラウザーが確認開始時に発行する不透明な確認 session ID とし、`inspectCue` の再送では同じ値を使う。Host は `(requestId, inspectionId)` を開始処理の重複判定に使い、同じ occurrence の重複開始は退避・発火を再実行せず、別 occurrence への同一キー利用は拒否する。確認の終了・失効後も当該 request が有効な間は終了済み ID を識別し、古い開始要求で確認を再開しない。`seekCue` の同じ絶対時刻は重複しても実行結果を変えない。`leaveInspection` の重複は通常再生位置を再変更しない。

応答は既存 playback state に加えて、通常／Cue 確認の mode、確認 ID、選択 occurrence、現在 offset／duration、利用可能な発火記録の識別情報を返す。checkpoint 全体は Host 内に保持しブラウザーへ渡さない。`poll`／`play`／`pause` は mode ごとに意味を固定し、既存 `reset` は通常再生用のままとする。Cue 確認の0秒戻しは `seekCue(0)` を使う。

時刻は有限の安全な非負整数 ms、duration 以下に制限し、範囲外を暗黙 clamp しない。不正 schema／時刻は400、失効した request／記録／確認 ID や未記録 Cue は409、認証・Origin 不備は既存401／403。成功は200とし、409は自動再送で解決しない。通常再生の入力／再生開始を無条件再送しない。

Unity の state 配送には既存の完全な `LocalPreviewPlaybackState` を使う。検証した正常系に wire 拡張は不要。時計が戻っても配送 sequence は増加させ、復元にも新しい sequence を使う。適用結果・復旧状態の通知契約は別途定義し、不足が判明した場合だけ正本の契約と関連生成物を変更する。生成ファイルを手編集しない。

## 実装順序と検証

各単位でロジックの観測可能な振る舞いを Red → Green → Refactor で実装する。自動テストは前述の各層の `tests/` に限定し、E2E・UI・component test は完了条件に含めない。CLI／Core／Unity のロジックを変更する場合は、それぞれの既存配置・実行基盤で影響範囲のロジックテストを行う。

1. **workspace の骨格と既存フローを通す。** ports、store、controller、commands と新 entry を作る。project 取得→Props 保存→Dev build→Unity 表示確認を新しい入口で通し、外部更新との競合と取消・dispose を検証する。UI primitive／token／分割パネルの小さな実画面で、技術構成と固定 Browser／CSP の適合も確認する。
2. **実発火記録を取得する。** Core の actions 適用後・遷移前 capture と CLI の occurrence 管理を実装し、Group exit を含む発火境界を確認する。隔離 probe で未実装のこの経路を既存機能と扱わない。
3. **シークと復旧を縦断実装する。** 新 preview controller 経由で `0 → 中間 → 終端 → 中間 → 0 → 通常再生へ復帰` を通す。CLI 投影、bridge、Unity 適用・後続更新の結果通知、Host の表示成功記録を接続する。一時故障からの再適用と、永続故障からの receipt 失効・新 request 再構築を確認する。UI 全面変更前にこの経路を成立させる。
4. **workspace の UI と全操作を組み直す。** ヘッダー、左一覧、中央 Preview／下部パネル、右詳細／Props、テーマと開閉・サイズ調整を作る。保存／Undo／Redo／再試行、通常再生、Dist build／中止、認証／公開を各 controller へ接続する。公開パネルから独自 polling を除き、Transform UI を撤去する。
5. **Cue 確認 UI と競合表示を統合する。** 発火記録の利用可否、モード切替、シーク／確認再生／復帰、keyframe 連動を接続する。指定時刻と表示成功時刻、Source と表示 build の違い、復旧状態と操作制限を表示する。
6. **entry を切り替え、旧実装を削除する。** 既存回帰条件と新しい受け入れ条件を満たしたら正式 entry を新 workspace に切り替える。移植済みコード、旧 CSS、UI／component test・E2E とその設定・専用依存を削除し、Vitest・CI／Nix task をロジックテストだけの構成に整えて、二重 controller／polling／Unity instance がないことを確認する。
7. **ロジックの検証と文書を整合させる。** 保存→表示要求→Cue 確認→前後シーク→復帰と固定 Dist 公開条件を controller と Host のロジックテストで確認する。`LOCAL_EDITOR_DESIGN.md`、`LOCAL_EDITOR_TIMELINE_SPEC.md`、README を実装後の所有境界・操作・技術構成に合わせる。構成図の変更だけを完成扱いにしない。

各単位はその振る舞いの実装・検証をまとめて行い、画面だけ先に全置換しない。書き換え対象の現行ファイルは前述の対応表を使い、新規実装はモジュール構成案へ置く。CLI の `preview-contract.ts`／`local-playback.ts`／`local-preview.ts`／`playback-wire.ts`、Core の `runtime/cue-executor.ts`、Unity の `PresentationPreviewTransaction`／`PresentationPlaybackPlayer`／Timeline 評価部分は必要な縦断拡張の対象とする。

### 必須の確認ケース

- Core: accepted Cue のみ記録、候補評価／guard拒否で記録しない。手動／timer／completion、repeatable、複数 Timeline、blocking／nonBlocking、Group exit の発火境界。
- CLI: 最新 occurrence、0msと終端、前後シーク、同じ Cue の再発火、確認中に後続進行しない、退避と一時停止復帰、reset／load失効、再送、異なる確認 ID／範囲外時刻。
- Unity の変更ロジック: Run の時刻評価・状態適用順序、sequence と request の拒否、更新停止・復旧通知の規則。実描画の自動試験は本計画の必須条件に含めない。
- Controller: 保存／外部取得の競合、保存失敗と同一要求の再試行、Undo／Redo の revision、dirty draft の保護、取消後の遅延結果、dispose／再生成、単一 polling／driver 接続、復旧中の command 拒否。
- Flow／Timeline: 選択の照合、未記録 Cue の操作可否、keyframe とシーク時刻の対応、時間座標の変換。
- Infra: schema 不正、HTTP error、古い通知の破棄、通知期限切れ、取消と終了後の通知無効化。

### 復旧の受け入れ条件

以下の制御規則を UI 全面変更前に controller／Host のロジックテストで確認する。driver の成功・部分適用失敗・永続故障・通知欠落を test double から返し、状態遷移、命令、receipt の扱いを検証する。これは実 Unity の描画資源が復元できることやエラー表示の見た目を保証する試験ではない。

| ケース                 | 必須の結果                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 適用前の入力検証拒否   | scene と表示成功記録を変更せず、未適用の時刻を表示成功として記録しない。古い request／sequence は破棄し、最新要求の不正入力は診断とする。これらだけで正常な scene の復旧を起動しない |
| 描画資源の喪失         | 適用前の検出でも入力不正と混同せず、表示を正常扱いしない。復旧経路を通し、再適用不能なら新 request の再構築へ進む                                                                    |
| 一時故障による部分更新 | 正常 state を新 sequence で再適用し、node／surface／active runs／clock を復元する。対応する成功通知と Host 同期後に一時停止で戻る                                                    |
| 永続故障               | driver から部分適用失敗と復元失敗を通知させる。Host の旧 receipt／session／発火記録を失効し、新 request の prepare／commit・初期適用成功で回復する。旧確認位置へ自動復帰しない       |
| 復元・後続更新の例外   | 通常適用の例外と同じ復旧管理へ移り、故障した scene を更新し続けない。復元の例外は再読込が必要な状態へ進む                                                                            |
| 成功通知の欠落・遅延   | 期限切れを表示成功とせず、復旧段階に応じて再適用または再読込へ進む。遅れた失敗前の成功通知で復旧状態を解除しない                                                                     |
| 復旧中の操作と公開     | 再生／入力／シーク／公開を停止し、部分更新された画面を正常表示としない。適用成功未確認の state や receipt で公開を許可しない                                                         |
| 競合・再構築失敗       | 復旧中の Source 更新・再 load・Dev／Dist 切り替え後、旧 request／session／sequence の通知や保留要求が新表示を変更しない。再構築失敗でも無効状態を保ち、無限再試行しない              |

### コマンドと完了条件

Nix 環境内で、影響範囲に絞って実行する。Local Editor の `test` と `nix run .#local-editor` は、前述のロジックテスト専用構成への移行後に利用する。以下は今後の実装に対するチェック候補。既に実行した限定テストと未検証範囲は検証記録に分けて記載しており、この一覧全体が実行済みという意味ではない。

```bash
nix run .#local-editor
pnpm --filter @unframe/unframe-core test test/cue-executor.test.ts
pnpm --filter @unframe/unframe-cli test test/local-playback.test.ts test/local-preview.test.ts test/author-http.test.ts
pnpm --filter @unframe/unframe-cli typecheck
pnpm --filter @unframe/unframe-core typecheck
nix develop --command bash scripts/unity/test-native-editor.sh playback
```

wire を変更した場合は contracts の該当生成タスク、`pnpm --filter @unframe/contracts check`、`nix run .#unity-proto` と `nix run .#unity-proto -- check` を実行する。`LOCAL_EDITOR_DESIGN.md`、`LOCAL_EDITOR_TIMELINE_SPEC.md`、Local Editor README を実装と整合させる。

リポジトリ全体のテスト・build は CI に任せる。全体テスト・build を含む `nix run .#check` はローカルの代替検証に使わない。Unity のロジックを変更した場合だけ上記の Unity テストを実行し、license 等の前提で実行できなければ未実施理由を記録する。

各層の `tests/` で関連ロジックが検証され、E2E・UI・component test の旧設定と実行経路が除去され、関連チェックと最終差分を確認して完了とする。画面の手動確認を行った場合は、自動テストと分けて記録する。コミット・push は別途指示がある場合に行う。
