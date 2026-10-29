# ADR-0029: 新しい実行世代での同一 Session 復旧

## Status

Accepted

## Context

通常進行の checkpoint を非同期保存すると、配信済み状態や操作結果が保存前に失われ得る。同じ assignment epoch を再利用した復旧では、古い資格・Resume cursor・操作と巻き戻した状態を区別できない。Host の再起動時には旧プロセスがまだ稼働している可能性もある。

## Decision

- Runtime は Session ごとに状態・操作結果をメモリ上で確定して配信し、通常の checkpoint を1秒間隔で非同期保存する。保存失敗だけでは進行・入力・配信を停止しない。操作成功・入力同期 READY は保存完了を保証しない。
- 実行状態を作り直すたび、同じ Host で旧 lease が残っていても新しい assignment epoch を取得する。Control Plane は旧実行の停止確認、または更新を止めた旧 lease の失効を待って authority を移す。heartbeat 途絶や epoch 更新だけを停止確認にしない。
- Control Plane は、Session の最新 checkpoint の version・Reliable sequence・保存元 assignment・固定 publication を検証して `checkpointSource` を発行する。Realtime は保存元 identity で hash・cut・snapshot を検証し、全 Run ID と参照を新 epoch へ付け替える。Session・publication・Definition / RenderBundle hash を変えず、現在の catalog と epoch でも検証する。破損や不一致を初期状態で代替しない。
- 保存済みの進行位置・変数・時計・再生位置・Step 開始履歴・Run allocator・Reliable sequence へ戻す。停止していた実時間を加算せず、復旧後は `Paused / processRecovered` とする。既存の invariant violation による停止理由は維持する。checkpoint が存在しない場合だけ初期状態を使い、その復旧も paused として初回起動と区別する。
- 新 fence と増加した checkpoint version で復旧状態を保存してから ready を報告する。client は再 bootstrap し、旧 Resume cursor と未確認操作を破棄して新 Snapshot で全置換する。旧操作を新世代へ自動再送しない。Presenter の入力同期と明示 Resume を必要とする。旧 epoch の資格・event・checkpoint・completion を拒否する。
- Cloud Host は一つの endpoint と常駐プロセスで複数 Session を管理する。boot generation・明示 capacity・Session ごとの readiness / lease を Control Plane と共有する。満員・drain 中も既存 lease を更新する。再起動時の自動復旧は現在の担当 Host と履歴が確定する未終了 Session に限り、終了・明示解放・他 Host への移動を取り消さない。
- 発表終了は通常保存と分け、先行保存と直列化した最終 checkpoint・Session の `Ended` 化・assignment 解放が確定してから完了を公開する。失敗・応答消失時は同じ completion を冪等に retry する。

## Consequences

同じ Session ID と参加コードを維持し、保存障害で通常配信を止めずに運用できる。クラッシュ時は最後に保存できた checkpoint へ巻き戻り、保存障害中の巻き戻り幅に時間上限を保証しない。未保存の操作結果・入力世代も失われ得る。replay はメモリ内だけに保持し、event log からのクラッシュ復元や旧世代の操作再送で巻き戻りを埋めない。

同期保存後だけ配信する方式は、保存遅延が入力・時計・配信へ波及するため採用しない。同じ epoch の再利用は旧操作を新状態へ混入させるため採用しない。一つの Host プロセスを失えば、その Host の全担当 Session が復旧対象になる。

Venue Edge は bootstrap の起動 ID を assignment へ一度だけ紐づけて同じ epoch の別プロセス起動を拒否する。自動割り当て Agent は実装せず、再起動には旧実行の停止・明示 release と、旧 lease の失効後の新しい assignment の取得を運用側で行う。

## Adoption and Exceptions

保存を5秒超ブロックした通常進行、cut の整合・集約・retry の冪等性、旧 lease が残る再起動と分断中の旧 Runtime、checkpoint 未作成・破損、旧 boot の遅延要求、completion の応答消失を境界テストで検証する。同じ fence の sequence 後退を拒否し、新 epoch の paused Snapshot への巻き戻り・旧操作破棄・明示 Resume を consumer で確認する。

Funnel 経由の複数 Session、Unity / Audience の同期・再接続・Host 再起動、代表負荷での配信遅延と収容上限は[再設計計画](../plans/realtime-runtime-redesign.md)の実環境検証対象であり、ローカルテストの成功だけでは確認済みと扱わない。復旧条件の緩和は本 ADR と対応する契約・テストを更新してレビューする。
