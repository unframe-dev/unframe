# Visual gesture recognition

`VisualGestureRecognizer` は通信に依存しない認識器です。位置は Unity world 座標のメートル、時刻は単調増加する秒を使用します。入力側で有効な手・頭の追跡データを取得してください。

```csharp
var settings = new GestureRecognitionSettings();
var recognizer = new VisualGestureRecognizer(settings);
var initial = new GestureSample(nowSeconds, handPosition, headPosition, headForward, true);
recognizer.Begin(VisualGesture.Throw, GestureHand.Right, initial);
// 操作中は毎フレーム同じ手のサンプルを渡す。
GestureRecognition result = recognizer.Update(sample);
if (result != null) OnRecognized(result);
// トリガー解放、入力文脈変更、再校正、無効化時に呼ぶ。
recognizer.Cancel();
```

`Begin` は Throw / Circle の一種類を選択します。両方を同時認識したり、既存の swipe / push と競合する候補を自動調停したりしません。操作モードに応じた選択と既存認識器の捕捉制御は呼び出し側で行います。通信担当へ渡す結果は `Kind / Hand / StartedAtSeconds / RecognizedAtSeconds / Position / Direction / ForwardSpeed / CircleRadius / WorldPath` です。位置・方向は Unity world 座標であり、共有空間への変換、入力文脈の保持、送信形式への変換は接続側が担当します。

設定を Inspector に表示する場合は MonoBehaviour に `public GestureRecognitionSettings Settings` を持たせます。変更は次回 Begin から適用されます。Begin は無効な追跡または不安定な頭の水平方向で false を返します。不正設定は例外として通知します。認識成功、追跡喪失、時間逆行、サンプル欠損、時間切れで捕捉は終了し、再開には新しい Begin が必要です。

Circle は頭の開始時水平方向に正対する平面を使用し、頭に対する相対手位置を評価します。Throw は認識開始時の目線を水平面へ投影した方向を前方として固定し、後方への振りかぶりに続く前方運動を評価します。横への移動は要求しません。後方への移動は `WindupBackDistance`（既定0.12m）以上、後方との3D角度は `WindupMaxAngleDegrees`（既定35度）以内です。前方への移動距離は振りかぶりの最深点から `ThrowMinDistance`（既定0.2m）以上、前方速度は `ThrowMinSpeed`（既定1.2m/s）以上です。捕捉途中で頭を回しても前後の基準を回しません。

放出方向は直近 `ThrowSpeedWindowSeconds` の平均移動ベクトルと前方との3D角度で評価し、`ThrowMaxAngleDegrees`（既定35度）以内を受け付けます。振りかぶり地点からの累積した横・上下のずれでは角度を判定しません。往路と復路を一致させる必要はなく、少し高い・低い・横にずれた経路から前方へ投げられます。途中の方向が範囲外でも即座に捕捉を終了せず、許容する方向・速度の成立を待ちます。上下主体・横方向への放出は角度条件を満たさないため不成立です。上下比による独立した追加閾値はありません。

前方スイング開始は `ThrowStartDistance`（既定0.01m）で判定します。速度は開始後の `ThrowSpeedWindowSeconds`（既定0.12秒）の平均前方速度です。振りかぶり後の構え時間は含めず、さらに後方へ振りかぶった場合は移動距離の基準位置を更新します。値は実機調整用の初期値です。

Inspector 調整には `VisualGestureInput` を配置し、`Begin`／`PushSample`／`Cancel` を呼ぶ。`Recognized` イベントで結果を取得できる。コンポーネント自身は入力デバイスのポーリングや通信を行わない。

## 円の偏りの許容

円は真円だけでなく、初期値では長軸と短軸の比が約2:1までの楕円を認識します。縦長・横長・斜めの楕円に対応し、`CircleMaxAspectRatio`（既定2、最小1）で偏りの許容範囲を調整します。主軸・副軸を推定して円形に正規化した後の形のずれを `CircleMaxRadialError` で検証するため、この値を単に大きくして線に近い形まで受け付ける方式ではありません。軸長推定のサンプリング誤差として上限比較に1%を許容します。正面の縦向き平面、深さ、閉じ具合、回転角、逆戻り、時間の条件は維持します。

## 演出への引き渡し

