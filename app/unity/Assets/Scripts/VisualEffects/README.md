# Unity visual effects

通信から独立したローカル描画モジュール。`Unframe.Unity.VisualEffects` の API に外部時刻と設定を渡す。Pose 送信、Gesture enum の登録、Cue、Snapshot、再送は呼び出し側の担当。

```csharp
var player = new VisualEffectPlayer();
var options = new EffectOptions("wave-1", 1, Color.cyan, 1, 1200, 42, 10000);
var wave = player.PlayWave(options, stageTransform);
player.Evaluate(runtimeNowMs); // 呼び出し側のフレーム更新から毎回呼ぶ
wave.Cancel();

var hand = player.BeginHandGlow(new EffectOptions("hand-1", 1, Color.cyan, 1, 250, 42, runtimeNowMs));
player.UpdatePose("hand-1", worldHandPosition, runtimeNowMs);
player.EndHandGlow("hand-1", runtimeNowMs); // 新しい Pose の追加を止め、残光を減衰

var dissolve = player.PlayDissolve(
    new EffectOptions("exit-1", 1, Color.cyan, 1, 1000, 42, runtimeNowMs),
    targetMeshRenderer, Resources.Load<Shader>("VisualEffects/VisualDissolve"));
dissolve.Completed += () => targetMeshRenderer.enabled = false;
// ホスト破棄時
player.Dispose();
```

`size` は正の倍率、`color` は各成分 0〜1 の色、`speed` は正の時間倍率。`durationMs` と開始時刻はミリ秒。wave は対象中心のローカル座標へ描画する。左右 ±4m から出現し、+Z の背後へ回って反対側まで交差する。交差後も移動を続け、最後の25%で先端から減衰する。消失中も両端は移動し続ける。線の長さと波長は seed で変化する。Hand の Pose は Unity world 座標。座標原点の変換はホストが行う。

`Evaluate` の時刻を固定すれば単発演出も停止する。開始前は wave／hand を非表示、dissolve は元マテリアルを保持する。単発演出は終端で資源を解放してから `Completed` を一度通知する。`Cancel` と `Dispose` は完了通知を出さない。同じ実行中 ID・同じ設定・同じ対象は同じ handle を返し、異なる内容を拒否する。、終了済み ID の履歴は保持しない。同時上限は32。同じ Renderer への重複 dissolve は拒否する。

Hand は最大256点を保持し、外部時刻から `durationMs / speed` より古い点を除く。Pose は開始以降の厳密な昇順時刻で渡す。`EndHandGlow` 後は Pose を受け付けない。追跡喪失時はホストが End または Cancel を呼ぶ。過去の手軌跡の巻き戻しや再構築は提供しない。

Dissolve の初期対象は不透明な静的 MeshRenderer。元の base texture／UV transform／base color を引き継ぎ、独自の簡易拡散シェーダーで描く。PBR 全属性、法線マップ、透明素材、SkinnedMesh、shadow/depth 専用 pass の対応は含まない。対応範囲外の見た目の一致を保証しない。共有元マテリアルは変更せず、キャンセル・完了・Dispose で元配列へ戻す。対象の恒久非表示・再表示は呼び出し側が設定する。独自 shader は Resources 配下にあり、ビルド時の shader stripping を避ける。

描画所有中はホストが同じ Renderer の材料を差し替えないこと。Player の更新・破棄は Unity メインスレッドで行うこと。色空間と実機性能は対象ビルドで確認する。

Wave の線色は LP 指定の青紫 `#7187f5` → 紫 `#9a80d0` → コーラル `#df7b80` を各線へ割り当てる。`color` はこのパレットへの乗算色として使い、白で指定グラデーションを表示する。

## 確認用シーン

`Assets/Scenes/VisualEffectsPreview.unity` を開いて Play し、Game ビューのボタンを操作する。Wave、Dissolve、手元の光の開始／終了、Pause／Resume、Reset を試せる。サイズ・色・速度は画面またはルートの Inspector で変更でき、次に開始する演出へ適用する。Reset はすべてキャンセルしモデルを再表示する。

カメラ・照明・対象モデルは Play 時に生成する。通信や Quest 認証は不要。Gesture の2つのボタンは固定の合成サンプルを認識器に渡す動作確認であり、実際の手・コントローラー入力ではない。認識設定は Inspector で調整できる。URP を使う Editor の Game ビュー向けで、XR 実機操作用の UI は含まない。

ウェーブの波形は1本あたりおよそ半周期の大きなうねりに抑え、最後の25%で先端から末端へ透明化する。透明化中も両端の移動は続く。

## Wave の現在の仕様

左右それぞれ6本の束がプレゼン空間を円弧に沿って描き進む。収束・拡散は経路上の固定波形として持ち、通過済みの線は動かさない。各線の開始・終了地点は共通経路上で少しずらし、透明から出現して終盤は先端から消える。指定の青紫〜紫〜コーラルの配色を維持する。

波数は `WaveCycles`（Unity）／`waveCycles`（Web）で0〜6、初期値0.5。0は上下のうねりなし。確認画面の波数設定は次回起動から適用する。確認用の基準尺は4.5秒で、出現は進行の最初の22%をかける。
