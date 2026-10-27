# Local Editor Preview再設計: 実装・受入記録

更新日: 2026-10-27。Preview中心のworkspaceへの移行は実装済み。固定Browser／CSPと画面操作を含む手動受入が残る。本書はLocal Editor・CLI・Unityの担当者向けに、採用仕様、検証範囲と残る確認をまとめる。

実装契約は [Local Editor Design](../packages/LOCAL_EDITOR_DESIGN.md)、操作仕様は [Cue時間軸仕様](../packages/LOCAL_EDITOR_TIMELINE_SPEC.md)、起動方法は [Local Editor README](../../app/web/local-editor/README.md) を正本とする。

## 実装済みの範囲

- `app/web/local-editor/src/app/main.tsx` を入口に、React外のworkspace／project／preview／playback／publication controllerとworkspace単位のZustand storeを接続した。UIの選択・表示状態と非同期制御を分離した。
- 公開Propsのdraft、保存・再試行・Undo／Redo、外部更新との競合、Dev自動build、固定Distの表示、CLIを通す認証・公開を実装した。
- Base UI／Tailwind 4／Phosphor／分割パネルによる3列workspaceを採用した。左にGroup／Step／Cue、中央にUnity Previewと時間軸・進行図・診断、右に詳細・Propsを置き、テーマ、開閉、分割サイズの保存を扱う。
- Coreのaccepted Cue capture、CLI Hostの最新occurrence保持、Cue確認・前後シーク・確認再生・通常位置への一時停止復帰を接続した。
- Unityの入力拒否・部分適用・後続更新故障を区別し、故障後の更新停止、正常stateの新sequenceでの復元、新requestでの再構築を実装した。表示成功未確認・復旧中・復旧失敗時は公開を拒否する。
- 旧 `src/features/editor/` とUI／component test・E2Eの専用設定・依存・CI／Nix実行経路を撤去した。Nodeロジックテストは各層の `tests/` に置く。

## 維持する受入条件

### 保存・表示・公開

- 未保存draftは外部更新で破棄せず、競合時は自動上書きしない。結果不明の保存は同じ要求として再試行する。
- Devは保存済みrevisionをbuildし、Distは固定generationを表示する。古い応答・取消後の処理・dispose後の通知で新しい状態を変更しない。polling・Unity instanceは重複させない。
- 公開はUnityのcommitと初期playback適用を確認したDistと、現在の `dist` が一致する場合だけ受け付ける。受付後のupload元は固定する。

### Cue確認・シーク

- 通常再生で実際に受理されたCueの最新発火記録だけを使う。0msはactions適用後・Step／Group遷移前とし、確認中に後続Cueや進行を実行しない。
- request／build、Group／Step entry、occurrence／確認IDを照合する。reset・load・表示切り替えで古い記録を失効させる。
- TimelineとSurface crossfadeを共通時計で評価し、0→中間→終端→中間→0の前後移動を扱う。終端で停止し、通常再生へは退避位置に一時停止で戻る。SourceとDistは書き換えない。
- 指定時刻と表示成功時刻を区別し、Unity成功通知とHostの照合前に表示成功としない。古い要求・通知を適用しない。

### 故障復旧

- 適用前の入力拒否と部分適用・結果不明を分ける。描画資源喪失・通知期限切れも必要な復旧へ渡す。
- 復旧中は再生・入力・シーク・公開を止め、正常stateを新sequenceで一度再適用する。成功確認後は一時停止で戻す。
- 復元不能なら旧receipt・確認session・発火記録を失効させ、明示的な再読込で新requestを作る。失敗したシークの自動再送や無制限の再試行はしない。
- Source更新・再load・Dev／Dist切り替えで旧復旧処理を失効させる。

## 採用済みの制約と対象外

現在のDist envelopeにはSource revisionがないため、一致を推測せずCue確認を無効にする。Distの通常再生と固定成果物の公開確認は維持する。これは未実装項目として扱わない。

Transform編集、Timelineのドラッグ編集、任意Stepへのジャンプ、Quest実機、WebGLの本番Realtime接続は本再設計の完了条件に含めない。画面はVODAIの色・寸法を参考にしたが、外部ファイルや依存はコピーしていない。

## 検証記録

2026-10-22の記録では、Local Editorの型検査・Nodeロジックテスト92件・build、変更ファイルのformat／lint、Core関連46件、CLI関連45件と型検査が成功した。Unity playback EditModeは13件、WebGL player再生成と `nix flake check` も成功した。独立コード・文書レビューで指摘された競合・公開判定・通知の問題は修正・回帰確認済みである。buildにはchunkサイズ警告が残る。

当時の画面確認はBrowser接続タイムアウトで実施できなかった。その後2026-10-27の別worktreeでは、実Unity WebGLを実Host経由で表示し、再生・一時停止・ページ送りをSwiftShaderで確認した。この限定確認を、本checkoutの固定Browser／CSP・全画面操作の受入完了とはしない。

## 残る手動受入

- [ ] 固定BrowserとLocal HostのCSP下で、UI部品・Unity・認証画面を通す。
- [ ] キーボード操作・focus、テーマ、パネル開閉・サイズ保存、狭い画面での操作を確認する。
- [ ] 保存→Dev表示→Cue確認→前後シーク→確認再生→通常位置への復帰を実Unity WebGLで通す。
- [ ] 故障表示・復旧・再読込と、復旧中の操作／公開停止を画面で確認する。
- [ ] 固定Dist表示→認証→公開を通し、表示未確認・成果物不一致で公開できないことを確認する。

確認には `examples/local-editor-showcase/` を用い、対象build・Browser・描画環境・結果を記録する。自動ロジックテストやEditModeの成功だけで画面・実描画の確認を代替しない。

追加修正が必要になった場合は、Local Editor、Core／CLI、Unityの変更範囲に限定して既存テスト・型検査・lint・buildを実行する。全体test／buildはremote CIに任せる。
