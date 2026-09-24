# Presentation Surface 描画方式の検証条件

- **Status**: Accepted（描画方式は確定。実機 profile と測定結果は未確定）
- **Date**: 2026-09-15
- **Scope**: 2026 年 11 月の MR プレゼンで使用する Presentation Surface
- **Related**:
  - [Issue #73: 発表の絵コンテ v0](https://github.com/unframe-dev/unframe/issues/73)
  - [Issue #74: Web と Unity の UI 統一方式の比較条件](https://github.com/unframe-dev/unframe/issues/74)
  - [Issue #76: 実機デモの制約と必要な MR 表現](https://github.com/unframe-dev/unframe/issues/76)
  - [Issue #77: UI 表現方式の決定](https://github.com/unframe-dev/unframe/issues/77)
  - [Issue #78: UI 統一方式の実機 PoC](https://github.com/unframe-dev/unframe/issues/78)
  - [ADR-0014: Presentation の描画方式を限定する](../decisions/0014-presentation-rendering-scope.md)
  - [ADR-0012: Texture budget と residency contract](../decisions/0012-texture-budget-residency-contract.md)

## 1. 目的

[ADR-0014](../decisions/0014-presentation-rendering-scope.md) で採用した Native 3D、`baked-web`、`native-ui`、`video` について、適用条件と Quest 実機で残る性能リスクを検証する。方式の採否を比較し直す文書ではない。

Issue #73 と #76 から確定した入力を PoC profile として記録し、Issue #78 の実機結果を Issue #77 から参照できる形で残す。

対象は Presentation 内に配置する Surface である。Web Editor など Unframe 自身の操作 UI は対象外とする。Surface の移動、回転、拡縮、表示、opacity は Unity の Spatial Node / Timeline が担当する。

## 2. 採用方式と現在地

| 方式        | 適用範囲                           | 現在地                                                                   |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------ |
| Native 3D   | Model、空間配置、移動、回転、拡縮  | Unity target。Presentation Runtime とは未接続                            |
| `baked-web` | 静的 UI、少数の有限 Surface State  | Local Compiler の初期 subset を実装済み。Delivery / Unity は未接続       |
| `native-ui` | Timer、Counter、短い動的 Text      | portable contract / Unity adapter / 固有 budget は未実装                 |
| `video`     | 入力非依存で事前確定できる連続映像 | artifact / Unity adapter / decoder budget は未実装。v1 Delivery は非対応 |

`embedded-web`、WebView、Unity Runtime で任意の HTML / CSS / JavaScript / WebAssembly を実行する方式は対象外であり、検証候補に含めない。`baked-web` の Opaque TS / React / CSS は固定した build-time Browser 内だけで実行し、生成済み Texture を配信する。

描画方式の採用は、実機性能や配信対応の完了を意味しない。ADR-0012 の v1 Delivery baseline は `baked-web` Texture だけを対象とする。`native-ui` と `video` は方式固有の budget と consumer 実装が受理されるまで Delivery で拒否する。

## 3. PoC profile と fixture

性能測定を始める前に、次を一つの profile として固定する。未確定欄があれば結果を参考値として扱い、合否判定に使用しない。

- 絵コンテから選んだ代表 scene、Surface 内容、State、遷移、表示時間
- Runtime 値の型、範囲、更新頻度、format、authority、client 間の同期許容差
- Quest 機種、OS、Unity / XR package、build type、Graphics API、refresh rate、passthrough
- 同時表示 Surface 数、logical / physical size、解像度、State / clip 数、3D scene 負荷
- cold / warm start、連続稼働時間、pause / resume、renderer 再生成、再接続の回数
- CPU / GPU frame time、dropped frame、RAM、GPU memory、storage、startup / update / recovery の上限
- reference Browser、viewport、DPR、font、locale、timezone、color space、pixel / color 差と SSIM 閾値

必要な方式だけを同じ standalone Unity scene と deterministic scenario driver で検証する。

| Fixture              | 検証する内容                                                               |
| -------------------- | -------------------------------------------------------------------------- |
| Finite State Surface | `baked-web` の State artifact、cut / crossfade、Spatial animation          |
| Dynamic Text Surface | 必須用途がある場合の Timer、Counter、短い Text と portable binding         |
| Precomputed Motion   | 必須用途がある場合の Video、canonical playback epoch、seek / loop          |
| Spatial Scene        | Native 3D と Surface を含む最大負荷の移動、回転、拡縮                      |
| Recovery             | pause、renderer 破棄、resume、Snapshot 相当値の再適用後の State / 時刻復元 |
| Baseline             | 同じ scene から対象を除いた CPU、GPU、memory の差分                        |

この PoC は renderer と実機負荷を検証する。未完成の Delivery / Realtime へ接続せず、end-to-end Delivery、network latency、production recovery の成立証明にはしない。

## 4. 測定と判定

各試行で device / OS、battery と給電、室温と thermal state、Unity / XR / graphics 設定、artifact checksum、renderer / codec version を記録する。端末、build、fixture、設定が異なる結果を同じ集計へ混ぜない。

- fidelity: reference と Quest capture、文字、alpha、color、font の差
- performance: CPU / GPU frame time、dropped / synthetic frame、RAM、GPU memory、thermal throttling
- timing: first correct frame、State / Runtime 値の更新、client 間同期、Video 再生位置
- recovery: pause / resume、renderer 再生成、再接続後の復元時間と成功率
- artifact: build 時間、size、State / Surface 数、同一入力を 3 回 build した checksum
- operation: build、端末更新、debug、依存物 / license、未解決事項

`baked-web` は ADR-0012 の 2K-long-edge PNG / RGBA32、GPU 256 MiB、serial load CPU 256 MiB を hard gate として別途検査する。これは Quest process 全体の実測 memory 上限ではない。Native UI と Video の上限は Texture budget から推測せず、各方式の contract と実測に基づいて決める。

すべての方式は PresentationDefinition の意味状態、canonical time、および方式ごとに許可された Runtime input（tracking / anchor sample など）から表示を再現でき、artifact / font / codec / plan の integrity と互換性を配信前に検証できなければならない。portable subset や性能上限に収まらない表現は contract を暗黙に広げず、採用済み方式の責務へ分解して再設計する。

Session 中の renderer 変更、暗黙 downscale、mipmap 削除、artifact 差し替え、crossfade から cut への変更を fallback として許可しない。

## 5. 出力と完了条件

PoC 結果には fixture と artifact の参照、全測定値、baseline 差、試行数、失敗数、gate の pass / fail、visual 差、実機未検証項目、検証できた Current / Target contract の範囲を記録する。

PoC profile の全項目が確定値または根拠付き `N/A` であり、実際に使用する各方式の必要 fixture と gate の結果、未検証項目、11 月の demo に残す risk owner が揃った時点で完了とする。
