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

`size` は正の倍率、`color` は各成分 0〜1 の色、`speed` は正の時間倍率。`durationMs` と開始時刻はミリ秒。wave は単位サイズで左右 ±3.5m から ±0.65m まで流れる。Stage のローカル座標に描画し、中央を空ける。Hand の Pose は Unity world 座標。座標原点の変換はホストが行う。

`Evaluate` の時刻を固定すれば単発演出も停止する。開始前は wave／hand を非表示、dissolve は元マテリアルを保持する。単発演出は終端で資源を解放してから `Completed` を一度通知する。`Cancel` と `Dispose` は完了通知を出さない。同じ実行中 ID・同じ設定・同じ対象は同じ handle を返し、異なる内容を拒否する。、終了済み ID の履歴は保持しない。同時上限は32。同じ Renderer への重複 dissolve は拒否する。

Hand は最大256点を保持し、外部時刻から `durationMs / speed` より古い点を除く。Pose は開始以降の厳密な昇順時刻で渡す。`EndHandGlow` 後は Pose を受け付けない。追跡喪失時はホストが End または Cancel を呼ぶ。過去の手軌跡の巻き戻しや再構築は提供しない。

Dissolve の初期対象は不透明な静的 MeshRenderer。元の base texture／UV transform／base color を引き継ぎ、独自の簡易拡散シェーダーで描く。PBR 全属性、法線マップ、透明素材、SkinnedMesh、shadow/depth 専用 pass の対応は含まない。対応範囲外の見た目の一致を保証しない。共有元マテリアルは変更せず、キャンセル・完了・Dispose で元配列へ戻す。対象の恒久非表示・再表示は呼び出し側が設定する。独自 shader は Resources 配下にあり、ビルド時の shader stripping を避ける。

描画所有中はホストが同じ Renderer の材料を差し替えないこと。Player の更新・破棄は Unity メインスレッドで行うこと。色空間と実機性能は対象ビルドで確認する。
