# Presenter 認識・Runtime authority: 残る Quest 実機受入

更新日: 2026-10-31。Runtime・Unity の担当者向けに、M6 の Quest 実機受入で残る確認をまとめる。

契約と所有境界は [ADR-0027](../decisions/0027-presenter-recognition-and-runtime-authority.md)、[Presenter authority 契約](../packages/CONTRACT_PRESENTER_AUTHORITY.md)、[配信・実行契約](../packages/CONTRACT_RUNTIME.md)、[Realtime Architecture](../../app/server/realtime/ARCHITECTURE.md)、[Unity README](../../app/unity/README.md) を参照する。認証保持と Room 参加の実機受入は [Room 管理と参加導線](console-room-participation.md) で扱う。

## 残る受入: Quest実機

Unity Editorの成功は端末の認識品質・通信・描画性能を代替しない。

- [ ] 実Control Plane／RealtimeからDeliveryとAssetを取得し、表示・入力・切断復帰を確認する。
- [ ] Gesture 8種、開始時の頭方向、両手競合、同一動作の重複通知を確認する。
- [ ] 2m Zoneの境界、腰trackingの欠損・復帰、復帰時の無通知seedを確認する。
- [ ] 校正・再校正、controller ray操作、入力同期、pause中の途中参加・表示凍結・resumeを確認する。
- [ ] 到達済みStepへの復元とMedia／Modelを含む再生位置・表示の整合を確認する。
- [ ] texture residency、GPU／CPU使用量、upload peakを計測する。

端末・実行環境・対象成果物とversion・手順・結果・残不具合を記録する。全項目の成功を確認するまで、Quest受入やM6全体を完了扱いしない。

## この計画の対象外

任意の未到達Stepへの移動、Presenter交代、Local PreviewのGesture／Zone／Anchor対応追加は含めない。公開経路と収容負荷の確認は [Realtime の受入](realtime-runtime-redesign.md) を参照する。
