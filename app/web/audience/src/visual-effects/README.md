# Web 演出モジュール

Unity で認識した動作を受け取る側が呼び出す、通信に依存しない Three.js の演出 API。ここには WebSocket、送受信、認証、Proto、Cue やプレゼン状態の更新処理を含めない。通信担当はこの API へデータを渡すアダプターを実装する。

```ts
import { VisualEffects } from "./effects";
const effects = new VisualEffects();
const handle = effects.play(
  {
    runId: "run-1",
    effectId: "wave",
    size: 1,
    color: [0.4, 0.3, 1, 1],
    speed: 1,
    durationMs: 1400,
    seed: 42,
    startedAtRuntimeMs: 10000,
  },
  scene,
  () => console.log("completed"),
);
effects.evaluate(10500);
handle.cancel();
```

- `effectId`: `wave` / `dissolve`。`handGlow` は `begin(options, target, completed?)` で開始し、返る handle の `updatePose(position, runtimeMs)` と `end(runtimeMs)` を呼ぶ。
- `size`: 正の寸法倍率。wave の全体サイズ、handGlow の発光球、dissolve のノイズ模様の寸法に適用。
- `color`: sRGB の RGBA、各成分 0〜1。dissolve は RGB を消失境界に使用し、対象モデルの元の不透明度を保つ。
- `speed`: 正の倍率。単発寿命・手元残光の寿命は `durationMs / speed`。
- `startedAtRuntimeMs`、`evaluate`、Pose の時刻: 同一の外部単調時計のミリ秒。停止時は時計を進めない。Pose の座標は target のローカル座標で渡す。
- `seed`: 0〜4294967295 の整数。wave の位相と dissolve のノイズへ適用。handGlow は入力軌跡のみを使用。
- `runId`: 実行中の同一 ID・同一引数・同一 target は同じ handle を返す。異なる引数は拒否。終了済み ID の記録や再送管理は通信担当の責務。
- 最大同時実行数は32。対象ごとの dissolve は一つだけ。cancel / dispose は完了通知を発火しない。

`dissolve` の対象は MeshStandardMaterial（MeshPhysicalMaterial を含む）の不透明な静的 Mesh。対象下の全 Mesh のマテリアルを複製し、終了またはキャンセルで元に戻す。SkinnedMesh、透明・alphaTest 素材は拒否する。共有素材を変更しない。初期版は影の切り抜きに対応しないため、再生中の対象の castShadow を無効化し、終了・キャンセル時に元へ戻す。既存の独自 onBeforeCompile シェーダー拡張との合成は対象外。対象の恒久的な非表示は呼び出し側の責任であり、消失を維持する場合は完了 callback で `target.visible = false` にする。元マテリアルの復元後に callback が呼ばれるので、その変更は保持される。開始前の時刻は元の表示を保つ。

手元の光は `end` 後に新しい Pose を受け付けず、残光を減衰して終了する。追跡喪失時も呼び出し側で `end` を呼ぶ。古い軌跡の復元機能はなく、最大64サンプルを保持する。

開発サーバー起動後に `/visual-effects.html` を開くと、通信なしでサイズ・色・速度、単発起動、手元の光、一時停止、キャンセルを確認できる。モデルは仮の立方体で、手位置はデモ用の円軌道。製品の入力・通信へは接続しない。

ウェーブは左右から対象の背後へ回り込み、中央を交差した後も移動を続け、減衰しながら両端が反対側へ抜けて消える。線ごとに seed 由来の長さと波長を変える。基準色は LP の `#7187f5`、`#9a80d0`（グラデーション位置0.48）、`#df7b80`。wave の color はこのパレットへ乗算する tint で、白 `[1,1,1,1]` が基準配色。12本の線へこの3色を連続補間して割り当てる。プレビューの wave は白 tint を初期値にする。

ウェーブの波形は1本あたりおよそ半周期の大きなうねりに抑え、最後の25%で先端から末端へ透明化する。透明化中も両端の移動は続く。
