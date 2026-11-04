# 演出モジュールの接続境界

Unity の認識と Unity／Web の描画を、通信から独立した API として提供する。制作側は出力の型・単位・描画の寿命を定義し、通信担当は送受信と既存プレゼン規格への対応を実装する。

## 提供する API

- [Unity 認識](../app/unity/Assets/Scripts/VisualEffects/Gestures/README.md): 投げる／円の明示選択、時刻付きサンプルの入力、認識結果。Inspector 用 `VisualGestureInput.Recognized` から結果を取得できる。
- [Unity 演出](../app/unity/Assets/Scripts/VisualEffects/README.md): ウェーブ、手元の光、ディゾルブ、外部時計による更新、完了通知・キャンセル。
- [Web 演出](../app/web/audience/src/visual-effects/README.md): 同じ3種類の描画 API と通信なしの開発プレビュー。

認識の時刻は秒、描画の時刻はミリ秒。認識時刻を共有 Runtime 時刻に読み替える処理は接続側が行う。認識の位置と Unity の手元 Pose は Unity world 座標、Web の手元 Pose は渡した対象のローカル座標。座標変換をせずに同じ数値を転送しないこと。

描画設定は実行 ID、サイズ倍率、RGBA、速度倍率、基準尺、seed、開始 Runtime 時刻を持つ。通信上の対象 ID を Scene の Transform／Object3D に解決してから呼び出す。seed は各環境で再現性のために使い、両環境のノイズ・波形のピクセル一致は保証しない。

## 通信担当が接続する範囲

Gesture 種別の正式登録、既存ジェスチャーとの候補選択、入力文脈・権限・校正・座標原点の管理、送受信、Cue と演出の対応、共有時計と Run ID の確定、再送排除、途中参加・再接続時の復元方針を担当する。

描画モジュールは実行中 ID の重複起動を抑止するが、終了済み ID の履歴を保存しない。完了通知は描画資源の解放後に出し、対象の恒久非表示は呼び出し側が設定する。ディゾルブの完了時に非表示を設定しなければ元の素材表示へ戻る。

## Draft の制限

実通信・既存 Scene への組み込み、Quest／スマートフォンの実機受入は未実施。Unity のディゾルブは不透明な静的モデルの基本色・テクスチャを対象とし、PBR 全属性は保持しない。透明素材・SkinnedMesh は対象外。詳細な素材・影・手軌跡の制約は各 README に記載する。
