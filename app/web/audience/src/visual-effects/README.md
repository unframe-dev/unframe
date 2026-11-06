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
);
effects.evaluate(10500);
handle.cancel();
```

- `effectId`: `wave` / `dissolve`。`handGlow` は `begin(options, target, completed?)` で開始し、返る handle の `updatePose(position, runtimeMs)` と `end(runtimeMs)` を呼ぶ。
- `size`: 正の寸法倍率。wave の全体サイズ、handGlow の輪と軌跡の幅、dissolve のノイズ模様の寸法に適用。
- `color`: sRGB の RGBA、各成分 0〜1。dissolve は RGB × A を消失境界の照明後の色へ加算し、対象モデルの元の不透明度を保つ。
- `speed`: 正の倍率。wave が伸び切るまでの時間、dissolve と手元残光の寿命は `durationMs / speed`。
- `startedAtRuntimeMs`、`evaluate`、Pose の時刻: 同一の外部単調時計のミリ秒。停止時は時計を進めない。Pose の座標は target のローカル座標で渡す。
- `seed`: 0〜4294967295 の整数。wave の位相と dissolve のノイズへ適用。handGlow は入力軌跡のみを使用。
- `runId`: 実行中の同一 ID・同一引数・同一 target は同じ handle を返す。異なる引数は拒否。終了済み ID の記録や再送管理は通信担当の責務。
- 最大同時実行数は32。対象ごとの dissolve は一つだけ。cancel / dispose は完了通知を発火しない。

`dissolve` の対象は MeshStandardMaterial（MeshPhysicalMaterial を含む）の不透明な静的 Mesh。対象下の全 Mesh のマテリアルを複製し、終了またはキャンセルで元に戻す。SkinnedMesh、透明・alphaTest 素材は拒否する。共有素材を変更しない。初期版は影の切り抜きに対応しないため、再生中の対象の castShadow を無効化し、終了・キャンセル時に元へ戻す。既存の独自 onBeforeCompile シェーダー拡張との合成は対象外。対象の恒久的な非表示は呼び出し側の責任であり、消失を維持する場合は完了 callback で `target.visible = false` にする。元マテリアルの復元後に callback が呼ばれるので、その変更は保持される。開始前の時刻は元の表示を保つ。

ディゾルブの模様は Unity と同じ格子間を滑らかに補間した3次元ノイズで、スケールは `12 / size`、境界幅は0.06。Web は元の PBR 照明を保ち、Unity は簡易拡散照明のため、照明結果やノイズの画素単位の一致は保証しない。

手元の光は `end` 後に新しい Pose を受け付けず、残光を減衰して終了する。追跡喪失時に `clearPoses()` を呼ぶと軌跡を消去し、その後の Pose を受け付ける。`retarget(target)` は軌跡を保持して別の target へ移す。古い軌跡の復元機能はなく、最大256サンプルを保持する。輪の半径は `0.035 × size`、幅は `0.012 × size`、軌跡の幅は `0.025 × size` メートル。軌跡は始点の透明から先端の指定色へ変化し、終了後は輪と軌跡を一緒に減衰する。

## Wave

1回の `play` で、一定間隔の12本からなる独立した波を生成する。対象のローカル XY 平面上を X=-4m から +4m へ描き進み、奥行き方向へ回り込まない。各線は同じ波形を高さ方向に0.12mずつずらす。上下の振幅は0.6m、寸法には `size` を掛ける。`target` の位置・回転で任意に配置でき、向きを反転する場合は target を Y 軸に180度回す。

複数の波は別の `runId` と `target` で起動する。開始時刻・設定・キャンセルは独立し、自動的に合流しない。描き終えた線は動かさず、`durationMs / speed` で全長を描いて形と濃さを保持する。保持中も実行中 ID と同時実行枠を使い、`cancel()` または `dispose()` で消して資源を解放する。wave は完了 callback を呼ばない。

各線の全長へ、青紫 `#7187f5` → 紫 `#9a80d0`（位置0.48）→ コーラル `#df7b80` のグラデーションを付け、`color` を乗算する。白 `[1,1,1,1]` で基準配色になる。

各線は256点で曲線を描き、進行中の先端から全長の6%に当たる範囲で滑らかに透明へ変化する。描画完了後も先端の形を保持する。`setWaveOpacity(runId, opacity)` で0〜1の不透明度を設定でき、指定色のalphaと出現アニメーションへ乗算する。形・寸法・先端の透明度分布は変えず、同じrunで何度でも不透明度を更新できる。Web Runtimeでは毎フレーム、Timelineを評価した配置先nodeのopacityを渡す。

波数 `waveCycles` は0〜6、初期値1。0は上下のうねりなし。`seed` は束全体の位相へ適用し、線間隔は変えない。最初の22%で透明から現れる。
