# Model / Video fixture

同じGLBを使う2つのModel、音声付き6秒MP4、操作用Surfaceを持つCLI検証用projectです。モデルはskin / morphと1秒の`clip-0` / `clip-1`を含みます。素材の利用条件は`assets/*-LICENSE.txt`と`FONT-LICENSE.txt`を参照してください。

素材の登録は`unframe.config.ts`、配置とCueは`presentation.unframe.ts`、操作は各Componentのmanifestにあります。ControlsからModelの再生・停止・crossfade、Videoの再生・一時停止・seek・loop切替を操作できます。自然終了のCueは`clipFinished` / `videoFinished` Variableを更新します。

repository rootから検証します。buildにはFixed Browserの準備が必要です。

```sh
nix develop --command pnpm --filter @unframe/unframe-cli run presentation check "$PWD/packages/unframe-cli/fixtures/media-presentation"
nix develop --command env PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" \
  pnpm --filter @unframe/unframe-cli run presentation build "$PWD/packages/unframe-cli/fixtures/media-presentation"
```

Local Editorで開く場合は、[起動手順](../../../../app/web/local-editor/README.md)に従い、CLIへこのprojectを指定します。

```sh
pnpm --filter @unframe/unframe-cli dev -- "$PWD/packages/unframe-cli/fixtures/media-presentation"
```

Sourceを変更した場合は、buildの前に同じprojectへ`presentation lock refresh`を実行します。CLIのbuild成功とUnityの描画・音声確認は別の検証です。
