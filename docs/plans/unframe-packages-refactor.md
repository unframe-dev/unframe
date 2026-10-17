# Unframe パッケージのリファクタリング対象

- 状態: 実施対象を整理済み。実装は未着手。
- 対象: `packages/unframe-*` の全9パッケージ、直接関係する実行スクリプト、`docs/packages/` とパッケージ内文書。
- 調査基準: 2026-10-18 の `origin/main`、`997a44bc8498e97a07976e4f9ff2fe31ae6b328e`。

TypeScript を中心に維持し、入力の固定、検証境界、資源の寿命、構文解析と実行基盤の責務を整理する。以下を今後の実装対象とし、現行仕様と実装済み機能の説明には使わない。

## 言語と実行依存

### Unity テストスクリプトの Python を置換する

- 対象: [test-native-editor.sh](../../scripts/unity/test-native-editor.sh) の埋め込み Python。
- `Packages/manifest.json` とテスト用 `.asmdef` の生成を TypeScript または shell へ置き換え、この経路の Python 実行依存を除く。構造化 JSON の読込・生成は TypeScript を第一候補とし、起動とファイル配置は shell に残す。
- 確認: 元 manifest から選ぶ依存、固定 Unity module、DLL 一覧、asmdef の参照が意味的に一致すること。各 mode のプロジェクト準備とテスト起動を維持する。

### 低水準ファイル操作を C または Go の薄い層へ統一する

- 対象: CLI の [build-cache.ts](../../packages/unframe-cli/src/filesystem/build-cache.ts)、[atomic-output.ts](../../packages/unframe-cli/src/filesystem/atomic-output.ts)、[path-policy.ts](../../packages/unframe-cli/src/filesystem/path-policy.ts)。
- directory FD、相対ファイル操作、symlink 非追跡、atomic rename、同期・解放など、OS 操作を所有する層を C または Go の一方に統一する。使用言語と呼出方式は実装前に決める。
- 別言語の層はできるだけ薄くし、schema、checksum、cache key、保持方針、成果物の意味検証は TypeScript に残す。FD の寿命と必要な操作単位を同じ層で所有する。
- 確認: symlink・親ディレクトリ差替え、部分書込、異常終了時の解放、既存の失敗時動作。保証範囲は [CLI filesystem contract](../decisions/0013-local-compiler-project-filesystem-contract.md) と照合し、言語変更だけで保証が強まるとは扱わない。

## 優先して改善する実装

### Renderer の生成時入力を固定する

- 対象: [Opaque renderer](../../packages/unframe-renderer-web/src/opaque/capture/renderer.ts)、[combined-renderer.ts](../../packages/unframe-renderer-web/src/rendering/combined-renderer.ts)。
- factory 境界で config、programs、child identity と関数参照を固定し、以後は検証済み snapshot を使う。Structured renderer の既存境界と整合させる。
- 確認: 生成後に呼出元が入力や child method を変更しても、固定した fingerprint と対応判定・描画処理が食い違わないこと。

### CSS の独自解析と Browser 内の宣言走査を整理する

- 対象: [prepare-locked-opaque-bundle-input.ts](../../packages/unframe-compiler/src/semantic/prepare-locked-opaque-bundle-input.ts)、[fonts.ts](../../packages/unframe-renderer-web/src/opaque/capture/fonts.ts)。
- 正規表現による CSS 依存抽出を PostCSS AST と値 parser などの構文解析へ置き換える。URL の許可方針は別に保持する。
- フォント宣言は CSSOM の grouping と条件の有効性を扱う。長い埋め込み Browser JavaScript は型検査できる TS module への分離対象とする。
- 確認: コメント・content 文字列を依存と誤認しないこと、大小文字・escape を扱うこと。`@layer`、有効／無効な `@media`・`@supports` 内の `@font-face` は実 Browser fixture で確認する。grouping の問題は現在、CSSOM stub での確認に留まる。

### 成果物とキャッシュの検証境界を揃える

