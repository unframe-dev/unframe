# Realtime: 残る公開経路・収容負荷の受入

更新日: 2026-10-31。Realtime・Control Plane・Unity・Audience の担当者向けに、Funnel 経由の複数 Session と代表負荷で残る受入をまとめる。

現在の構成と保存・復旧の契約は [Realtime Architecture](../../app/server/realtime/ARCHITECTURE.md)、[配信・実行契約](../packages/CONTRACT_RUNTIME.md)、[ADR-0029](../decisions/0029-session-recovery-across-assignment-epochs.md) を参照する。公開経路の準備は [Funnel 運用手順](../../app/server/realtime/ops/funnel.md) に従う。

## 公開経路の結合受入

- [ ] 同じ Funnel URL で複数 Session の native gRPC／WSS を接続し、入力・状態・配信・保存・終了が Session 間で混ざらないことを確認する。
- [ ] Unity／Audience の途中参加、切断復帰、Host 再起動を確認する。新 epoch の Snapshot への置換、paused 復旧と明示 Resume、旧世代の操作拒否を確認する。
- [ ] 保存遅延・障害中も通常の入力・時計・配信が継続し、1 Session の障害が他 Session を止めないことを確認する。Session ごとの保存遅延・失敗・retry 状態を観測する。
- [ ] completion の失敗・応答消失後の再試行と終了確定、終了後の再入場拒否を確認する。

Quest の認識・描画は [Presenter 認識の実機受入](presenter-recognition-runtime-authority-refactor.md)、無人終了と Room 参加は [Room 管理の受入](console-room-participation.md) と合わせて確認する。

## 代表負荷と収容上限

- [ ] 代表的な Session 数・参加台数で配信遅延と保存負荷を測定し、Host の収容上限を確定する。Funnel の帯域制限を含め、ローカルテストから収容数を推定して確定しない。
- [ ] 満員時の新規受付拒否、drain 中の既存 lease 更新、slow viewer が他 Session に与える影響を実環境で確認する。

対象 Host・端末、配信環境、対象成果物、Session 数・参加台数、手順、測定値と残不具合を記録する。ローカル結合テストの成功だけで公開経路・実機・収容負荷を確認済みと扱わない。

## 受入の範囲

永続イベントログや WAL、配信済み操作のゼロ損失、プロセス間の Session 分離、live migration、Fly.io の自動配備、Venue Edge Agent の新規実装、一度も接続していない Session の TTL は含めない。