`Circle` 成功時の `WorldPath` は採用した手位置の Unity world 座標列です。認識用の頭相対座標とは別に保持し、最大512点、成功時に読み取り専用コピーとして結果へ渡します。後続の `Cancel` や新しい捕捉で変更されません。`Throw` の結果では空です。認識に採用する移動サンプルのみを含み、等時間間隔や完全に閉じた円は保証しません。

軌跡を使う演出には `WorldPath`、位置と方向を使う演出には成立時の `Position` と開始時に固定した水平前方の `Direction` を渡せます。`Direction` は実測の投擲速度ベクトルではありません。`ForwardSpeed` は短時間平均前方速度であり、演出の `speed` 倍率への自動変換はしません。光の弧などの swipe 演出へ既存認識結果を渡す場合も、位置と方向を同じ座標規約に変換してください。この認識器は swipe を出力しません。

固定した演出 root のローカル座標を受け取る API に渡す場合、呼び出し側が `root.InverseTransformPoint(worldPosition)` と `root.InverseTransformDirection(worldDirection).normalized` で変換します。軌跡全点には同じ固定 root の変換を適用します。再生中に root を手や頭へ追従させると軌跡全体が移動するため、描いた位置へ残す演出では root を固定してください。共有空間への変換と左右手系の変換も接続側の責務です。認識時刻は秒であり、演出 API の Runtime ミリ秒とは時計が異なるため、単純な1000倍だけで同期時刻にせず、接続側で Runtime 時計へ対応付けます。

## 製品入力との関係

正式な `throw`／`circle` は main の契約へ登録済みで、製品側の `QuestGestureRecognition` が現在のカタログと InputContext を保持し、既存の `GestureInputCommand` 経路へ接続する。製品側ではモード選択画面を使わず、現在 Step の Cue が要求する候補だけを認識する。

## 既存8種類と同じ設定・送信

Source の Cue trigger に `gesture: "throw"` または `gesture: "circle"` を設定する。既存の `swipeLeft` 等と同じ `kind: "gesture"` として扱い、独自の通信コマンドは追加しない。Compiler／Delivery／Realtime が現在 Step の認識カタログを生成し、Quest がトリガー保持中の実入力を認識する。認識結果は捕捉開始時の InputContext を保ち、既存の `QuestPresentationInput.CreateRecognition` から送信する。認証・epoch・再同期・Cue 発火も既存経路を使う。

```tsx
trigger: { kind: "gesture", gesture: "circle" }
```

両手同時トリガーは既存の両手 Gesture を使い、Throw／Circle は片手の捕捉で認識する。新規候補と競合する既存 Gesture は保留し、新規候補の成功後に同じ操作から二重送信しない。追跡喪失や Step／同期／校正の変更で古い捕捉を破棄する。

## 軌跡用の周期位置通知

製品の `QuestPresentationEntry.GesturePositionSampleReady` を購読し、`GesturePositionSampleIntervalSeconds` へ秒単位の間隔（既定0.05、例0.1）を設定する。現在 Step の認識カタログで Throw／Circle が有効な間、追跡が有効な左右コントローラーの位置を種類・手ごとに通知する。トリガー保持・認識成功は通知の前提にしない。無効な追跡や入力文脈変更で間隔管理をリセットし、遅延フレーム分の過去サンプルを連続送出しない。

```csharp
entry.GesturePositionSampleIntervalSeconds = 0.05;
entry.GesturePositionSampleReady += sample =>
{
    // 通信アダプターへ渡す。ここでの通知だけでは送信しない。
    HandlePosition(sample.Context, sample.Sample);
};
```

通知の `Sample` は Gesture／Hand／TimeSeconds／Position を持つ読み取り専用の値。TimeSeconds は Unity の単調時計の秒で、サーバーの Runtime 時計とは別。Position は Quest 校正を適用したプレゼン空間の Unity 座標・メートル（右手系の正式 Presentation 座標からZを反転済み）で、Quest の生ローカル座標ではない。Context は通知時の InputContext のコピー。原点バージョン・epoch・時計変換・送信形式・流量制御・補間・再接続は通信担当が確定する。

イベントは Unity のフレーム更新内で同期通知する。購読側では待機や長い処理を行わず、必要に応じて最新値をキューへ渡し、破棄時に購読を解除する。認識には毎フレームの位置を使い、出力間隔の変更は認識精度のための間引きには使わない。既存 TrackingFrame は0.1秒間隔で送信済みなので、同じ位置を二重に送らないよう既存送信側と接続方針を合わせる。
