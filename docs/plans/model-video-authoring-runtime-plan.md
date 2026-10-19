# 3Dモデルと動画のAuthoringとRuntime

対象はAuthoringからビルドしたGLBとMP4を、Local EditorのUnity WebGL Previewと通常Unity Runtimeの共通playerで表示・再生する経路である。素材登録・lock、検証と変換、再生Action / Output、canonical state / Run、Preview wire、Unity consumerを実装している。仕様は[Authoring契約](../packages/AUTHORING_CONTRACT.md)、[成果物契約](../packages/CONTRACT_ARTIFACTS.md)、[Runtime契約](../packages/CONTRACT_RUNTIME.md)、利用例は[media-presentation](../../examples/media-presentation/README.md)を参照する。

## 受け入れ結果

2026-10-19時点で今回の実装と受け入れを完了した。

- 実Local Editor WebGLで、同一GLBの2つのModel、独立した配置・opacity、clip play / pause / resume / crossfade / 保持姿勢を確認した。
- MP4の実フレーム変化、音声decode、pause / seek / loop、State切替、自然終了、Session pause時の実decoder停止と時刻保持、リセット、Dev / Dist切替を確認した。
- browser activationなしの再生拒否、エラー表示、利用者の再生クリックによる復帰を確認した。旧Video elementは切替後に停止し、未準備状態へ戻る。
- 対象packageのテスト・型・lint、契約生成drift、Unity Editorの追加・既存描画回帰47件、純粋C# adapter、Nix flake checkが通過した。Preview無効化時のdecoder停止はTransaction回帰テストで確認した。

実WebGLの受け入れテストは[`local-editor-media-webgl.spec.ts`](../../app/web/e2e/local-editor-media-webgl.spec.ts)。生成済みUnity PreviewとWeb editor、導入済みH.264/AAC対応Chromium、Fixed Browser、隔離capture scopeが必要となる。

```bash
nix develop --command env UNFRAME_REAL_WEBGL=1 \
  PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" \
  scripts/dev/opaque-capture-scope.sh pnpm --filter @unframe/web test:e2e \
  e2e/local-editor-media-webgl.spec.ts --project chromium
```

Chromium実行ファイルは`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`で指定する。NixOSではNixで導入したChromium / Chromeのwrapperを指定するか、配布版Chromiumに必要な共有ライブラリを用意する。証跡は`.unframe/actual-webgl-evidence/media-dev.png`、`media-dist.png`、`media-diagnostics.json`へ保存する。

Quest実機、macOS、物理スピーカーでの聴取、今回の素材を用いた通常Runtimeの実HTTP / Realtime接続は未検証である。通常Runtimeのconsumerは共通playerとEditor / C# adapterテストで検証し、実描画の受け入れにはLocal Editorを使った。

FBX、外部参照glTF、自動transcode、独立Audio、ライブ配信、layer / mask / additiveモデル合成、素材編集UIは対象外とする。
