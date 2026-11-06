# PNG CPU 予算の過大計上

2026-11-06。[Issue #313](https://github.com/unframe-dev/unframe/issues/313) の検証記録。
起点は `origin/main` の `c445c4ed106fbfb88b8d5ef70f7ac3f1c8e465a8`。

## 原因と修正

`buildPngPlan` は、それまでの画像の decoded bytes（GPU 使用量）を次の画像の CPU ピークに加算していた。
本番の PNG texture pool は画像ごとに GPU upload の完了を確認し、CPU bitmap を解放してから次を読み込む。
このため、計画段階の CPU 判定を各画像の `decoded bytes × 2 + encoded bytes` に合わせた。予算上限は変更していない。

GPU と encoded cache の累積判定は維持する。pool は実行時に encoded cache と外部の CPU 保持量を合算し、必要なら cache を退避して再判定する。
pool を使わず bitmap を保持する読み込み経路では、`admitPngMemory` が累積保持量を検査する。
context loss 後は pool を破棄し、復旧時に再ロードする。

## 実データのブラウザ比較

HeadlessChrome `155.0.0.0` で同一の Delivery と実 PNG / GLB を使用し、`createPresentationSession` と Three.js renderer を実行した。
公式 Cue 実行と Playback projection で44時点の独立した snapshot を生成し、各 snapshot を新規 Runtime に適用した。固定アンカーの連続遷移1件を加えた45ケースを比較した。
カメラ姿勢と通信入力は検証用に与え、素材取得・デコード・GPU upload・描画は実装を使用した。

| 対象                  | 修正前                             | 修正後                             |
| --------------------- | ---------------------------------- | ---------------------------------- |
| 全45ケース            | 44成功・1失敗                      | 45成功                             |
| `demo/original-shown` | Runtime `ready`、Rendering `error` | Runtime / Rendering ともに `ready` |

修正前の失敗は `PNG presentation: CPU texture budget exceeded`。
`opening-wait` → next → `opening` → 6,001 ms → `opening-ready` → next → `original-enter` → 3,361 ms → `original-intro` → next → `original-detail` → 時間を進めず next → `original-shown` の入力系列から生成した snapshot で再現した。
比較時は旧 `png-plan.ts` だけを Vite の transform で差し替え、その他のコードと入力は同一にした。
成功は `renderer.render` の実行と Runtime / Rendering 状態による判定であり、描画内容の画素比較は行っていない。

| descriptor に基づく値           |      bytes |
| ------------------------------- | ---------: |
| 標準 CPU 上限                   | 67,108,864 |
| 画像単体の最大 CPU ピーク       | 50,335,057 |
| 旧判定の拒否時累積 CPU ピーク   | 75,058,513 |
| 対象6画像の decoded 合計（GPU） | 47,267,840 |

[再実行手順](../../../../../scripts/audience-example-validation/README.md)、[修正前45件](./audience-png-cpu-budget/before-results.json)、[修正後45件](./audience-png-cpu-budget/after-results.json)、[画像 descriptor と計算値](./audience-png-cpu-budget/texture-descriptors.json)、[build 整合性](./audience-png-cpu-budget/integrity.json)を保存した。

### 検証の制約

今回の example 新規ビルドは `cli-style-worker-failed: Seatbelt filesystem/network deny probe failed` で停止した。
実行コマンドは `bun .unframe/audience-example-check/debug-build.ts`。この診断用スクリプトから `runPresentationCli` に `['build', process.cwd() + '/example', '--format', 'json']` を渡した。
既存の `example/dist` を使い、今回と生成元 checkout の example Git tree が同一であること、および definition / render-bundle / asset-set の hash が build manifest と一致することを確認した。選択した19アセットも SHA-256 を照合した。
両 checkout の example tree は `eb9065358c43145aebda4a8bf3e2121c081111a6`。

ブラウザの heap / GPU 使用量は実測していない。予算の bytes は descriptor から計算する admission の値である。
スマートフォン、実トラッキング、実 WebSocket、実機の context loss / restore は未検証。
元の実機ログの切断原因が本件だったかも、この検証では確定しない。

## 自動検証

Node `v24.21.0`、pnpm `12.16.1`。リポジトリルートから実行した。

```sh
pnpm --filter @unframe-dev/audience run test \
  src/experience/test/png-residency.integration.test.ts \
  src/experience/test/presentation-session.integration.test.ts \
  src/experience/test/presentation-session.test.ts \
  src/rendering/test/png-plan.test.ts \
  src/rendering/test/png-memory.test.ts \
  src/rendering/test/png-presentation.test.ts \
  src/assets/test/png-texture.test.ts \
  src/assets/test/png-texture-pool.test.ts
pnpm --filter @unframe-dev/audience run check
pnpm --filter @unframe-dev/audience run build
```

8ファイル・134テスト、型検査、lint、Audience build が成功した。build は chunk size の警告あり。
画像の評価順による CPU 予算の誤拒否を修正前に再現し、修正後の成功を確認した。
CPU、GPU、encoded cache/reserve は上限一致を許容し、1 byte 超過を拒否する回帰テストを追加した。
リポジトリ全体の test/build を含む `nix run .#check` は、ローカル検証を影響範囲に限定する指示に従って実行していない。
