# Model / Video playback example

同じ GLB を使う2つの Model、音声付き6秒 MP4、操作用 Surface を持つ Authoring project です。モデルは mesh / skin / morph と1秒の `clip-0` / `clip-1` を含み、配置 TRS と opacity は instance ごとに異なります。素材の利用条件は `assets/*-LICENSE.txt` と `FONT-LICENSE.txt` を参照してください。

repository root で実行します。初回の Fixed Browser と Unity Preview の準備、Local Editor の起動方法は [Web README](../../app/web/README.md#local-editor-の起動) を参照してください。

```bash
nix develop --command pnpm --filter @unframe/unframe-cli run presentation lock refresh "$PWD/examples/media-presentation"
nix develop --command pnpm --filter @unframe/unframe-cli run presentation check "$PWD/examples/media-presentation"
nix develop --command env PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" \
  pnpm --filter @unframe/unframe-cli run presentation build "$PWD/examples/media-presentation"
```

Local Editor の CLI 起動先を `examples/media-presentation` にして「再生」を押します。初期 Cue が両モデルの `clip-0` を loop 再生します。操作用 Surface の入力は次のとおりです。

- **Model play / pause / resume / stop**: 両 instance を操作します。**Model crossfade** は `clip-1` へ400msで切り替え、自然終了します。
- **Video play / pause / seek 0.25s**: 動画を操作します。音声開始には利用者の再生入力を使います。
- **Loop on / off**: Video の Surface State を切り替えます。切り替え後は **Video play** で再生します。
- **Host Timeline**: 操作用 Surface の opacity を600msで `1 → 0.4 → 1` と変化させます。

自然終了の Cue は `clipFinished` / `videoFinished` Variable を true にします。Local Editor のリセットで初期状態へ戻せます。CLI build の成功と Unity の実描画・音声確認は別の検証です。

Dev Previewは最新のローカル素材へ追従し、lockの素材pinと既存Distを変更しません。Dist buildはlockとの一致を要求するため、素材を確定したら上記の`lock refresh`を実行します。

ビルド後は通常ディレクトリの`dist`だけを別の場所へコピーして利用できます。Previewは再ビルドせず、CLIに用意されたWeb UIとUnity playerで表示します。

```bash
cp -R examples/media-presentation/dist /tmp/unframe-media-dist
nix develop --command pnpm --filter @unframe/unframe-cli run presentation preview /tmp/unframe-media-dist
```

公開には`UNFRAME_ACCESS_TOKEN`を設定し、`presentation publish /tmp/unframe-media-dist <presentation-id> <control-plane-origin>`を使います。元のAuthoring projectと、その中の`.unframe`は不要です。