- 対象: [Author service](../../packages/unframe-cli/src/author/service.ts)、[Compiler cache](../../packages/unframe-compiler/src/cache/build-cache.ts)。
- Author の成果物読込は `JSON.parse` 後の型 assertion に依存せず、既存の generation 読込・integrity・asset checksum／サイズ検証を再利用する。表示用カタログへの変換は検証後に行う。
- cache adapter の `unknown` は、getter を実行する可能性がある `structuredClone` の前に安全に取り込む。JSON metadata と byte buffer の扱いを区別する。
- 確認: JSON 不正、checksum／サイズ不一致、enumerable getter、破損 cache、正当な byte entry。accessor を実行せず、破損 cache は miss として処理できること。

### 長寿命の状態と終了処理を整理する

- 対象: [Author service](../../packages/unframe-cli/src/author/service.ts)、[watch-project.ts](../../packages/unframe-cli/src/application/watch-project.ts)、[preview.ts](../../packages/unframe-cli/src/process/preview.ts)。
- job 履歴、request ID の再送契約、PNG 全バイトを持つ成果物キャッシュの寿命を分離する。表示中の generation を維持しつつ、保持容量または世代数に上限を設ける。
- snapshot 待機中に abort された場合、新しい build を開始しない。Preview の終了では受付停止と既存接続の終了を扱う。
- 確認: 連続ビルド時の保持量、現行画像と古い request の扱い、snapshot 待機中の abort、未完了 HTTP 接続を残した停止。

### 汎用 worker host を Web Renderer から分離する

- 対象: [run-style-worker.ts](../../packages/unframe-cli/src/styles/run-style-worker.ts)、[run-isolated-opaque-worker.ts](../../packages/unframe-renderer-web/src/opaque/isolation/run-isolated-opaque-worker.ts)。
- process 起動、mount、資源制限、終了確認の共通責務を、Style と capture が使う worker host へ分離する。Browser の配置・起動は Renderer 側に残す。
- Style が `browserPath` に worker 自身を渡す契約を解消する。この分離は TypeScript で行い、低水準ファイル操作の別言語化とは分けて扱う。
- 確認: Browser を要求しない Style 実行と、既存の隔離・資源制限・取消・capture integration。

### 入力不正と内部障害を区別する

- 対象: [compile-declaration-project.ts](../../packages/unframe-compiler/src/api/compile-declaration-project.ts)、[compile-authoring-project.ts](../../packages/unframe-compiler/src/api/compile-authoring-project.ts)。
- unsafe な入力検査の catch を境界へ限定し、内部例外を一律に `compiler-invalid-input` に変換しない。内部障害の code、処理段階、原因を host が観測できるようにする。
- 確認: malformed input と内部処理の失敗を区別できること。公開診断に機密や source 内容を無条件に出さないこと。

## 言語機能と TypeScript バージョン

### await using を資源管理へ適用する

- ファイル handle と一時領域の取得・解放を対象に、`await using` の採用箇所を決める。Bun／Node、TS の lib 設定、transpile／bundle 経路の対応を確認する。
- 確認: 通常終了、例外、取消での解放とその順序。解放を待つ処理が scope の外へ漏れず、既存の失敗診断を損なわないこと。
- 仕様: [TypeScript の explicit resource management](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-2.html)。

### lone surrogate の手書き検査を標準 API へ置換する

- 対象: CLI の [load-config.ts](../../packages/unframe-cli/src/filesystem/load-config.ts)、Core の [canonical-json.ts](../../packages/unframe-core/src/canonicalization/canonical-json.ts) と [plain-json.ts](../../packages/unframe-core/src/publication/plain-json.ts) など、文字列の well-formedness 検査。
- 対応 runtime と型定義を揃え、`String.prototype.isWellFormed()` を利用する。不正文字列を拒否する契約は維持し、`toWellFormed()` による補正へ変更しない。
- 確認: 正常な surrogate pair、孤立した high／low surrogate、既存の診断と canonicalization 結果。
- 仕様: [ECMAScript isWellFormed](https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.iswellformed)。

