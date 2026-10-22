# Local Editor の Preview 中心 UI 再構成

状態: 実装前の計画。2026-10-22 時点の実装と UI 検討に基づく。
作業ブランチ: `refactor/local-editor-ui-ux`。起点は `origin/main` の `a5f57c0`。

成立性の検証結果は [Cue 単位シークの初期検証](local-editor-cue-seek-validation.md) を参照。既存 Unity 試験10件と追加 probe 5件で、既存 wire による前後移動・一時停止・複数 Run／crossfade の状態適用を確認した。適用途中の例外では状態と sequence が部分更新され、新しい sequence での再送だけでは復旧しない故障も再現した。以下の復旧処理と統合シークは未実装であり、EditMode の結果は UI／HTTP 統合や実 WebGL／Quest の描画確認を代替しない。

## 目的と合意した範囲

コードで制作したプレゼンの表示・動き・進行を確認する画面にする。編集は公開 Props の調整に絞る。

- VODAI のエディターを参考に、shadcn/ui を意識したコンパクトな操作部、細い境界線、ニュートラルな色面にする。
- 左端のアイコン列は設けない。左の Group／Step／Cue 一覧は残す。
- 中央に Unity Preview、その直下に時間軸と再生操作、右に選択項目の詳細と公開 Props を置く。
- ヘッダーにライト／ダーク切り替え、開発 Preview／公開前確認の切り替え、公開導線を置く。
- 選んだ Cue の発火を0秒とするシークを新設する。プレゼン全体の総時間や任意 Step へのジャンプは対象外。

VODAI は外観・寸法・配置の参照とし、メディア管理、チャット、動画編集機能は持ち込まない。LP の色より VODAI のエディター用配色を優先する。

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

UI 部品は Local Editor が所有する。既存 React／CSS と `app/web/src/shared/ui` の Base UI 採用例を確認し、必要な primitive とアイコンだけを Local Editor の直接依存として選ぶ。共有 UI package の新設や Web からの内部 import は行わない。shadcn/ui の見た目を再現することと、VODAI の Next.js／Radix／Tailwind 構成を導入することは分ける。

### Preview HTTP 契約の拡張案

既存の `POST /api/preview-playback`、Bearer／Origin 検証、strict な Zod schema、`{ code, message }` エラーを維持する。追加操作はこの契約の discriminated union にまとめ、新しい公開 API は作らない。

| command 案        | 追加フィールド                     | 挙動                                      |
| ----------------- | ---------------------------------- | ----------------------------------------- |
| `inspectCue`      | `occurrenceId`, `inspectionId`     | 記録を検証し、通常再生を退避して0msへ移る |
| `seekCue`         | `inspectionId`, `timeMilliseconds` | 確認 session の絶対時刻を表示する         |
| `leaveInspection` | `inspectionId`                     | 退避した通常再生へ一時停止で戻る          |

全要求に既存の `requestId` が必要。確認 ID は不透明な識別子とし、同じ開始 ID の再送は同じ開始処理として扱う。別 occurrence の同一 ID 利用は拒否する。確認の終了・失効後に古い開始要求を再送して確認を再開しない。`seekCue` の同じ絶対時刻は重複しても実行結果を変えない。`leaveInspection` の重複は通常再生位置を再変更しない。

応答は既存 playback state に加えて、通常／Cue 確認の mode、確認 ID、選択 occurrence、現在 offset／duration、利用可能な発火記録の識別情報を返す。checkpoint 全体は Host 内に保持しブラウザーへ渡さない。`poll`／`play`／`pause` は mode ごとに意味を固定し、既存 `reset` は通常再生用のままとする。Cue 確認の0秒戻しは `seekCue(0)` を使う。

時刻は有限の安全な非負整数 ms、duration 以下に制限し、範囲外を暗黙 clamp しない。不正 schema／時刻は400、失効した request／記録／確認 ID や未記録 Cue は409、認証・Origin 不備は既存401／403。成功は200とし、409は自動再送で解決しない。通常再生の入力／再生開始を無条件再送しない。

Unity の state 配送には既存の完全な `LocalPreviewPlaybackState` を使う。検証した正常系に wire 拡張は不要。時計が戻っても配送 sequence は増加させ、復元にも新しい sequence を使う。適用結果・復旧状態の通知契約は別途定義し、不足が判明した場合だけ正本の契約と関連生成物を変更する。生成ファイルを手編集しない。

## 実装順序と検証

各単位で観測可能な振る舞いを Red → Green → Refactor で実装する。UI の主要フローは E2E、独立した状態・業務ルールは unit、Unity の描画適用は EditMode／実 WebGL で確認する。

1. **実発火記録を取得する。** Core の actions 適用後・遷移前 capture と CLI の occurrence 管理を実装し、Group exit を含む発火境界を確認する。隔離 probe で未実装のこの経路を既存機能と扱わない。
2. **シークと復旧を縦断実装する。** 一つの実発火記録から `0 → 中間 → 終端 → 中間 → 0 → 通常再生へ復帰` を通す。CLI 投影、bridge、Unity の state 適用・結果通知、Host の表示成功記録を接続する。一時故障からの再適用復元と、永続故障からの receipt 失効・新 request 再構築を必須条件にする。後続更新の例外と古い通知も含め、UI 全面変更前に復旧経路を成立させる。
3. **UI 基盤と構成を置き換える。** テーマ、ヘッダー、左一覧、中央 Preview／下部パネル、右詳細／Props、開閉・サイズ調整を作る。Transform UI を除去し、Props 保存と履歴、通常再生、build／公開を新配置へ接続する。
4. **Cue 確認を統合する。** 発火記録の利用可否、モード切替、シーク／確認再生／復帰、keyframe 連動、要求の集約と古い応答の破棄を接続する。復旧状態と操作制限、公開前確認と表示不一致を扱う。
5. **回帰確認と文書更新を行う。** 現行仕様文書の「Preview を変えない閲覧専用時間軸」を新しいモード仕様へ更新し、README の操作手順を合わせる。構成図の変更だけを完成扱いにしない。

