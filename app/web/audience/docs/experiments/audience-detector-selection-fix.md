# 検出器の選択表示と実行設定の不一致

> 履歴（2026-10-22）：現在の実装は[AprilTag採用方式](./audience-apriltag-adopted.md)のみ。以下は当時の方式・スキーマ・実証の記録であり、削除済みの比較モードやコマンドを現行仕様として使用しない。

2026-10-21。ユーザーが確実にArUcoを選んだと報告したschema18 `audience-anchor-input-s1-f161.json`を確認した。top-level detector、session.start、sdk.configuration、adapter snapshotはすべてaprilで、保存結果もAprilTag executed:true / ArUco executed:false。161配信結果すべて未検出。ログ欠落なし。この事実はArUco検出器での失敗を示さない一方、ユーザーの選択操作が誤っていたとも結論しない。

## 原因と再現経路

Anchor/TagのselectはdefaultValueだけでonChangeがなく、React stateは初期URL設定のままだった。選択欄をArUcoへ変更してもstateはaprilのまま。条件を適用するGETフォームの送信を経ずにカメラ開始ボタンを押すと、表示選択と実行設定が食い違う。サイズ欄も同じ。これはコード上で再現可能なUI不備。ブラウザの復元挙動を仮定しなくても説明できる。

## 修正

検出器とサイズをcontrolled selectへ変更し、選択時にstate/config/profileを更新する。適用ボタンを削除し、開始前と実行中に使用する検出器・辞書・黒外周サイズを表示する。stateをadapterの生成、採用する結果側、ログ、JSON、印刷リンクの共通の元とする。URLはmode/detector/sizeをreplaceStateで同期し、その他queryは保持する。

実行中は変更欄を出さず、停止後に変更可能。変更すると前設定の入力画像・姿勢比較・アンカー表示を破棄し、新設定の画像と混同しない。tag単独の両検出器実行という比較条件は維持し、選択した側で位置推定する。anchorは選択側だけを実行する。ログ形式はschema18/tag10を維持し、experiment.conditions-changedで条件変更を記録する。カメラ開始前の選択変更でもadapterを再生成するため状態にstoppedが出る場合があるが、使用設定は現在の選択に一致する。

## 検証

ユーザーの指定に従い回帰テストは追加・実行しない。一時モックUIでAprilTag初期状態からArUcoを選択し、50cmへサイズ変更後、適用操作なしで開始。選択state・URL・印刷リンク・adapter snapshot・session.start・sdk.configuration・JSONすべてArUco/50cmに一致することを確認した。停止後にAprilTagへ戻して開始し、実行設定が一致することも確認した。型検査・lint・本番ビルド成功。実カメラのArUco精度と未検出の改善は再計測が必要。全体品質ゲート・回帰テストは軽いデバッグ指定に従い未実施。
