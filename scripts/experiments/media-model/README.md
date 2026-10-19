# GLB / Unity 技術検証

専用生成 project で glTFast の runtime bytes import と legacy Animation の手動評価を試す。
本番 Runtime・capability を変更するものではない。
保存済みの通常経路・本番 API 経路の compact 実測は [results-linux.json](./results-linux.json) を参照。
通常経路の hash は bounds 補正前に保存した fixture bytes に基づき、player 内の hash 照合は本番 API 経路だけで行った。

```bash
scripts/experiments/media-model/run.sh probe
scripts/experiments/media-model/run.sh build
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$HOME/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome" \
  scripts/experiments/media-model/browser-check.sh
```

前提は `nix run .#unity-editor` が利用する Unity **6000.3.22f1** と有効なライセンス、WebGL module。
生成物・生ログは `.unframe/media-model-spike/`。UPM の直接依存は glTFast **6.20.0**、URP **17.3.0**、
推移依存はこの directory の [packages-lock.json](./packages-lock.json) を生成 project へコピーする。
既存 `app/unity` は Editor version の参照だけに利用する。

`fixture.mjs` は自作 CC0 の三角形一枚、joint 一つ、morph 一つ、1秒の二つの animation を生成する。
source の選択 scene root に x 方向の移動、joint に y 方向の移動、mesh に morph を持つ。
`root-stripped.glb` は既知 fixture の root channel 二つだけを除く。汎用素材変換・検証器ではない。
clip index / sampler の対応は保つ。GLB に外部参照はない。埋め込み画像はまだ含まない。

## 実測 2026-10-19

Linux Editor / `-batchmode -nographics` (`graphics=Null`) で `probe` が exit 0。
`ModelSpike.Run` の assertion は importer と Unity Animation / Renderer の公開 API を通す。

- byte[] import、skin / morph / 二 clip の生成、同素材二 instance の別 clip / 別時刻の独立評価。
- `AnimationState.time / weight / enabled` と `Animation.Sample()` による時刻評価、二 clip の 50:50 mixture、停止 mixture の同じ入力からの再構築、1秒の最終姿勢。
- morph の full frame weight は **1**。時刻0.25で weight 0.25。CPU `BakeMesh` の既知頂点も確認した。wrapper scale `(2,3,4)` の影響を含む頂点 `(0,4.5,1)` になる。
- 元 GLB の root channel は内部 root を実際に移動する。削除後は内部 root が原点を保ち、wrapper の position / rotation / scale は評価の前後で維持される。
- URP shader `Shader Graphs/glTF-pbrMetallicRoughness` を取得。clone material で base alpha 0.8 × Node opacity 0.5 = 0.4、SrcAlpha / OneMinusSrcAlpha、ZWrite 0 を設定でき、他 instance は ZWrite 1 を維持。

初回は既定 `GltfImport` constructor が EditMode の `DontDestroyOnLoad` で失敗した。
明示 `UninterruptedDeferAgent` で解消。未知 API の探索では fixture の期待値を先に assertion に置き、
観測した morph frame weight と BakeMesh の scale 適用を検査値へ反映した。
本番の再生状態遷移・拒否規則を実装した TDD の代替ではない。

WebGL Development build も `Build Finished, Result: Success` / exit 0。
`webgl.data` / `framework.js` / `loader.js` / `wasm` を生成した（wasm 約66 MiB）。
続いて Linux の既存 Chromium **149.0.7827.55** / SwiftShader 上でも同じ generated player を実行し、
bytes import、skin / morph、二 instance、manual clip / crossfade / 保持姿勢、wrapper TRS の assertion が通った。
専用 camera / RenderTexture の中心 pixel は opaque `RGBA(1.000,0.725,0.549,1.000)`、
Node opacity 0.5 適用後 `RGBA(0.400,0.290,0.220,0.400)` で、実際の blend 出力も変化した。
`browser-result.json` に browser identity、全 assertion と diagnostic、pixel 実測を保存する。

browser runner は既存 Playwright、Nix dev shell と pinned nixpkgs の cups/cairo/pango を利用する。
上記の既存 browser の明示指定で成功した。省略時は project の headless shell を使う。
この環境の Chromium **151.0.7922.34** headless shell は ANGLE の `VK_KHR_wayland_surface` 不足で
WebGL 初期化に失敗したため、149 の成功を151の検証結果とは扱わない。browser の自動取得は行わない。

## 本番 transformGlb との接続

```bash
scripts/experiments/media-model/run.sh compiled-probe
scripts/experiments/media-model/run.sh compiled-build
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$HOME/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome" \
  scripts/experiments/media-model/browser-check.sh compiled
```

`transform-fixture.ts` は Nix toolchain の Bun から `unframe-assets/src/index.ts` の公開 `transformGlb` を呼ぶ。
同じ入力の2回変換で bytes が一致し、3 nodes / 1 primitive / 3 vertices / 1 triangle / 1 bone / 1 morph、
二 clip の index 0/1 と duration 1000 ms を固定値で検査する。
API の出力は `.unframe/media-model-spike/compiled/model.glb`、descriptor / provenance / tool version は
同 `metadata.json` に保存する。`compiled-*` はこの GLB を既知 fixture 専用の root 除去結果の代わりに読み込む。
Unity 自身が読み込んだ bytes の SHA-256 を出力し、browser runner は API descriptor の checksum と照合する。

最初の API 呼び出しは source fixture の morph POSITION accessor の min/max 欠落を仕様違反として拒否した。
fixture に bounds だけを補い、geometry / animation / 期待 pose / pixel は変更していない。
変換結果は 2888 bytes、SHA-256 `c41c9e5e528d51f45f87350bfb664bf1cfead1aef4b073509be38bf4ac8d69bb`。
Editor の `compiled-probe` は既存 assertion が全て通過した。
実 WebGL の `compiled` runner も exit 0 / 21 assertion 通過。Unity 内の bytes hash は API descriptor と一致した。
opaque / opacity pixel も既存の `(1.000,0.725,0.549,1.000)` / `(0.400,0.290,0.220,0.400)` のまま。
結果は `.unframe/media-model-spike/compiled-browser-result.json` に保存する。

## 未検証 / 次の判断

- 画素比較は単一の PBR opaque material と Node opacity だけ。alpha cutoff後の opacity、transparent sorting、全素材の shader variant 同梱は未検証で、mask / blend / texture を含む成果物契約全体の証拠にはならない。
- Quest、macOS、Android IL2CPP、texture、unlit、mask / blend 素材、resource 上限、長時間切替・解放は未検証。
- 本番 API の全拒否条件・予算境界は owning package のテストで検証する。この spike は代表 fixture の consumer 接続だけを確認する。
- Core が確定した canonical state / logical clock との接続、crossfade 中 play の拒否、自然完了と停止保持は本番 consumer と共通 fixture で検証する必要がある。

正本: [ADR-0016](../../../docs/decisions/0016-model-animation-scope.md)、[成果物契約](../../../docs/packages/CONTRACT_ARTIFACTS.md)。
公式 glTFast [機能表](https://docs.unity3d.com/Packages/com.unity.cloud.gltfast@6.20/manual/features.html) は Playables を非対応としている。
4 joints/vertex、sparse accessor の対象制限、shader の UV 上限も受理 profile と照合する必要がある。
[Project Setup](https://docs.unity3d.com/Packages/com.unity.cloud.gltfast@6.20/manual/ProjectSetup.html) に従い、runtime に必要な shader variants の build 同梱を別途保証する。
