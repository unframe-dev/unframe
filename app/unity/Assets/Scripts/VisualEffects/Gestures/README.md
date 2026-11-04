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

`Begin` は Throw / Circle の一種類を選択します。両方を同時認識したり、既存の swipe / push と競合する候補を自動調停したりしません。操作モードに応じた選択と既存認識器の捕捉制御は呼び出し側で行います。通信担当へ渡す結果は `Kind / Hand / StartedAtSeconds / RecognizedAtSeconds / Position / Direction / ForwardSpeed / CircleRadius` です。位置・方向は Unity world 座標であり、共有空間への変換、入力文脈の保持、送信形式への変換は接続側が担当します。

設定を Inspector に表示する場合は MonoBehaviour に `public GestureRecognitionSettings Settings` を持たせます。変更は次回 Begin から適用されます。Begin は無効な追跡または不安定な頭の水平方向で false を返します。不正設定は例外として通知します。認識成功、追跡喪失、時間逆行、サンプル欠損、時間切れで捕捉は終了し、再開には新しい Begin が必要です。

Circle は頭の開始時水平方向に正対する平面を使用し、頭に対する相対手位置を評価します。Throw は横・後方への振りかぶりに続く前方運動を評価します。速度は振りかぶり位置からの平均前方速度です。値は実機調整前の初期値です。

Inspector 調整には `VisualGestureInput` を配置し、`Begin`／`PushSample`／`Cancel` を呼ぶ。`Recognized` イベントで結果を取得できる。コンポーネント自身は入力デバイスのポーリングや通信を行わない。