主な対象は `editor-app.tsx`／CSS、`timeline-panel.tsx`、`cue-timeline.tsx`、`publication-panel.tsx`、`model/preview-playback.ts`、`preview-session.ts`、CLI の `preview-contract.ts`／`local-playback.ts`／`local-preview.ts`／`playback-wire.ts`、Core の `runtime/cue-executor.ts`、Unity の `PresentationPreviewTransaction`／`PresentationPlaybackPlayer`／Timeline 評価部分。

### 必須の確認ケース

- Core: accepted Cue のみ記録、候補評価／guard拒否で記録しない。手動／timer／completion、repeatable、複数 Timeline、blocking／nonBlocking、Group exit の発火境界。
- CLI: 最新 occurrence、0msと終端、前後シーク、同じ Cue の再発火、確認中に後続進行しない、退避と一時停止復帰、reset／load失効、再送、異なる確認 ID／範囲外時刻。
- Unity: 同じ Run ID の前後移動、terminal pose 後の巻き戻し、複数 Run／crossfade／surface状態、sequence と request の拒否、通常再生への復帰、適用失敗時の正常 state 復元と新 sequence による再試行。静的 check の成功で代替しない。
- UI E2E: アイコン列なしで Group／Step／Cue 選択、公開 Props のみ編集・保存／Undo／Redo、未保存表示、テーマ保持、パネル調整、未記録 Cue、キーとシーク連動、連続ドラッグ中の古い応答、Source更新／表示不一致、回復可能なシーク失敗と復元不能時の表示 receipt 無効化、診断、公開前確認。
- 実 WebGL: 合成 fixture の成功と分け、保存→Preview更新→Cue発火→前後シーク→復帰、Dist表示と公開条件が維持されることを確認する。

### 復旧の受け入れ条件

以下を UI 全面変更前の縦断試験に含め、UI 統合後も操作制限と表示を E2E で確認する。故障を再現する試験と、復旧が成功する試験を区別する。

| ケース                 | 必須の結果                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 適用前の入力検証拒否   | scene と表示成功記録を変更せず、未適用の時刻を表示成功として記録しない。古い request／sequence は破棄し、最新要求の不正入力は診断とする。これらだけで正常な scene の復旧を起動しない |
| 描画資源の喪失         | 適用前の検出でも入力不正と混同せず、表示を正常扱いしない。復旧経路を通し、再適用不能なら新 request の再構築へ進む                                                                    |
| 一時故障による部分更新 | 正常 state を新 sequence で再適用し、node／surface／active runs／clock を復元する。対応する成功通知と Host 同期後に一時停止で戻る                                                    |
| 永続故障               | `MeshRenderer` 破棄等で部分更新と復元失敗を再現。Host の旧 receipt／session／発火記録を失効し、新 request の prepare／commit・初期適用成功で回復する。旧確認位置へ自動復帰しない     |
| 復元・後続更新の例外   | 通常適用の例外と同じ復旧管理へ移り、故障した scene を更新し続けない。復元の例外は再読込が必要な状態へ進む                                                                            |
| 成功通知の欠落・遅延   | 期限切れを表示成功とせず、復旧段階に応じて再適用または再読込へ進む。遅れた失敗前の成功通知で復旧状態を解除しない                                                                     |
| 復旧中の操作と公開     | 再生／入力／シーク／公開を停止し、部分更新された画面を正常表示としない。適用成功未確認の state や receipt で公開を許可しない                                                         |
| 競合・再構築失敗       | 復旧中の Source 更新・再 load・Dev／Dist 切り替え後、旧 request／session／sequence の通知や保留要求が新表示を変更しない。再構築失敗でも無効状態を保ち、無限再試行しない              |

### コマンドと完了条件

Nix 環境内で、影響範囲に絞って実行する。以下は今後の実装に対するチェック候補。既に実行した限定テストと未検証範囲は検証記録に分けて記載しており、この一覧全体が実行済みという意味ではない。

```bash
nix run .#local-editor
pnpm --filter @unframe/local-editor test:e2e
pnpm --filter @unframe/unframe-core test test/cue-executor.test.ts
pnpm --filter @unframe/unframe-cli test test/local-playback.test.ts test/local-preview.test.ts test/author-http.test.ts
pnpm --filter @unframe/unframe-cli typecheck
pnpm --filter @unframe/unframe-core typecheck
nix develop --command bash scripts/unity/test-native-editor.sh playback
nix run .#unity-preview
UNFRAME_REAL_WEBGL=1 pnpm --filter @unframe/local-editor test:e2e
```

wire を変更した場合は contracts の該当生成タスク、`pnpm --filter @unframe/contracts check`、`nix run .#unity-proto` と `nix run .#unity-proto -- check` を実行する。`LOCAL_EDITOR_DESIGN.md`、`LOCAL_EDITOR_TIMELINE_SPEC.md`、Local Editor README を実装と整合させる。

リポジトリ全体のテスト・build は CI に任せる。全体テスト・build を含む `nix run .#check` はローカルの代替検証に使わない。Unity license／WebGL player 等の前提で実行できない検証は、未実施理由と残る受け入れ条件を記録する。

上記の動作と関連チェック、キーボード操作、ライト／ダーク両方の表示、狭い画面、最終差分を確認して完了とする。コミット・push は別途指示がある場合に行う。
