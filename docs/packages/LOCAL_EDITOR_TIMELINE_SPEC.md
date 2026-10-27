# Local Editor: Cue 時間軸仕様

Status: 構造の閲覧と、記録済み Cue の確認・シークを実装。

## 目的と範囲

プレゼンテーション作者が、保存済み Source の Step・Cue・アニメーションの関係を Local Editor で確認できるようにする。[Local Editor の既存契約](./LOCAL_EDITOR_DESIGN.md) を前提とする。

Step 遷移図、Cue 詳細、Timeline と Surface crossfade を表示する。通常再生の実発火記録がある Cue は、表示 build と Source revision が一致するときに確認・前後シークできる。Timeline のドラッグ編集と Source への書き戻しは行わない。

## 入力と責務

- 既存 Local Author API の `ProjectSnapshot.definition` に含まれる、検証済み `PresentationDefinition.flow` を使用する。Web 側で Authoring Source を再 parse しない。
- `app/web/local-editor/src/flow/` と `timeline/` に表示変換・表示コンポーネントを置く。選択・展開・ズームなどの UI 状態は変換処理から分離する。
- 定義・保存は既存 Host／Compiler が所有する。初期表示のための新しい保存 API や Runtime は追加しない。

## 表示と操作

| 表示                 | 内容・操作                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 遷移図          | Group を選択し、その Group の Step と初期 Step を表示する。Cue の `next` に基づく Step／Group 遷移、stay、終了を示す。分岐・循環・初期 Step から到達できない Step も表示する。   |
| Cue 一覧・詳細       | Step 選択で所属 Cue を表示し、Cue 選択で trigger、guard、priority、order、firePolicy、actions、遷移先を確認する。                                                                |
| アニメーション時間軸 | 選択 Cue の `timeline.play` が参照する Timeline を展開する。対象 Node・プロパティ別にトラックを表示し、duration、keyframe の時刻・値・easing、blocking／nonBlocking を確認する。 |

複数 Timeline を開始する Cue では、それぞれのトラックを同じ Cue 発火基準で表示する。`timeline.stop` は停止 action として表示する。

時間軸は `flow.timelines` のトラックと Surface crossfade の所要時間・completion を表示する。Model clip／Media は Cue 詳細に表示する。crossfade を即時の State 更新として扱わない。即時の State／Variable／Node 更新は Cue 詳細に表示する。

Cue 詳細は Trigger → Guard → Actions → 遷移先のカードで関係を示す。各値は名前付きの項目として表示し、Timeline 再生 Action から時間軸パネルを開ける。Actions の分岐表示は実行の時間順序を表さない。

時間軸は Node／プロパティの固定見出し、duration を表すクリップ、keyframe のマーカーで構成する。横スクロールとズームに対応し、keyframe 選択で時刻・値・easing を右側の詳細欄に表示する。確認中の縦線は Unity が適用成功した確認時刻を示す。指定時刻と表示成功時刻を分ける。Step／Cue／keyframe の選択はキーボードでも操作できるようにする。

## 時間・実行意味の扱い

- Step に実行順序や duration はない。Record の列挙順を進行順とみなさず、初期 Step と Cue の遷移関係を示す。Group をまたぐ遷移は遷移先 Group とその初期 Step を示す。
- Cue 一覧は priority 降順、order 昇順、ID 順に表示する。これは同じ入力に一致する候補の選択順であり、全 Cue が順に実行されるという意味ではない。
- timer の遅延は「Step 開始から N ms」、Timeline の keyframe は「Cue 発火から N ms」と明記する。手動入力や外部イベントの発火時刻は未確定として表示する。
- `timelineCompleted` は対象 Timeline の完了を待つ依存関係として示す。その Cue の絶対発火時刻を推測しない。
- guard は条件付きであることを示す。読み取り専用表示から、条件の成立や Cue の実際の発火を確定しない。
- blocking は開始した Run の完了まで遷移を待つ指定、nonBlocking は完了を待たない指定として表示する。アニメーションの duration を Step の滞在時間に置き換えない。
- 全体の総再生時間や、すべての Step にまたがる確定した秒数軸は生成しない。

## Cue 確認

- 0ms は accepted Cue の actions 適用後・次 Step／Group への遷移前。Group exit の Cue も遷移前を確認する。
- 確認範囲はその Cue が開始する表示対象の Timeline／Surface 遷移／動画／Model clip の最長の有限再生時間。Model crossfade は現在の遷移区間の終端までを扱う。loop や一時停止中など有限の完了時刻を持たない Run だけの場合は0msの状態確認のみ。
- 通常再生位置を退避して一時停止し、最新 occurrence から絶対時刻で再評価する。既存 Run も共通時計で評価し、後続 Cue／Step へ進めない。
- 確認再生は終端で停止する。「0秒へ」は `seekCue(0)`、「通常再生に戻る」は退避位置への一時停止復帰。通常 reset と区別する。
- keyframe 選択は右詳細を更新する。同じ Cue の確認中だけその時刻へシークし、別 Cue／通常再生／未記録 Cue では Preview を動かさない。
- 未送信シークは最新時刻へ集約する。古い request／session の応答・通知は適用しない。
- 確認で Source／Dist／通常再生の入力履歴を変更しない。reset／load／表示失効で発火記録を破棄する。

## 更新・空状態・エラー

- 既存の ProjectSnapshot 更新に追従する。同じ ID の選択は維持し、対象が削除された場合は選択を解除する。
- 表示対象の保存 revision を明示する。Unity Preview の表示済み build と混同せず、既存の保存・build・表示状態の区別を維持する。
- `definition` が `null` の場合は構造表示を行わず、検証できない旨と既存 Diagnostics を示す。古い構造を現在の定義として表示しない。
- Cue がない Step や `timeline.play` がない Cue は正常な空状態として表示する。

## 受け入れ条件

初期受け入れ例には `examples/local-editor-showcase/` を使う。`cover → problem → system → workflow → closing → cover` の循環と、各 Step の2つの Cue を確認できること。Cue の状態切り替えと nonBlocking の `focus` Timeline を区別し、opacity の `0.72 → 1`、`0 → 600 ms`、`cubicOut` を表示できること。

showcase にない分岐・Group 遷移・timer・guard・blocking・複数トラックはテスト fixture で確認する。Cue の選択順、外部保存による更新、検証失敗、空状態とキーボード操作も確認する。閲覧選択だけでは Unity を動かさず、確認モードの同じ Cue のキー・シークだけが Preview を動かすこと。確認操作で Source／`dist` は変更しないこと。

現在の Dist envelope は Source revision を含まないため、一致を推測せず Cue 確認を無効化する。通常再生と固定 Dist の公開確認は継続できる。復旧中は再生・入力・シーク・公開を止め、復旧失敗時は新しい request の明示再読込を案内する。テストは各層 `tests/` のロジックを対象とし、画面・実描画は別途手動確認する。