### TypeScript の更新方針を用途別に整理する

- 調査時点は CLI が 5.9.3、Compiler／Tailwind が 6.0.3、その他の型検査が 7.0.2。
- 型検査用ツールと組込み Compiler API を区別し、互換性を確認して更新・統一できる範囲を決める。一律の 7.x 更新は前提にしない。
- 確認: AST 解析、module resolution、authoring 型診断、Style worker の transpile、Tailwind の Node 実行。同じ入力の成果物と診断への影響を確認する。
- 資料: [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)。

## ドキュメントのリファクタリング

### 監査範囲と判断基準

`docs/packages/` の全11文書と、`packages/unframe-*` 内の全11 Markdown（1,187行）、フォントライセンスを、上記 commit の実装・公開 API・package manifest・生成スクリプト・既存テストと照合した。以下の行番号は監査時点の位置であり、修正時は節と記述でも照合する。

文書修正は未着手。実装済みの範囲、未実装の目標、過去の測定・実装記録を区別する。規範的な契約と実装の不一致は、文書を現状へ合わせるだけで解消せず、仕様判断が必要な項目として残す。既存テストはソースを確認したもので、この文書監査では再実行していない。

### 実行手順と公開 API を訂正する

| 対象                                                                                      | 確認した乖離と修正内容                                                                                                                                                                                                                                             | 実装根拠                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [CLI Architecture](../../packages/unframe-cli/ARCHITECTURE.md) 162行                      | 存在しない `build:author` を `pnpm --filter @unframe/web build:editor` に変更する。                                                                                                                                                                                | [Web scripts](../../app/web/package.json)、[Author 起動](../../packages/unframe-cli/src/author/start.ts)                                                                                       |
| [Tailwind README](../../packages/unframe-tailwind/README.md) 20行                         | 裸の `unframe-cli` に対応する bin 定義がない。`pnpm --filter @unframe/unframe-cli presentation lock update/refresh <absolute-project-directory>` の実在する入口を示す。                                                                                            | [CLI scripts](../../packages/unframe-cli/package.json)                                                                                                                                         |
| [CLI Architecture](../../packages/unframe-cli/ARCHITECTURE.md) 56–68行                    | public API と process command が混在している。`runPresentationCli` の `init/check/build/test/lock` と、process 側の `author/dev/preview/publish` を分け、引数を各 parser に合わせる。                                                                              | [headless parser](../../packages/unframe-cli/src/application/run-presentation-cli.ts)、[process dispatcher](../../packages/unframe-cli/src/process/run-presentation-process.ts)                |
| [React execution contract](../packages/REACT_COMPONENT_EXECUTION_CONTRACT.md) 137–146行   | 編集 command は2種類ではなく `setProp/setTransform/inheritProp/restoreProp/inheritTransform/restoreTransform`。Undo / Redo の履歴は Web が所有する。project response の Definition、BuildJob の channel/generation、Dist・Preview API も現行 contract に合わせる。 | [Author contract](../../packages/unframe-cli/src/author/contract.ts)、[HTTP routes](../../packages/unframe-cli/src/author/http.ts)、[Editor](../../app/web/src/features/editor/editor-app.tsx) |
| [Renderer Web Architecture](../../packages/unframe-renderer-web/ARCHITECTURE.md) 26・73行 | `documentBackground` を設定項目とする説明と、受理しない説明が同居する。公開 config は空の strict object であり、背景は Frame の指定として説明する。                                                                                                                | [config schema](../../packages/unframe-renderer-web/src/validation/schemas.ts)、[拒否テスト](../../packages/unframe-renderer-web/test/renderer.test.ts)                                        |

### 実装済み機能と責務境界を同期する

