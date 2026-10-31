# Local Editor Preview: 残る手動受入

更新日: 2026-10-31。Local Editor・CLI・Unity の担当者向けに、固定 Browser／CSP と実 Unity WebGL で残る確認をまとめる。

実装契約は [Local Editor Design](../packages/LOCAL_EDITOR_DESIGN.md)、操作仕様は [Cue 時間軸仕様](../packages/LOCAL_EDITOR_TIMELINE_SPEC.md)、起動方法は [Local Editor README](../../app/web/local-editor/README.md) を正本とする。

## 残る手動受入

- [ ] 固定BrowserとLocal HostのCSP下で、UI部品・Unity・認証画面を通す。
- [ ] キーボード操作・focus、テーマ、パネル開閉・サイズ保存、狭い画面での操作を確認する。
- [ ] 保存→Dev表示→Cue確認→前後シーク→確認再生→通常位置への復帰を実Unity WebGLで通す。
- [ ] 故障表示・復旧・再読込と、復旧中の操作／公開停止を画面で確認する。
- [ ] 固定Dist表示→認証→公開を通し、表示未確認・成果物不一致で公開できないことを確認する。

確認には `examples/local-editor-showcase/` を用い、対象build・Browser・描画環境・結果を記録する。自動ロジックテストやEditModeの成功だけで画面・実描画の確認を代替しない。

## 受入の範囲

Dist の Cue 確認無効は採用済みの制約であり、未実装項目に含めない。Transform 編集、Timeline のドラッグ編集、任意 Step へのジャンプ、Quest 実機、WebGL の本番 Realtime 接続も本受入の対象に含めない。
