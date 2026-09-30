# PR #111 受け入れ条件の実装計画

2026-09-29 時点の計画。受け入れ条件の正本は [PR #111](https://github.com/unframe-dev/unframe/pull/111) の説明文。計画と途中の実装記録を示し、全条件の完了報告とはしない。

2026-09-30 の後続作業は `feat/complete-react-authoring-followups` にある。共有値・props spread・Transform spread の局所編集、継承へ戻す Undo / Redo、Core Cue executor による有限 State の Inspector preview を追加した。Compiler / CLI / Web の対象テストと型チェック、Structured の未分割描画と partition 合成の既存 Browser 比較テストが成功。CSS 変更による PNG 再生成の新規 Browser テストも成功したが、通常の fixture 依存準備は registry timeout となるため、成功時はテスト実行中だけ `PNPM_CONFIG_MINIMUM_RELEASE_AGE=0` を指定した。PR #111 の head には未反映であり、性能計測、追加の失敗注入、publish / Delivery・端末の統合は未完了。

## 実装の進捗

2026-09-29、起点 head からの変更として以下を実装した。PR の全受け入れ条件はまだ完了していない。

- 自動分割側の差分を統合した。Structured の全 State に共通する partition、capture / empty、Surface 単位の操作領域と透明背景を扱う。Opaque の所有契約と capture 拒否は保持する。
- package export の React Component の非実行抽出・型検査・lock 固定、JS → CSS → image / font の依存追跡を接続した。通常 check / build の lock 不変、移動・Props 変更時の ID 安定、外部 CSS URL / dynamic require の拒否を対象テストで確認した。
- CLI は config / Source / lock の revision を dist 置換前に再検査する。stale な build は成功済み dist を保持し、未公開 generation を回収する。Editor の Source / lock 保存 transaction はまだ接続していない。
- 操作領域の ADR を [ADR-0021](../decisions/0021-surface-interaction-geometry.md) として統合し、React ADR-0019 との番号衝突を解消した。

統合担当の対象検証は Contracts v2 32、Core 196、Renderer API 63、Renderer Web unit 62 と Fixed Browser integration 4、Compiler 229 テストが成功した。静的経路担当は Compiler の抽出・静的解決・固定 package・JSX の対象テスト、CLI React project 7 テストと型チェック・対象 lint を確認した。CLI の revision・atomic output・参照 build も対象テストを実行し、stale 拒否と成功済み dist の保持を確認した。テスト集合には重複があるため件数は合算しない。コミット前の包括検証として `nix run .#check` も終了コード 0 で成功した（Control Plane、Presentation packages と Fixed Browser 参照 build、Realtime、LP、Web）。秘密情報の未設定と Web bundle サイズの警告は残る。

raw package JS helper の named import は仮想型宣言で未対応であり、今回の JS 閉包試験は side-effect import を対象とする。

package Component は named import と、local module で import 後に named export する形に対応する。package からの直接の `export { Hero } from "ui-kit"` は既存の static 宣言規則に従って拒否する。

次の未完了境界は Opaque の固定 bundle → 隔離 worker → DOM binding geometry / RGBA capture。編集 metadata・元 Source への診断対応、Editor 保存・recovery、publish 検証合成、Delivery / consumer、混在 build の統合検証も残る。既存計画の各条件を残し、静的検証だけでこれらを完了にしない。

## 調査時点の起点と現状

- 起点は `origin/feat/react-component-authoring-foundation` の `46545ab20a1bc87b4c4abfc29d17e1f21aa17d40`。
- Surface の Structured / Opaque 分離、React の静的抽出・lowering、lock v2、CLI check 接続は実装されている。PR 冒頭の「Compiler 未接続」は現在の head と一致しない。
- CLI の公開コマンドは check / build / lock。React capture とローカル Editor host は未接続。既存 Editor は Source / lock の保存経路を持たない。
- `verifyPublicationIntegrityV2` は schema・参照・hash closure を検査するが、受け入れ境界での完全な意味検証・素材 bytes 検証の合成は別途必要。
- 自動分割側はローカル `feat/automatic-surface-partition` の `722192e` に未コミット変更がある。隣の worktree に `plan-surface-partitions.ts`、`partitionStrategyVersion: 1`、partition-local region 集約の削除、`0019-surface-interaction-geometry.md` が存在する。commit だけを統合してもこれらは入らない。統合対象の完成した差分を確定してから取り込み、進行中の変更を上書きしない。この ref は origin に存在しない。元 worktree の ADR ファイル名は変更せず、統合先だけを ADR-0021 とした。
- 現在の GitHub 表示では未解決 review thread は 0 件。CI 集約は成功だが Presentation Packages 等は skipped であり、この head の包括的な検証成功の根拠にはしない。

## 実装順

### 1. 自動分割との契約・基盤統合

Contracts / Core / Compiler / Renderer API の境界を先に揃える。自動分割側の確定した差分を統合し、React 静的経路と lock v2 を維持する。Opaque の内部を仮の Content Tree に変換しない。

- Structured の全 State から partition 集合・bounds・layer を決め、State ごとの capture / empty を保持する。Opaque は Surface 全体を描画単位とする。
- Hit Region を Surface 全体の logical 座標で扱い、partition・texture bounds・paint ownership・pixel rounding から独立させる。Structured は layout、Opaque は binding DOM 計測を所有する。
- 意味・Instance ID、派生 Render Surface ID、描画 identity を分ける。配置のみの変更を描画依存変更と混同しない。初期達成に cache 実装は要求しない。
- React の `0019-single-file-react-component-authoring.md` と自動分割側の `0019-surface-interaction-geometry.md` を ADR-0021 として統合し、番号衝突を解消する。Surface / lock / 計測責務の変更と schema・fixture・hash・drift check を同期する。

完了証拠：Structured の透明 button、狭い画像と広い操作範囲、複数 partition、空 State、clip / opacity。未知 State、未参照 artifact、不正 layer / binding の拒否。既存 Structured JSX の負例を維持する。

### 2. 静的経路・入力依存・診断の不足を埋める

対象は `unframe-authoring`、`unframe-compiler`、`unframe-cli`。既存実装を再実装せず、受け入れ条件ごとに不足する試験から着手する。

- React と Structured の別 TypeScript Program、非実行 AST 抽出、origin / mode の lock・assembly 整合を実 Compiler / CLI 経路で検証する。
- package origin は loader の表現だけで完了扱いしない。現行 `computeFrozenComponentInputs` は local Source 外の Component を拒否するため、package export からの Component 解決・固定も同じ契約で通す。未対応を残す場合は、その制約を受け入れ条件の未達として記録する。
- 同一 Instance の並べ替え・ファイル移動・Props 変更で意味 ID が変わらないことを検証する。
- CSS / JS / image / font の入力依存を閉じた graph として追跡する。配信 AssetSet は生成 PNG 等の必要な素材に限定し、元 Source を混入させない。参照・media type・bytes・checksum 検証を保つ。
- Manifest とは別の編集 metadata と、抽出 renderer / helper から元 Source への診断位置対応を整える。

完了証拠：実 Compiler の React 型正例・負例、getter / initializer / module / render 非実行、host node_modules・network fallback 拒否、通常 check / build による lock bytes 不変、明示再生成失敗時の旧 lock 保持。

### 3. 隔離 Browser capture を縦断接続

対象は Renderer API / Web、Compiler の描画計画、CLI の worker 管理。既存の [実行契約](../packages/REACT_COMPONENT_EXECUTION_CONTRACT.md) を実装の出発点とし、未検証の OS 隔離条件を動作済みと扱わない。

- 固定依存から virtual renderer を bundle し、公開契約 initializer を含めない。入力データと signal / deadline の実行制御を分ける。
- Linux namespace / bubblewrap / cgroup と Chromium sandbox の両立を実試験する。能力欠落時は実行前に拒否し、未信頼コードを緩い経路で実行しない。
- Structured / Opaque の計画完了後に全 Surface / State / partition の件数・画素・capture / output と複数 RGBA buffer の予算を検査する。worker の OS 制限も独立して検査する。
- 画像と binding geometry を同じ layout snapshot から取得する。欠落・重複・未宣言・除外済み binding、非対応 transform / clip を拒否し、viewport / enabled 規則を適用する。
- 作者の背景と未指定領域の透明性を保つ。font family / weight / style / fallback / glyph coverage を固定し、日本語・太字・欠落文字・複数 font を試験する。
- timeout / cancel / crash / 資源超過 / 隔離 unavailable を区別し、子孫 process と一時資源を回収する。失敗した出力を成功済み dist に置換しない。

まず単一 default State の Hero で check → build → 成果物検証を通す。次に有限 State と button を公開 SDK・抽出・lowering・capture に接続する。React は指定 State の描画を担当し、遷移は既存 Output → Cue → Action に接続する。viewer の入力許可は拡張しない。

完了証拠：実 UI 依存を含む fixture、上記の正常・拒否試験、隔離の実試験、全 State の意味・binding・画像対応、全公開成果物の反復 build 一致。

### 4. Source 保存と Editor / CLI 接続

Compiler が pure な command / patch、CLI が filesystem / ローカル host、Web が Inspector / preview を所有する。既存 fixture Editor の別永続形式へ Source を変換して正本を増やさない。

- Source と lock の snapshot / revision を揃え、保存後の build と preview / dist の置換を同じ revision に限定する。
- 直接 literal の scalar Props / Transform から始め、共有値・spread は対象 Instance の局所 override として編集する。
- lease / journal / receipt による保存、command 再送、外部編集競合、再起動 recovery を実装する。外部変更を自動 rollback しない。
- 同一 origin の認証付きローカル API と artifact 取得を接続し、構文・型・binding・font・描画・実行制御の診断を表示する。
- capture 失敗時は保存済み Source と最後の成功 preview を保持し、表示中 revision を区別する。古い build の完了で新しい preview / dist を上書きしない。

完了証拠：二 Instance の片方だけの編集、保存・再読込、共有値・対象外 Source の不変、各 journal 境界の失敗注入、応答喪失後の同一 command 再送、再起動 recovery、遅い旧 build の完了。

### 5. publish / Delivery の受け入れ境界

PR 本文が接続段階として分けた条件を独立した実装単位にする。後続 PR とする場合も、対応する実装・テストのリンクを条件ごとに残し、未接続のまま完了扱いしない。

- publish の受け入れ時に integrity、Definition / RenderBundle の意味・partition・State・binding、素材 bytes の検証を合成する。全 hash を再計算して整合させた不正成果物も拒否する。
- `partitionStrategyVersion` の Delivery 伝達先・検証責務・未知版の拒否規則を決定し、JSON / Proto と必要な Go / C# consumer を同期する。既存 Proto に単純に存在すると仮定しない。
- schema 生成と consumer 実装・生成を分けて確認する。相互運用 fixture と drift check を用意し、Unity の接続は Editor tests / 必要な実機確認で別途証明する。

この段階の設計判断は、現在の Delivery projection と consumer を調べてから ADR に記録する。remote registry / deploy や React 内部自動分割を追加する根拠にはしない。

### 6. 統合検証と受け入れ記録

- Structured + React 混在 Presentation を通常 CI の実 Compiler 型検査と build / 成果物検証へ組み込む。
- Structured の未分割描画と分割合成を比較する。透明 button・広い操作範囲・空 State・clip / opacity と React binding を合わせて確認する。
- 固定入力の全公開成果物一致、配置のみ変更で PNG 不変、CSS / font / 描画依存変更で必要な再生成を検証する。
- capture 失敗・cancel・stale build でも成功済み成果物を保持する。cold / warm build と編集から preview までの時間を、入力・環境・測定方法とともに記録する。速度の合否値は現在未設定。
- PR の各 checkbox に実装 commit / test / 検証結果または完了した後続 PR を対応付ける。本文冒頭の実装状況もその時点の実装へ更新する。

## 受け入れ条件の対応表

PR 内の掲載順で識別する。全項目を対象とし、コードの存在だけでは達成扱いしない。

| PR の条件                     | 工程    | 決定的な検証                                   |
| ----------------------------- | ------- | ---------------------------------------------- |
| Surface と所有範囲            | 1       | Structured のみ自動分割、Opaque 一描画単位     |
| 操作領域の独立性              | 1・3    | 透明 button / 広い操作範囲の Surface 座標      |
| State と分割構造              | 1・3    | 全 State 固定 partition / empty / 不正入力拒否 |
| ID と hash の責務             | 1・2・6 | 移動・並べ替え・Props で意味 ID 不変           |
| lock と依存の固定             | 2       | fallback 不可、通常 build で lock 不変         |
| 入力アセットと配信アセット    | 2・3    | CSS 依存追跡、配信への Source 混入なし         |
| 型検査と静的抽出              | 2       | 実 Compiler 正負例と非実行証拠                 |
| 文書と生成物                  | 1・6    | ADR 参照整合、schema / fixture / drift         |
| 画像と geometry の一致        | 3       | 同一 snapshot と binding 拒否試験              |
| 透明合成とフォント            | 3       | alpha / 日本語 / 太字 / glyph / fallback       |
| 予算と隔離実行                | 3       | 全計画予算、複数 buffer、隔離実試験            |
| 失敗と回収                    | 3・6    | process / 一時資源回収、dist 保持              |
| 有限 State と入力権限         | 3       | Output → Cue → Action、viewer 制約             |
| 編集 metadata と診断          | 2・4    | metadata 分離、元 Source 位置、診断分類        |
| 保存と成果物の鮮度            | 4       | revision / 再送 / recovery / stale 完了        |
| 受け入れ検証の合成            | 5       | hash 整合した不正成果物・素材改変の拒否        |
| wire と consumer              | 5       | 未知版、生成 drift、相互運用 fixture           |
| 混在 fixture と実 Compiler CI | 6       | check → build → 検証                           |
| 分割合成・操作領域の統合試験  | 6       | 未分割比較と意味・表示対応                     |
| 再現性・鮮度・所要時間        | 6       | 全成果物比較、失敗注入、計測記録               |

## 検証とレビューの進め方

各工程で対象テストの Red → Green → Refactor を行う。例：`pnpm --filter @unframe/unframe-compiler test test/extract-react-components.test.ts`、CLI の `test/react-project.test.ts`、Core の `test/publication-integrity-v2.test.ts`。実行時には変更範囲に合わせ package scripts を確認する。

Browser integration は Renderer Web の通常 test から除外されているため、`scripts/dev/test-presentation-browser.sh` と追加する Opaque integration 経路を明示的に実行する。Structured reference の反復 build は `scripts/ci/presentation.sh` にある。通常 unit test の成功を Browser 隔離成功の代用にしない。

工程1は architecture-reviewer、工程3は security-reviewer、保存経路は code-reviewer を必要な時点で各1担当に依頼する。文書の大幅更新は docs-reviewer に依頼する。レビュー指摘は主担当が仕様・差分と照合する。

包括的な `nix run .#check` は予定変更を終え、明示的なコミット依頼を受けた時に実行する。Nix を変更した場合の `nix flake check`、Unity Editor tests、隔離環境・consumer の実試験はそれぞれ別に記録する。計画作成時点ではテストは実行していない。
