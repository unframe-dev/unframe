# 腕モーションの判定

Presenter の Unity client が頭・左右手の Pose から Gesture を認識し、認識開始時の入力 context とともに Runtime へ送ります。Runtime は context と Guard を検証し、Cue / Action / Next を確定します。認識結果の種類と Zone の契約は[データ契約](../../../docs/packages/DATA_MODEL.md#gesture--zone-と共有進行)、接続・表示は[本番プレゼン](production-presentation.md)を参照してください。

Author が指定するのは `gesture` の種類だけです。距離・速度・時間窓・使用する手は Presenter client 内部の認識条件で、Authoring や Delivery の設定ではありません。Quest の操作案内は[アプリUI](quest-app-ui.md#本番モーションの3d案内)を参照してください。

旧ローカルリハーサルのモーション進行と仮描画は廃止しました。原本は `app/unity/AuthoringArchive/` に保管しており、本番ビルドには含めません。利用する場合は現行 Authoring Project へ移し、ビルド・公開します。