| 対象                                                                                                                                                                                         | 確認した乖離と修正内容                                                                                                                                                                                                                                                                        | 実装根拠                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [React authoring](../packages/REACT_COMPONENT_AUTHORING.md) 275・324行、[execution contract](../packages/REACT_COMPONENT_EXECUTION_CONTRACT.md) 182–184行                                    | PostCSS / Tailwind を全面非対応とする記述を、project 所有 config、固定 Node graph、隔離 Style worker の対応範囲へ更新する。Component の意味抽出は非実行だが、PostCSS config/plugin は Node worker で実行するため「Node で user module を実行しない」を全処理へ一般化しない。                  | [project preparation](../../packages/unframe-cli/src/filesystem/prepare-project.ts)、[Style worker](../../packages/unframe-cli/src/styles/run-style-worker.ts)、[Tailwind README](../../packages/unframe-tailwind/README.md)                                                                                                                                                                             |
| [React authoring](../packages/REACT_COMPONENT_AUTHORING.md) 9・313行                                                                                                                         | Unity Preview を宣言初期 State の静止表示に限定する説明を、Cue / Timer / Timeline のローカル再生と play/pause/reset の実装範囲へ更新する。実サービス E2E・Quest 実機確認の完了とは区別する。                                                                                                  | [local playback](../../packages/unframe-cli/src/author/local-playback.ts)、[playback tests](../../packages/unframe-cli/test/local-playback.test.ts)、[Editor](../../app/web/src/features/editor/editor-app.tsx)                                                                                                                                                                                          |
| [React authoring](../packages/REACT_COMPONENT_AUTHORING.md) 277・326・332行                                                                                                                  | 現在も描画 cache と `init` がないとする記述を訂正する。存在するのは build 全体の cache であり、State ごとの細粒度 capture cache と同一視しない。2026-10-01 の測定値は当時の条件として保持し、現在の性能の証拠にはしない。                                                                     | [CLI orchestration](../../packages/unframe-cli/src/application/run-presentation-cli.ts)、[Compiler cache 利用](../../packages/unframe-compiler/src/api/compile-declaration-project.ts)、[build-cache tests](../../packages/unframe-cli/test/build-cache.test.ts)                                                                                                                                         |
| [DESIGN](../packages/DESIGN.md) 353行付近・605行付近・612–621行                                                                                                                              | TUI が command 選択のみ、publish/preview/Opaque execution が未実装という過去の説明を現在地と分ける。source patch、lock v2、隔離実行、Local Editor topology、wire schema、C# generation の実装済み範囲を Deferred から分離する。動的 plugin discovery、外部配布などの未完了項目は残す。        | [process dispatcher](../../packages/unframe-cli/src/process/run-presentation-process.ts)、[Compiler](../../packages/unframe-compiler/ARCHITECTURE.md)、[contracts](../../packages/contracts/ARCHITECTURE.md)                                                                                                                                                                                             |
| [ARCHITECTURE](../packages/ARCHITECTURE.md) 165・585・1021・1236行                                                                                                                           | AssetSet / BuildManifest 分離、capture、Structured subset、`hitPriority` に残る初期段階の未実装扱いを更新する。                                                                                                                                                                               | [atomic output](../../packages/unframe-cli/src/filesystem/atomic-output.ts)、[Compiler](../../packages/unframe-compiler/src/api/compile-declaration-project.ts)、[Definition schema](../../packages/contracts/src/presentation/definition.ts)                                                                                                                                                            |
| [ARCHITECTURE](../packages/ARCHITECTURE.md) 1999・2584・2587行                                                                                                                               | checkpoint/replay 未接続、Session が PublicationFence を持たない、Web が Slide PoC のみという記述を訂正する。Control Plane の既存 Group/Element Draft schema と、Local Editor の canonical Definition を混同しない。                                                                          | [Realtime 起動](../../app/server/realtime/cmd/server/main.go)、[Runtime session](../../app/server/realtime/internal/runtimecore/v2_session.go)、[Session repository](../../app/server/control-plane/src/modules/sessions/repository.ts)、[Session routes](../../app/server/control-plane/src/modules/sessions/routes.ts)、[既存 Draft schema](../../app/server/control-plane/src/presentation/schema.ts) |
| [UI rendering comparison](../packages/UI_RENDERING_COMPARISON.md) 28–30行                                                                                                                    | baked-web の Delivery / Unity 未接続、Native UI の portable contract 未実装という一括表記を更新する。schema、artifact 選択、Unity consumer、実機受入れを別々に記す。`native-ui` / `video` は現行 Delivery selection が拒否するため、contract の存在を配信対応済みと扱わない。                 | [RenderBundle schema](../../packages/contracts/src/presentation/render-bundle.ts)、[Delivery selection](../../packages/unframe-core/src/delivery/selection.ts)、[Unity README](../../app/unity/README.md)                                                                                                                                                                                                |
| [ARCHITECTURE](../packages/ARCHITECTURE.md) 556行、[Renderer API](../../packages/unframe-renderer-api/ARCHITECTURE.md) 56–68行、[Assets](../../packages/unframe-assets/ARCHITECTURE.md) 46行 | Structured の Hit Region は Compiler が共有 layout から生成する。Opaque は有効な semantic button binding の click region に対応し、Web Renderer がその計測 geometry から `hitRegionsByState` を返す。「全 geometry は Compiler」「Renderer は Hit Region を返さない」という一般化を解消する。 | [partition planning](../../packages/unframe-compiler/src/api/plan-surface-partitions.ts)、[Opaque Renderer](../../packages/unframe-renderer-web/src/opaque/capture/renderer.ts)、[API result schema](../../packages/unframe-renderer-api/src/validation/schemas.ts)、[Opaque tests](../../packages/unframe-renderer-web/test/opaque-renderer.test.ts)                                                    |
| [Renderer Web](../../packages/unframe-renderer-web/ARCHITECTURE.md) 120行                                                                                                                    | React DOM を将来扱いし、一律拒否する説明を更新する。現行の build-time bootstrap は locked React DOM を使用する。内部 bootstrap と作者の import を区別し、作者側の許可範囲は lock の生成側と resolver の両方で照合する。端末で Browser runtime を実行しない方針は維持する。                    | [bundle/bootstrap](../../packages/unframe-renderer-web/src/opaque/bundle-opaque-renderer.ts)、[closed-bundle tests](../../packages/unframe-renderer-web/test/opaque-closed-bundle.test.ts)                                                                                                                                                                                                               |
| [Renderer Web](../../packages/unframe-renderer-web/ARCHITECTURE.md) 38・108行、[CLI](../../packages/unframe-cli/ARCHITECTURE.md) 120行、[DESIGN](../packages/DESIGN.md) 64–77行              | Web Renderer は Core を直接利用する。CLI も Compiler/Renderer だけでなく Core/Contracts/Tailwind を利用する。依存の説明に Style 変換の所有境界を加える。Assets encode を Compiler 経由で呼ぶ説明は維持する。                                                                                  | [Structured Renderer](../../packages/unframe-renderer-web/src/rendering/baked-web-renderer.ts)、[CLI manifest](../../packages/unframe-cli/package.json)、[project preparation](../../packages/unframe-cli/src/filesystem/prepare-project.ts)                                                                                                                                                             |

