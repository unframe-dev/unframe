# Audience の example 描画検証

リポジトリのルートで依存をインストールし、`example/dist` を `unframe build` で生成する。ブラウザの WebGL が必要。以下は `playwright-cli` が使える環境での実行例。

```sh
mkdir -p .unframe/audience-example-check
bun scripts/audience-example-validation/integrity.ts
bun scripts/audience-example-validation/generate.ts
pnpm exec vp dev --config scripts/audience-example-validation/vite-current.config.mjs --host 127.0.0.1 --port 4179
```

別ターミナルで実行する。

```sh
playwright-cli -s=audience-example open http://127.0.0.1:4179/scripts/audience-example-validation/
playwright-cli -s=audience-example run-code --filename=scripts/audience-example-validation/run-browser.txt
playwright-cli -s=audience-example run-code --filename=scripts/audience-example-validation/save-results.txt
```

結果は `.unframe/audience-example-check/after-results.json`。生成スクリプトは選択したアセットの SHA-256 を照合し、実アセットと 44 snapshot・固定アンカー遷移 1 件の入力を用意する。カメラと通信入力は模擬する。CPU 使用量を計測するものではない。

修正前の比較には通常のサーバーの代わりに次を実行し、URL のポートを `4181` にする。指定コミットの `png-plan.ts` だけをサーバー内で差し替える。

```sh
pnpm exec vp dev --config scripts/audience-example-validation/vite-before.config.mjs --host 127.0.0.1 --port 4181
```

修正前の結果は次で `.unframe/audience-example-check/before-results.json` に保存する。

```sh
playwright-cli -s=audience-example run-code --filename=scripts/audience-example-validation/save-before-results.txt
```
