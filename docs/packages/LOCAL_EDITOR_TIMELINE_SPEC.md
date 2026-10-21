# Local Editor: 読み取り専用タイムライン仕様

Status: 実装スコープ確定。読み取り専用の構造・時間関係の可視化を対象とする。

## 目的と範囲

プレゼンテーション作者が、保存済み Source の Step・Cue・アニメーションの関係を Local Editor で確認できるようにする。[Local Editor の既存契約](./LOCAL_EDITOR_DESIGN.md) を前提とする。

初期範囲は読み取り専用とし、Step 遷移図、Cue 詳細、Timeline のトラックと keyframe を表示する。Unity Preview の再生・スクラブ、実行中状態の追跡、ドラッグ編集、Source への書き戻しは含めない。

## 入力と責務

- 既存 Local Author API の `ProjectSnapshot.definition` に含まれる、検証済み `PresentationDefinition.flow` を使用する。Web 側で Authoring Source を再 parse しない。
- `app/local-editor/src/features/editor/` に表示モデルへの純粋な変換処理と表示コンポーネントを置く。選択・展開・ズームなどの UI 状態は変換処理から分離する。
- 定義・保存は既存 Host／Compiler が所有する。初期表示のための新しい保存 API や Runtime は追加しない。

## 表示と操作

| 表示                 | 内容・操作                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 遷移図          | Group を選択し、その Group の Step と初期 Step を表示する。Cue の `next` に基づく Step／Group 遷移、stay、終了を示す。分岐・循環・初期 Step から到達できない Step も表示する。   |
| Cue 一覧・詳細       | Step 選択で所属 Cue を表示し、Cue 選択で trigger、guard、priority、order、firePolicy、actions、遷移先を確認する。                                                                |
| アニメーション時間軸 | 選択 Cue の `timeline.play` が参照する Timeline を展開する。対象 Node・プロパティ別にトラックを表示し、duration、keyframe の時刻・値・easing、blocking／nonBlocking を確認する。 |

複数 Timeline を開始する Cue では、それぞれのトラックを同じ Cue 発火基準で表示する。`timeline.stop` は停止 action として表示する。

時間軸の初期対象は `flow.timelines` のトラックとする。Surface の crossfade、Model clip、Media の操作は指定された transition・completion などを Cue 詳細に表示し、時間軸には展開しない。crossfade を即時の State 更新として扱わない。即時の State／Variable／Node 更新は Cue 詳細に表示する。

Cue 詳細は Trigger → Guard → Actions → 遷移先のカードで関係を示す。各値は名前付きの項目として表示し、Timeline 再生 Action から該当トラックへ移動できる。Actions の分岐表示は実行の時間順序を表さない。

時間軸は Node／プロパティの固定見出し、duration を表すクリップ、keyframe のマーカーで構成する。横スクロールとズームに対応し、keyframe 選択で時刻・値・easing を右側の詳細欄に表示する。選択位置の縦線は再生位置ではない。Step／Cue／keyframe の選択はキーボードでも操作できるようにする。

## 時間・実行意味の扱い

- Step に実行順序や duration はない。Record の列挙順を進行順とみなさず、初期 Step と Cue の遷移関係を示す。Group をまたぐ遷移は遷移先 Group とその初期 Step を示す。
- Cue 一覧は priority 降順、order 昇順、ID 順に表示する。これは同じ入力に一致する候補の選択順であり、全 Cue が順に実行されるという意味ではない。
- timer の遅延は「Step 開始から N ms」、Timeline の keyframe は「Cue 発火から N ms」と明記する。手動入力や外部イベントの発火時刻は未確定として表示する。
- `timelineCompleted` は対象 Timeline の完了を待つ依存関係として示す。その Cue の絶対発火時刻を推測しない。
- guard は条件付きであることを示す。読み取り専用表示から、条件の成立や Cue の実際の発火を確定しない。
- blocking は開始した Run の完了まで遷移を待つ指定、nonBlocking は完了を待たない指定として表示する。アニメーションの duration を Step の滞在時間に置き換えない。
- 全体の総再生時間や、すべての Step にまたがる確定した秒数軸は生成しない。

## 更新・空状態・エラー

- 既存の ProjectSnapshot 更新に追従する。同じ ID の選択は維持し、対象が削除された場合は選択を解除する。
- 表示対象の保存 revision を明示する。Unity Preview の表示済み build と混同せず、既存の保存・build・表示状態の区別を維持する。
- `definition` が `null` の場合は構造表示を行わず、検証できない旨と既存 Diagnostics を示す。古い構造を現在の定義として表示しない。
- Cue がない Step や `timeline.play` がない Cue は正常な空状態として表示する。

## 受け入れ条件

初期受け入れ例には `examples/local-editor-showcase/` を使う。`cover → problem → system → workflow → closing → cover` の循環と、各 Step の2つの Cue を確認できること。Cue の状態切り替えと nonBlocking の `focus` Timeline を区別し、opacity の `0.72 → 1`、`0 → 600 ms`、`cubicOut` を表示できること。

showcase にない分岐・Group 遷移・timer・guard・blocking・複数トラックはテスト fixture で確認する。Cue の選択順、外部保存による更新、検証失敗、空状態とキーボード操作も確認する。UI の時間軸を操作しても Source・`dist`・Unity Preview の状態を変更しないこと。