### 契約の正本と例示を整理する

| 対象                                                                                                                                                      | 確認した乖離と修正内容                                                                                                                                                                                                                                                                                                   | 実装根拠                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [DESIGN](../packages/DESIGN.md) 363–371行                                                                                                                 | `presentation/v2` など旧ディレクトリを正本とする記述を、suffix のない canonical contract の配置へ更新する。                                                                                                                                                                                                              | [contracts architecture](../../packages/contracts/ARCHITECTURE.md)、[ADR-0024](../decisions/0024-canonical-presentation-contract-names.md)                                                                                                     |
| [DESIGN](../packages/DESIGN.md) 451行                                                                                                                     | C# client package の生成物を Unity へ取り込む説明と、現行の直接生成経路を分ける。                                                                                                                                                                                                                                        | [Unity proto generator](../../scripts/contracts/generate-unity-proto.sh)                                                                                                                                                                       |
| [Core Architecture](../../packages/unframe-core/ARCHITECTURE.md) 24・85・126行、[Renderer API](../../packages/unframe-renderer-api/ARCHITECTURE.md) 114行 | 「generated TypeScript contract」を、Contracts の手書き Zod schema と推論型、生成 JSON Schema / descriptor、Protobuf 由来 wire types に分ける。                                                                                                                                                                          | [Definition schema/type](../../packages/contracts/src/presentation/definition.ts)、[generator](../../packages/contracts/scripts/generate-presentation.ts)                                                                                      |
| [ARCHITECTURE](../packages/ARCHITECTURE.md) 352・1214・2246・2333行付近                                                                                   | SharedRuntimeState の clock、RenderIntent の vocabulary、schemaVersion 1 の RenderBundle と models、NativeText の variable binding、UInt64 と JSON safe integer の例を現行 schema と照合する。冒頭に v2 契約優先の注記はあるが、古い例をコピー可能な現行型として残さない。説明に不要な型全文は正本への参照へ置き換える。 | [contracts source](../../packages/contracts/src/presentation)、[runtime projection schema](../../packages/contracts/src/presentation/runtime-projection.ts)、[RenderBundle schema](../../packages/contracts/src/presentation/render-bundle.ts) |
| [ARCHITECTURE](../packages/ARCHITECTURE.md) 2197行                                                                                                        | semantic override の `null` による削除を tableLabel のみに限定しない。language も nullable / deletion 対象である。                                                                                                                                                                                                       | [semantics schema](../../packages/contracts/src/presentation/semantics.ts)、[materialize](../../packages/unframe-core/src/semantic-tree/materialize.ts)                                                                                        |
| [CLI Architecture](../../packages/unframe-cli/ARCHITECTURE.md) 37行                                                                                       | build lease の `process-local` を訂正する。project root の排他的ファイル作成によってプロセス間でも競合を防ぐ。                                                                                                                                                                                                           | [build lock](../../packages/unframe-cli/src/filesystem/build-lock.ts)                                                                                                                                                                          |

