# Unity visual effects

通信から独立したローカル描画モジュール。`Unframe.Unity.VisualEffects` の API に外部時刻と設定を渡す。Pose 送信、Cue、Snapshot、再送は呼び出し側の担当。正式な `throw`／`circle` は既存 Gesture と同じ製品入力経路へ接続されている。

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

`size` は正の倍率、`color` は各成分 0〜1 の色、`speed` は正の時間倍率。`durationMs` と開始時刻はミリ秒。Wave は対象のローカル平面上を左から右へ描く。配置と回転は対象 Transform に従い、seed は波の位相を変える。Hand の Pose は Unity world 座標。座標原点の変換はホストが行う。

`Evaluate` の時刻を固定すれば演出も停止する。開始前は wave／hand を非表示、dissolve は元マテリアルを保持する。Wave は描き終わると `Cancel` または `Dispose` まで形を保持し、`Completed` を通知しない。`SetWaveOpacity(runId, opacity)` は0〜1の濃さを次の `Evaluate` に反映し、元の色の alpha と出現時の濃さに乗算する。Presentation の node opacity もこの倍率へ反映する。Dissolve と終了した hand は資源を解放してから `Completed` を一度通知する。`Cancel` と `Dispose` は完了通知を出さない。同じ実行中 ID・同じ設定・同じ対象は同じ handle を返し、異なる内容を拒否する。終了済み ID の履歴は保持しない。同時上限は32。同じ Renderer への重複 dissolve は拒否する。

Hand は最大256点を保持し、外部時刻から `durationMs / speed` より古い点を除く。Pose は開始以降の厳密な昇順時刻で渡す。`EndHandGlow` 後は Pose を受け付けない。追跡喪失時はホストが End または Cancel を呼ぶ。過去の手軌跡の巻き戻しや再構築は提供しない。

Dissolve の初期対象は不透明な静的 MeshRenderer。元の base texture／UV transform／base color を引き継ぎ、独自の簡易拡散シェーダーで描く。PBR 全属性、法線マップ、透明素材、SkinnedMesh、shadow/depth 専用 pass の対応は含まない。対応範囲外の見た目の一致を保証しない。共有元マテリアルは変更せず、キャンセル・完了・Dispose で元配列へ戻す。対象の恒久非表示・再表示は呼び出し側が設定する。独自 shader は Resources 配下にあり、ビルド時の shader stripping を避ける。

描画所有中はホストが同じ Renderer の材料を差し替えないこと。Player の更新・破棄は Unity メインスレッドで行うこと。色空間と実機性能は対象ビルドで確認する。

Wave は各線の左から右へ青紫 `#7187f5` → 紫 `#9a80d0` → コーラル `#df7b80` のグラデーションを描く。`color` はこのパレットへの乗算色として使い、白で指定グラデーションを表示する。

## Wave の現在の仕様

一回の起動で平行な12本の線が1つの束として片端から伸び、描き終わった形を保持する。基準幅は8m、振幅は0.6m、線間隔は0.12m、線幅は0.018m。いずれも `size` 倍で描く。別の対象 Transform と実行 ID を渡せば、複数の束を独立して配置・停止できる。

各線は256点で曲線を描き、先端6%で幅と濃さを滑らかに絞る。端と曲がり角は丸め、対象 Transform の一様な拡縮には線幅も追従する。

波数は `WaveCycles`（Unity）／`waveCycles`（Web）で0〜6、初期値1。0は上下のうねりなし。出現は進行の最初の22%をかける。
