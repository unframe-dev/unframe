# Unity WebGL 動画 Blob URL spike

本番への組み込み前の独立実験。`app/unity` や Runtime の機能広告は変更しない。

## 再現

Unity 6000.3.22f1 と WebGL Build Support、有効なライセンス、既存 pnpm workspace、Playwright Chromium が必要。

```sh
scripts/experiments/media-video/build.sh
node scripts/experiments/media-video/server.mjs
# 別 terminal。今回利用した既存 browser を明示する。
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$HOME/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome" \
  scripts/experiments/media-video/browser-check.sh
```

`build.sh` は `.unframe/media-video-spike/project` に最小プロジェクトを生成し、既存の `nix run .#unity-editor` でビルドする。ブラウザ検証は既存 `playwright-core`、Nix dev shell と同じ pinned nixpkgs の cups/cairo/pango ライブラリを使う。ホストへのインストールは行わない。`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` を省略した場合は既存依存の標準 browser path を利用する。未導入 browser は自動取得しない。

fixture は同梱 MP4、identity、ffprobe 結果が正本。再生成には既存 FFmpeg 8.1.2 を使った。ツールがない環境では `nix shell nixpkgs#ffmpeg -c scripts/experiments/media-video/generate-fixture.sh` を使えるが、version が変わると bytes は変わり得る。生成スクリプトは identity を更新する。合成パターンと 440Hz 正弦波のみを使い、fixture は [CC0](fixtures/LICENSE.txt)。

## 実測（2026-10-19）

Linux x86_64、Unity 6000.3.22f1、Chromium 149.0.7827.55（既存 Playwright revision 1228）、headless WebGL2/SwiftShader で、Unity `VideoPlayer` を実行した。HTMLVideo 単体や bridge mock の結果ではない。詳細は [results-linux.json](results-linux.json)、全イベントと screenshot は `.unframe/media-video-spike/browser-result.json` と `unity-video.png`。

- 320×180、30fps、6秒。H.264 High/level 4.1、yuv420p/8bit/progressive、AAC-LC/stereo/48kHz。282,256 bytes、SHA-256 `c680a9ea08919f4da4189d6d88da18394408f4bf965648aed45928dc0c53fb64`。
- ローカル fixture 用 Bearer を付けた fetch → 全 bytes の size/SHA-256 検証 → `Blob(type: video/mp4)` → Object URL → `VideoPlayer.url` → `Prepare` が成功。Unity に認証ヘッダーを渡す経路は使用しない。未認証は 401、size/hash 不一致は URL 作成前に拒否。
- `VideoAudioOutputMode.Direct` で audio track を1本認識。クリック後に実 decode と RenderTexture の変化を確認。HTMLMediaElement の decoded audio bytes が増え、同要素を Web Audio analyser に接続して RMS 約0.063を観測。headless には Playwright の mute-audio があるため、実スピーカーからの聴音を検証したものではない。
- CDP `Runtime.evaluate(userGesture:false)` で activation を避けると `play()` は `NotAllowedError`、video は時刻0で停止。クリック後は `play()` が成功する。Unity の `started` は拒否時にも発火したので、これだけを再生成功の根拠にできない。
- pause 後に1.25／4.1／2.05秒へ seek。browser `currentTime` は目標との差1μs以下、Unity `time` の最大差は16.7ms。3地点で異なる RenderTexture hash を確認。`seekCompleted` の時点で texture が旧フレームのことがあり、300ms の観測待ち後に確認した。動画のフレーム精度は保証しない。
- `Stop` → targetTexture 解除 → VideoPlayer 破棄 → RenderTexture.Release/Destroy → `revokeObjectURL`。video が pause・Blob参照なしになり、旧 URL の fetch は失敗した。decoder/GPU/OSメモリの回収量や回収時刻は未測定。
- size/hash は正しいが動画として無効な19bytesを認証付き取得するケースでは `errorReceived`、`isPrepared=false`。失敗後も破棄と URL revoke が成功した。

spike の seek assertion は暫定150ms以内。この短い単一素材の結果だけでは製品の許容誤差や再同期閾値は確定できない。`completionMs` は callback 観測まで、`elapsedMs` は追加300ms待ちと通信・計測負荷を含む。RenderTexture readback によるGPU stallもあるので、性能や decoder budget の根拠にしない。

## 採用判断と未検証

検証済みの encoded bytes を Blob URL として Unity WebGL VideoPlayer に渡す方式は、この環境では成立した。ブラウザの再生拒否を検出し、利用者操作で再開する adapter が必要。全体取得と Blob の保持が必要なため、大きい素材でのメモリ予算は別途実測する。

Native VideoPlayer、macOS/Safari、Firefox、実GPU、Quest/Android、実Control Plane/Delivery署名付き認証、期限切れ、Range、同時decoder数、長時間切替、取消競合、音声の実出力、長時間 drift は未検証。ローカル Bearer fixture は既存サーバーの認可を検証するものではない。

根拠: Unity 6.3 [Web動画制約・音声出力](https://docs.unity3d.com/6000.3/Documentation/Manual/webgl-video.html)、[Prepare](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Video.VideoPlayer.Prepare.html)、[time](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Video.VideoPlayer-time.html)。Blob URL の実用可否は公式ドキュメントの保証とは分けて上記実測で判断した。