### 文書修正だけで閉じない項目

- **Core の validation 保証**: [Core Architecture](../../packages/unframe-core/ARCHITECTURE.md) 87–89行は全公開 validator に `ValidationResult<T>`、stable code/path、snapshot 後の Zod 検証を保証している。[Runtime projection](../../packages/unframe-core/src/runtime/projection.ts) の `validateRuntimeVisibilitySelection` と `validateM3dCueRuntimeSnapshot` は入力を直接 `safeParse` へ渡し、これらと `validateCanonicalRuntimeSnapshot` は `string[]` を返す。Canonical validator は snapshot を実施する。現状の保証範囲をまず明記し、API を統一する場合は別途戻り値・呼出元・accessor 境界の回帰テストを含む実装変更として扱う。監査では accessor 実行の再現テストを行っていない。
- **Snapshot catch-up**: [Runtime contract](../packages/CONTRACT_RUNTIME.md) 135行は初回を含む3回・合計250 ms を規定し、[gRPC service](../../app/server/realtime/internal/transport/grpc/v2_service.go) もこの limit を広告する。一方、確認した送信経路には Snapshot の cut を取り直す retry がなく、遅い subscriber は queue 上限で失敗する。規範を実装するか、契約と広告値を変更するか判断し、競合・上限・timeout のテストで一致を確認する。
- **Assignment failure reason**: [Runtime contract](../packages/CONTRACT_RUNTIME.md) 284行の `runtime_assignment_unavailable` に対応する経路が監査では見つからなかった。[assignment mapping](../../app/server/realtime/internal/transport/grpc/assignment.go) を起点に到達不能と inactive の区別を再確認し、予約された契約か未実装の error mapping かを決める。現時点では確定した誤記として削除しない。

