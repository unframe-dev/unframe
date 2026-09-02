# Presentation Surface 描画方式の比較条件

- **Status**: Working baseline（Issue #73 / #76 の確定後に承認する）
- **Date**: 2026-09-02
- **Scope**: 2026 年 11 月の MR プレゼンで使用する Presentation Surface
- **Related**:
  - [Issue #73: 発表の絵コンテ v0](https://github.com/unframe-dev/unframe/issues/73)
  - [Issue #74: Web と Unity の UI 統一方式の比較条件](https://github.com/unframe-dev/unframe/issues/74)
  - [Issue #76: 実機デモの制約と必要な MR 表現](https://github.com/unframe-dev/unframe/issues/76)
  - [Issue #77: UI 表現方式の決定](https://github.com/unframe-dev/unframe/issues/77)
  - [Issue #78: UI 統一方式の実機 PoC](https://github.com/unframe-dev/unframe/issues/78)
  - [Presentation Architecture](./ARCHITECTURE.md)
  - [ADR-0006](../decisions/0006-presentation-rendering-strategy.md)
  - [ADR-0012](../decisions/0012-texture-budget-residency-contract.md)

## 1. 目的

この文書は、baked-web、Video、native-ui、embedded-web を同じ要件と測定条件で比較し、Issue #77 で採用範囲と fallback を決めるための判定手順を定義する。方式の採用結果はここでは決めない。

比較対象は Presentation 内に配置する Surface である。Web Editor、設定画面、インスペクターなど Unframe 自身の操作 UI は対象外とする。Surface の移動、回転、拡縮、表示、opacity など Spatial Node の演出は Unity Timeline の責務として各方式から分離する。

## 2. 比較を始める前に固定する入力

Issue #73 と #76 の担当者は、次を一つの PoC profile として確定する。未確定欄が一つでもあれば性能の採否判定を行わず、測定結果を参考値として扱う。

| 入力               | 必須内容                                                                                                                                         | 現状               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| 代表 Surface       | 絵コンテ上の scene、内容、状態、遷移、表示時間                                                                                                   | #73 の確定待ち     |
| 直接入力           | なし、pointer click、その他のいずれか。例外は scene と目的を特定する                                                                             | 現時点では原則なし |
| 変更起点           | Cue、Timeline、Shared Runtime State、Participant Runtime View のいずれか。client-local state は共有進行に影響しない local overlay などに限定する | #73 の確定待ち     |
| State 系列         | State ID、Cue、cut / crossfade、duration、easing、発火時刻                                                                                       | #73 の確定待ち     |
| Runtime 値         | 値の型、値系列、範囲、更新時刻、最大更新頻度、表示形式、authority                                                                                | #73 の確定待ち     |
| internal animation | 不要、事前生成可能、実行時に必要のいずれか。必要な場合は duration、easing、loop、開始基準時刻を固定する                                          | #73 の確定待ち     |
| 同期要件           | state、animation 開始時刻、連続値のうち同期する対象と許容差                                                                                      | #76 の確定待ち     |
| 対象端末           | Quest 機種、OS、Unity / XR package、build type、Graphics API、refresh rate、passthrough 設定                                                     | #76 の確定待ち     |
| 負荷条件           | 同時表示 Surface 数、logical size、render resolution、表示 State 数                                                                              | #76 の確定待ち     |
| 稼働条件           | cold / warm start、連続稼働時間、pause / resume 回数、再接続回数                                                                                 | #76 の確定待ち     |
| resource 上限      | application CPU / GPU frame time、dropped frame、RAM、GPU texture、storage、起動 / 更新 / 復旧時間                                               | #76 の確定待ち     |
| 実行条件           | offline 要否、許可する network access、bundle integrity の検証方法                                                                               | #76 の確定待ち     |
| Web capability     | Canvas、WebGL、WebAssembly の必要有無と使用する代表処理                                                                                          | #73 の確定待ち     |
| visual 基準        | reference Browser / version、viewport、DPR、font、locale、timezone、color scheme、pixel / color 差分と SSIM の閾値                               | #76 の確定待ち     |

参考情報として、現時点の絵コンテ WIP では通常のパネル表示、パネルを消して text だけを見せる場面、要素を上下・左右・奥行き方向へ動かす演出、3D model への切り替え、audience ごとの個別表示を確認できる。3D model は Surface 描画方式の比較対象外である。Surface 内の scroll、form 入力、任意 Web data の表示、Canvas / WebGL / WebAssembly の必要性は確認できていない。

## 3. 候補方式の責務

| 方式         | Surface 内容                                          | 実行時に Surface 内で動くもの                            | Unity の責務                                                     |
| ------------ | ----------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| baked-web    | 固定 Browser で State ごとに事前描画した Texture      | なし                                                     | State に対応する Texture の選択と Spatial / transition 演出      |
| Video        | 事前に確定した連続演出を動画化した artifact           | 動画 decode / playback                                   | 再生時刻、loop、Spatial 配置、必要なら音声同期                   |
| native-ui    | portable plan から Unity が生成する限定 UI            | timer、短い text など許可済み binding                    | plan の検証、描画、値の formatting、時刻追従                     |
| embedded-web | 配布済み HTML / CSS / JavaScript / WebAssembly bundle | Web runtime 内の DOM、CSS animation、script、Canvas など | Web runtime、Texture 転送、lifecycle、sandbox、入力・時刻 bridge |

embedded-web は現行の標準 renderer と Presentation contract に含まれない。採用する場合は、Issue #77 で既存 ADR の変更、artifact / capability / integrity contract、Unity adapter、runtime bridge の責務を明示する。PoC のための実装を既存 contract に暗黙追加しない。

### 3.1 現行実装、Target、PoC の境界

| 方式         | 現行実装                                                                    | Target contract                                                                           | Issue #78 の実装                                                          |
| ------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| baked-web    | Local Compiler の固定 Browser capture と baked-web RenderBundle 初期 subset | ADR-0012 の exactly-one 2K PNG、budget、Delivery / Unity residency。M3〜M5 の接続は未実装 | 現行 Compiler artifact を standalone Unity scene で表示して測定する       |
| Video        | 旧 Unity importer に Video loader はあるが target runtime へ未接続          | Video artifact は設計のみ。v1 Delivery は非対応                                           | 同じ fixture を事前生成し、選んだ Unity playback 経路を明記して測定する   |
| native-ui    | target plan / Unity adapter とも未実装                                      | 一行 text、timer などの portable subset は設計のみ                                        | fixture に必要な最小 plan と renderer を PoC 内に閉じて測定する           |
| embedded-web | Web runtime package、artifact、bridge とも未実装                            | 現行標準 renderer の対象外                                                                | 候補 runtime を一つに固定し、version と license を記録した隔離 PoC とする |

ADR-0012 の値は現行 schema がすべて実装済みであることを意味せず、採用判定に使う Target の hard gate として扱う。PoC 専用コードが target contract や end-to-end Delivery / Realtime の成立を証明したとは扱わない。

## 4. 比較表

この表の「適用範囲」は初期仮説であり、Issue #78 の結果で更新する。

比較結果を割り当てる Surface class は `updateModel × interaction × internalAnimation × runtime value source × required Web capability` の組で表す。各軸は現行 `SurfaceRenderIntent` の `static / finite-state / continuous`、`none / regions / native-input`、`none / precomputed / runtime` を基準にし、必要な Canvas / WebGL / WebAssembly を追加属性として記録する。

| 比較軸                     | baked-web                                | Video                                 | native-ui                            | embedded-web                                            |
| -------------------------- | ---------------------------------------- | ------------------------------------- | ------------------------------------ | ------------------------------------------------------- |
| 主な適用範囲               | 静的 UI、少数の有限 State                | 入力非依存で事前確定できる連続演出    | timer、短い動的 text、限定 binding   | Web runtime が必要な複雑な動的 Surface                  |
| Web との見た目一致         | capture 結果をそのまま表示できる         | encode 前の映像を基準にできる         | Unity 側で再実装と照合が必要         | 同一 bundle でも runtime / device 差を検証する          |
| Cue による State 切替      | State artifact の切替                    | clip / 再生位置の切替                 | plan / binding の切替                | bridge 経由の状態適用                                   |
| CSS / JavaScript animation | 実行不可                                 | 事前録画なら再現可能                  | 対象外                               | 実行可能性を PoC で確認                                 |
| Runtime 値                 | State を有限列挙できる場合のみ           | 原則不可                              | 許可した型と format に限定           | bridge に渡せる値を表示可能                             |
| 複数 client 同期           | State と Unity Timeline で同期           | 共通 playback epoch で同期            | authority の clock / state から描画  | browser clock を authority 時刻へ拘束できるか検証が必要 |
| build の決定性             | 固定 Browser と artifact hash で固定     | encoder と artifact hash の固定が必要 | plan、font、formatter の固定が必要   | runtime、bundle、bridge、network を含む固定が必要       |
| offline / integrity        | preloaded asset と checksum で成立       | preloaded asset と checksum で成立    | plan と font asset の preload が必要 | runtime と全 subresource の同梱・検証が必要             |
| 実行時 resource            | Texture residency が支配的               | decoder、buffer、bandwidth が支配的   | node、font、glyph、layout が支配的   | browser process、Texture 転送、script が支配的          |
| pause / resume             | State 再適用で復元                       | playback epoch への seek が必要       | state / clock から再計算             | lifecycle 復帰と state / clock の再注入が必要           |
| 保守対象                   | Browser capture と Unity Texture adapter | encoder と platform decoder           | portable plan と Unity renderer      | Web runtime、plugin、bridge、security update            |
| 現行 contract              | baked-web 初期 subset あり               | target のみ。v1 Delivery は非対応     | target のみ                          | 非対応                                                  |

## 5. 実機 PoC の fixture

### 5.1 共通 fixture

全候補は同じ Surface の logical size、物理 size、表示位置、内容、font、色、状態系列、Timeline、試行時間を使う。方式固有の都合で内容を簡略化した場合は「制約あり」とし、同等比較の結果に含めない。

Issue #78 は incomplete な Delivery / Realtime 実装へ接続せず、一つの standalone Unity scene と deterministic scenario driver で比較する。driver は fixture に固定した canonical State、logical runtime time、Runtime 値、event ID を各候補へ同じ時刻で渡す。これにより renderer 差だけを測定し、end-to-end network latency や production recovery の成立は別の未検証項目として残す。

最低限、次の fixture を用意する。

1. **Finite State Surface**: 絵コンテから選んだ代表パネルを、#73 で確定した State と Cue 系列で切り替える。Surface の fade / move は Unity Timeline で共通実装する。
2. **Continuous Surface**: 絵コンテで必要と確定した場合だけ、timer または Runtime 値と一つの連続 animation を再生する。必要性がなければ候補方式を増やす理由に使用しない。
3. **Recovery Sequence**: 固定した State と logical time で pause、disconnect 相当の入力停止、renderer instance の破棄、resume、Snapshot 相当値の再適用を順に行い、同じ canonical State と時刻へ戻す。実 process kill が可能な方式では simulated failure と分けて記録する。
4. **Load Scale**: #76 で確定した最大同時 Surface 数を表示し、同一の状態系列を繰り返す。

直接入力は #73 で例外が確定した場合だけ fixture に追加する。例外がなければ入力遅延は `N/A` とし、その根拠を結果へ残す。例外がある場合は role、device action、event ID、payload を固定し、device input から scenario driver の event accept、correct frame までを測る。PoC のために scroll list や form を作らない。

### 5.2 比較対象外の baseline

同一 scene から比較対象 Surface だけを除いた Unity baseline を測定する。各方式は絶対値に加え、baseline からの CPU frame time、GPU frame time、memory、thermal state の増分を記録する。

## 6. 測定手順

### 6.1 固定する環境

各測定記録に次を残す。

- device model、OS version、battery level と給電状態
- Unity version、XR package、render pipeline、Graphics API、build configuration、scripting backend
- refresh rate、passthrough、foveation、render scale
- renderer / plugin / browser / codec の名称と version。System WebView を使う場合は実機 provider の package と version
- artifact checksum、bundle size、network の許可状態
- 室温、開始時 thermal state、試行時間

端末、build、設定、fixture が異なる結果を同じ表で直接比較しない。

### 6.2 試行

1. 端末を同じ開始 thermal state に揃える。
2. Unity baseline を cold start と warm start で測定する。
3. 各候補を同じ順序効果が偏らない順番で実行する。
4. 初回表示、通常進行、最大同時表示、pause / resume、再接続、連続稼働を測定する。
5. 各短時間試行を 10 回、連続稼働を #76 の指定時間だけ実行する。
6. build の決定性は clean な入力から独立に 3 回生成して比較する。
7. 外れ値を削除せず、失敗した試行を失敗理由とともに残す。計測器または端末操作の失敗だけを無効試行とし、一度だけ再試行できる。candidate の crash、timeout、描画不正は有効な失敗として残す。

### 6.3 測定項目

| 分類      | 記録する値                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| fidelity  | Web reference と Quest capture、差分画像、差の位置と原因、文字欠け、alpha / color / font の差                |
| frame     | application CPU / GPU frame time の p50 / p95 / p99 / max、dropped / synthetic frame 数、baseline からの増分 |
| memory    | 起動前、初回表示 peak、定常時、最大同時表示時、連続稼働終了時の RAM / GPU texture / native heap、解放後残量  |
| thermal   | thermal state の時系列、clock throttling、battery 温度、frame time の経時変化                                |
| startup   | application ready から first correct frame までの cold / warm p50 / p95 / max                                |
| update    | Cue または Runtime State 受信から correct frame までの p50 / p95 / p99 / max                                 |
| input     | 入力例外がある場合の device input、event accept、correct frame 間の p50 / p95 / max                          |
| sync      | 同じ event に対する client 間の表示開始差と animation / playback position 差                                 |
| recovery  | pause / resume、再接続、Web runtime crash 相当から正しい表示へ戻る時間と成功回数                             |
| artifact  | build 時間、artifact size、State / Surface 数、checksum 再現性                                               |
| operation | build、端末更新、device debug、障害切り分けの所要時間と手順数、外部 dependency / license、未解決 issue       |

baked-web では ADR-0012 の 2K-long-edge PNG / RGBA32、GPU 256 MiB、serial load CPU 256 MiB を契約上の hard gate として別枠で検査する。この値は Quest process 全体の実測 memory 上限ではない。Video、native-ui、embedded-web の resource budget は #76 と PoC の実測なしに baked-web の式から推測しない。

### 6.4 embedded-web の追加確認

Android System WebView は実行 provider が端末上で更新され得るため、開発 PC の Chrome version を実機 runtime の代用にしない。候補 plugin、Graphics API、Texture backend ごとに WebGL / video / alpha を確認する。WebGL / WebAssembly が必須なら、実際の page で feature detection の結果も保存する。

offline fixture は fresh install 後に network を無効化して起動する。`file://` の権限緩和を前提にせず、同梱 resource と後から取得する resource を区別し、後者は manifest と checksum の対象にする。pause / focus loss では animation、timer、audio、input の停止を、renderer termination では instance 再生成と State / clock の再適用を確認する。

根拠:

- [Meta Quest application lifecycle](https://developers.meta.com/horizon/documentation/unity/unity-lifecycle/)
- [Meta Quest OVR Metrics Tool](https://developers.meta.com/horizon/documentation/unity/ts-ovrmetricstool/)
- [Android WebView の provider と renderer lifecycle](https://developer.android.com/develop/ui/views/layout/webapps/managing-webview)
- [Android WebView で app 内 content を読み込む](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)
- [Unity Android の StreamingAssets](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Application-streamingAssetsPath.html)

## 7. 判定基準

### 7.1 全方式共通の採用 gate

候補は次をすべて満たした範囲でのみ採用候補になる。

1. **Requirement**: #73 の対象 scene を簡略化せず再現できる。
2. **Frame**: steady-state sample を全有効試行で集約した CPU / GPU frame time の p95 / p99 と dropped frame 率が #76 の上限以内であり、各試行の max も記録されている。
3. **Memory / thermal**: 全有効試行の peak memory と最悪 thermal state が #76 の上限以内で、連続稼働の前半と後半で frame time / memory が単調悪化していない。
4. **Fidelity**: 全 State の同一 camera capture が #76 の pixel / color 差分率と SSIM 閾値を満たす。文字欠け、誤った alpha、layout 崩れは数値にかかわらず fail とし、残差は #73 担当者と #77 の意思決定者が許容可否を記録する。
5. **Determinism**: clean な同一入力と version から 3 回連続で同じ artifact checksum または同じ canonical portable plan を生成し、実行時の状態が canonical State / clock から復元できる。
6. **Startup / update / input / sync**: 10 試行の p95 と max が #76 の上限以内であり、再接続後に drift が累積しない。直接入力なしの場合だけ input を `N/A` にできる。
7. **Recovery**: 10 試行すべてで deadline 内に correct frame へ戻り、古い State や時刻を表示し続けない。
8. **Offline / integrity**: #76 が offline を要求する場合に network なしで動作し、実行した全 resource を配布 manifest と checksum で特定できる。
9. **Operability**: 11 月の demo までに build、端末 debug、fallback 切替を担当者が再現できる。

#76 は frame、memory、thermal、fidelity、startup、update、input、sync、recovery の数値上限を PoC profile へ渡す。数値上限がない軸を「問題なし」として通過させない。

### 7.2 方式別の撤退条件

| 方式         | 撤退条件                                                                                                                                                                                                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| baked-web    | 必要な値または animation が有限 State と Unity Timeline に分離できない、または ADR-0012 の hard gate / #76 の実測上限を超える                                                                                                                                                                                                                      |
| Video        | 内容を事前確定できない、正しい playback epoch へ seek できない、対象 Quest の codec / alpha / audio 条件を満たさない、decoder 負荷が gate を超える                                                                                                                                                                                                 |
| native-ui    | 必要な layout、font、format、animation、interaction が portable subset に収まらない、Web reference との差が許容されない、Unity 側の二重実装コストを期限内に負担できない                                                                                                                                                                            |
| embedded-web | 対象 Quest / Unity version で安定して Texture 表示できない、必要 capability が動かない、frame / memory / thermal gate を超える、authority clock へ同期できない、offline bundle と subresource integrity を閉じられない、pause / resume または crash 復旧が gate を満たさない、11 月まで保守可能な license / version pin / debug 経路を確保できない |

一つの代表 Surface で撤退条件に該当しても、方式全体をあらゆる用途から排除したとは扱わない。Issue #77 では「どの Surface class に使えるか」を記録し、採用範囲外には明示的な fallback を割り当てる。

ここでの fallback は build / Delivery 前に Surface class ごとに選び直す検証済み方式を指す。Session 中の renderer 変更、暗黙 downscale、artifact 差し替え、crossfade から cut への変更は fallback として許可しない。

### 7.3 選択規則

1. gate を満たさない候補を除外する。
2. 残った候補のうち、対象 Surface の要求を満たす最も単純な方式を選ぶ。
3. 静的または有限 State は baked-web、事前確定できる入力非依存の連続演出は Video、限定 Runtime 値は native-ui を初期仮説とする。
4. embedded-web は、絵コンテ上の必須表現を前三方式の組み合わせで満たせず、かつ全 gate を満たした場合だけ採用候補にする。
5. 単一方式への統一を目的にしない。Surface class ごとの採用方式と fallback の組を決める。

同じ要求を満たす候補が複数残った場合は、実行時の任意コードが少ない、artifact と状態の再現性が高い、runtime resource が小さい、保守対象が少ない順で選ぶ。重み付き合計点で hard gate の失敗を相殺しない。

## 8. Issue #78 の出力形式

各候補について次を同じ表で提出する。

- `再現可能`、`制約あり`、`非対応` の判定と対象 fixture
- 全測定値、baseline 差、試行回数、失敗回数
- 許容した visual 差と未解決の差
- pass / fail した gate と根拠
- 実機で未検証の項目
- 適用できる Surface class と撤退条件
- 推奨方式、fallback、不採用理由
- 使用した source、build、artifact、plugin / runtime version の参照
- 現行実装、PoC 専用実装、Target contract のうち、結果がどこまでを検証したか

## 9. 決定までの日程

| 日付           | 固定するもの                                         |
| -------------- | ---------------------------------------------------- |
| 9 月 10 日     | #73 / #76 の入力と PoC profile、この比較条件         |
| 9 月 15 日     | #78 の実機測定、raw result、差分画像、未検証項目     |
| 9 月 16〜17 日 | visual 差分、無効試行、各 gate の pass / fail review |
| 9 月 18 日     | #77 で採用範囲、fallback、撤退理由を決定             |

期限までに必須入力または証跡が揃わない候補は未検証として採用候補から外す。全候補が外れた場合は no-pass と記録し、未検証方式を自動採用しない。

## 10. Issue #77 の決定記録に必要な内容

9 月 18 日の決定では、少なくとも次を ADR または同等の記録へ残す。

- Surface class ごとの採用方式と適用範囲
- 各方式が通過した gate と PoC 結果への参照
- 採用しなかった方式と撤退条件に該当した事実
- primary 方式が使えない場合の明示的な fallback
- contract、Compiler、Delivery、Unity Runtime に必要な変更
- 方式を変更できる最終日と、その日までに切り替える検証済み fallback
- 実機未検証の項目と、11 月の demo に残す risk owner

## 11. この文書を承認する条件

- 2 節の入力表がすべて確定済みまたは明示的な `N/A` になっている。
- Issue #78 の担当者が追加解釈なしで同一 fixture と測定手順を再現できる。
- Issue #77 の担当者が gate の結果だけから適用範囲、fallback、撤退理由を説明できる。