### 要限定の表現と、変更不要と判断した範囲

- [Core](../../packages/unframe-core/ARCHITECTURE.md) の Target extensions は、実装済み projection/snapshot subset と残る目標を分ける。Target という見出しだけを誤りとしない。
- [Authoring](../../packages/unframe-authoring/ARCHITECTURE.md) の lock 形式 Deferred と [Components](../../packages/unframe-components/ARCHITECTURE.md) の「Compiler / Renderer の対応 contract 実装後」は、ローカル lock v2・既存 Compiler 処理と、外部配布・標準 Component の検証範囲を分けて明確化する。Components 自身が resolution や lowering を所有するようには変更しない。
- [DESIGN](../packages/DESIGN.md) の Target tree にある `docs/presentation/`、`scripts/presentation/` と、現在の `docs/packages/`、`scripts/ci/`、`unframe-tailwind` の配置を区別する。将来の配置案を未実装という理由だけで誤記にしない。Browser capture が未確定とする箇所は、現在の固定 Browser と残る platform 別検証を分ける。
- Compiler の Role が Structured 境界を説明していること、CLI が Cue 実行器と生成済み State 画像を説明していることは、React/Opaque や再生機能を否定する記述とは判定しない。Node API 非依存の test を掲げる validation strategy も、既存 test の存在を保証する記述とは扱わない。
- `docs/packages/` の AUTHORING_CONTRACT、CONTRACT_ARTIFACTS、DATA_MODEL、LOCAL_EDITOR_DESIGN、LOCAL_EDITOR_TIMELINE_SPEC には、この監査で確定した乖離はない。パッケージ内の型試作 README、font fixture の説明・出力 hash、Assets の PNG/resize の主要契約、Tailwind の設定互換性・隔離の説明も照合した。全機能の実行受入れを意味しない。

### 計画文書の整理状況

完遂済みとして `automatic-surface-partition-plan.md`、`local-editor-timeline-implementation-plan.md`、`react-state-capture-acceptance.md`、`tailwind-package-plan.md` を削除し、現行文書と実験 README の参照を整理済み。削除した計画を現行仕様の根拠として再導入しない。

PR111 の歴史的な計画も削除済み。[M6 の未完了事項](./presentation-packages-implementation-plan.md) には、Quest 実機の受け入れ検証と `pauseTimeout` の仕様・実装だけを残す。

### 対応順と完了条件

1. 実行できないコマンド、config、public API、Hit Region と validation の保証範囲を先に訂正する。
2. 機能の現在地・責務・契約の正本を `docs/packages/` と owning package の文書で同時に揃え、重複する型全文や過去の状態説明を整理する。
3. catch-up、error mapping、validation API 統一の要否を判断し、必要な実装変更を個別に検証する。判断前に規範契約を現在の制限へ弱めない。
4. 文書間のリンクと code/schema/script の参照を検査し、担当外の `docs-reviewer` に内容を確認してもらう。

完了には、実行手順が実在する script と引数に一致すること、Current/Target/過去の測定が判別できること、各確定指摘に対応箇所があること、未解決の仕様差分が明示されていることを必要とする。実装や生成 schema の複製を増やさず、意味・利用方法・所有境界に必要な説明を残す。

監査時は `docs/packages/` とパッケージ内文書のローカルリンク・アンカーの参照先を確認した。フォント fixture の SHA-256 も記載値と一致した。更新後も再検査し、削除済み計画への参照を残さない。

実装リファクタリングは対象限定の回帰テストで振る舞いを固定して進める。worker host と native 層の所有境界、実行依存が変わる場合は owning package と実行手順も更新する。包括的な品質ゲートはコミット依頼時にまとめて実行し、実 Browser・OS 固有操作・Unity Editor の検証結果は単体テストと区別する。
