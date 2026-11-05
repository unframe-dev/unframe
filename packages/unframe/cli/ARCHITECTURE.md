# Presentation CLI Architecture

- **Status**: v2 State 別 build filesystem boundary
- **Scope**: Authoring Project を Compiler / Web Renderer に接続し、Bun 上の OpenTUI command selector と headless API を提供する
- **Related**:
  - [Presentation Implementation Design](../../../docs/packages/DESIGN.md)
  - [Presentation Compiler Architecture](../compiler/ARCHITECTURE.md)
  - [Web Renderer Architecture](../renderer-web/ARCHITECTURE.md)
  - [ADR-0013: Local Compiler の project filesystem contract](../../../docs/decisions/0013-local-compiler-project-filesystem-contract.md)

## 1. Role

`unframe-cli` は headless な `runPresentationCli` と、interactive な `runPresentationTui` を別 entrypoint
として公開する。CLI は Authoring semantic rule や renderer implementation を所有しないが、ADR-0013 に従い explicit
project root、data-only config / installed dependencies、Fixed Browser lifecycle、managed output の原子的公開を組み立てる。headless
application API はテスト用に Fixed Browser session factory、AbortSignal、固定 build context を注入できる。production default
は packaged Fixed Browser と固定 toolchain context を使用し、project reader や output directory は注入しない。

```text
runPresentationCli
├─ parse explicit absolute project directory
├─ M1 filesystem host: explicit root + config / installed dependencies, materialize virtual project
├─ check: unframe-compiler.checkAuthoringProjectAssembly（Browserなし）
└─ build: exclusive project build lock + compiler + unframe-renderer-web
   └─ managed staging + atomic Dist directory replacement
```

実装は package の public entrypoint だけを import する。Compiler / Renderer の内部 module を deep import
せず、input と adapter の accessor・mutation 防御は各 public boundary に委譲する。

```text
src/
├─ index.ts                              # headless export only
├─ application/
│  ├─ types.ts                          # headless host / result contract
│  └─ run-presentation-cli.ts      # check / build orchestration
├─ filesystem/build-lock.ts              # cross-process project build exclusion lease
├─ process/
│  ├─ main.ts                           # Bun executable entrypoint
│  └─ run-presentation-process.ts       # SIGINT/SIGTERM owner
└─ tui/
   ├─ model.ts                          # renderer-independent state and effects
   ├─ view.tsx                          # OpenTUI Solid view
   ├─ run.tsx                           # Bun / Zig core / keymap lifecycle
   └─ main.tsx                          # executable entrypoint
```

root export は native module を import しない。OpenTUI の Zig core を必要とする利用者だけが `./cli/tui` subpath
または `pnpm tui` を使う。これにより Node / Vitest 上の headless check と build は native TUI lifecycle から
独立する。

依存の導入・更新はプロジェクトが選ぶパッケージマネージャーが所有する。Unframe は install を実行せず、導入済み `node_modules` から package bytes・exports・依存 edge を取得する。workspace と symlink を実体へ解決し、peer dependency は利用元の解決 context を区別する。PnP は未対応である。

一回の解析・build は取得済みの Source・依存 graph・素材を入力とし、Component・Theme・style の carrier を生成する。Compiler は package manager や永続 lock を参照しない。旧 `unframe.lock` は Source の取得対象から除外する。依存 files と graph、Source、設定から revision を算出し、公開直前に再取得した revision と照合する。スタイル依存の取得前後にも導入済み依存を照合し、取得済み revision と異なる場合は解析を拒否する。別の環境・将来の再 build で完全に同じ Dist が得られることは要求しない。公開内容は生成済み Dist で保持する。

再利用する build 結果は `.unframe/cache/` に置く。キャッシュが無い・無効な場合は入力から再生成する。`.unframe/authoring/` の receipt / journal は保存・回復状態であり、削除可能なキャッシュには含めない。

## 2. Command contract

現行 public API の `args` は descriptor-safe snapshot の後に検査する dense な string array である。M1
process command は相対または絶対 project directory を受け、その realpath を root として同じ directory の `unframe.config.ts` と Source を読む。project root の上方探索は行わない。依存解決は利用元から祖先の `node_modules` を探索する。public input、command grammar、build context、host callback も descriptor-safe
snapshot と explicit validation で boundary validation する。host の callback
invocation と Compiler / Renderer の cross-boundary semantic diagnostics は、この構造検査の後に扱う。

```text
init <project-directory> [--format text|json]
check <project-directory> [--format text|json]
test <project-directory> [--format text|json]
build <project-directory> [--format text|json]
```

process entrypoint は上記を headless API へ委譲し、次の command を追加する。

```text
author <project-directory>
dev <project-directory>
preview <dist-directory>
publish <dist-directory> <source-presentation-id> <control-plane-origin>
publication-status '<operation-json>' <control-plane-origin>
```

`publish` と `publication-status` は、公開が確認できると `Presentation ID` に公開先の ID を表示する。

`check` は discovery、config、導入済み依存、Source frontend と assembly を検証し、Browser / Renderer を起動しない。

Source の解析・検証は `analysis/worker.mjs` の CPU Worker へ取得済み入力を渡して実行する。スタイル・メディア変換と Opaque bundle の作成は Host への非同期要求とし、Host が子プロセスの取消と後始末を所有する。Worker の終了時は実行中の Host 側要求の後始末を待つ。`build:analysis` が同じ実行ファイルを dev／test 用に生成し、CLI の build／pack でも同梱する。
`build` は Opaque Surface の取得済み renderer を閉じた bundle にして OS 別の native worker で capture する。Linux は namespace / cgroup、macOS arm64 は Seatbelt と process group の監視を使う。必要な隔離 capability が利用できなければ `opaque-isolation-unavailable` を返す。保証差と検証状態は [ADR-0026](../../../docs/decisions/0026-native-linux-macos-host-adapters.md) に従い、成功後だけ既存の atomic publish へ進む。Structured Surface を含む build は同じ静的検証を通過してから Fixed Browser adapter と build context で baked-web renderer を作り、Compiler の公開 build API を呼ぶ。
project root の検証後、Browser を起動する前に `.unframe-build.lock` を `O_CREAT|O_EXCL|O_NOFOLLOW` で取得する。
同一 project の concurrent build は I/O diagnostic で終了し、output を公開しない。lock は保持した inode が path 上で同一の
ときだけ finally で削除する。crash 後の stale lock は fail-closed とし、稼働中 build がないことを確認した operator だけが除去する。
非協調 process が lock path を unlink する攻撃は ADR-0013 の threat model 外である。`check` は build lease を取得せず、snapshot の間だけ source lease を取得する。

Exit code は `0` が成功、`1` が `syntax` / `type` / `semantic` / `renderer`、`2` が `usage`、`3` が `io`、signal cancel の
`130` が `cancel` である。成功時の JSON output は `ok: true`、失敗時は diagnostic array を持つ。diagnostic JSON は
`"usage" | "syntax" | "type" | "semantic" | "renderer" | "io" | "cancel"` の `family` field を必ず持つ。source 診断の JSON には
`location`（fileName、start、end、line、column）を含め、text では `fileName:line:column: family/code: message` と表示する。
それ以外の text diagnostics は `path: family/code: message` の一行形式である。family と順序は ADR-0013 に従う。

Prop / Variant の default を省略によって採用した場合、`check` と `build` は exit code `0` のまま warning を返す。成功 JSON の `warnings` は Instance ID、Prop / Variant 名、default 値、path を保持する。text 形式は成功を stdout、warning を stderr に出す。`build` の事前検証と compile で同じ warning を二重表示しない。default と同じ値を明示した場合は warning を出さない。

`unframe.config.ts` の `assets` は logical Asset ID から `{ path, mediaType }` への data-only 登録であり、path は project 内の regular file を指す。現在の bytes から hash・size・変換 identity を生成し、Compiler へ descriptor と bytes を分離して渡す。登録素材は一ファイル64 MiB、合計256 MiBまで読み込み、Compiler で実 bytes も検証する。GLB は静的 Model 変換、MP4 は隔離 validator に渡す。raster size は ADR-0012 の長辺2048 policy から導出する。

## 3. Artifact boundary

build の成功時だけ、CLI は次の deterministic な全ファイルを辞書順 path で一度に `publishAtomicArtifacts` へ渡す。

- `definition.json`
- `render-bundle.json`
- `asset-set.json`
- `build-manifest.json`
- `assets/<percent-encoded asset id>.<png|jpg|ttf|otf|glb|mp4>`

filesystem host はcomplete artifact setを内部generationへ固定し、`build-receipt.json`を含む通常ディレクトリとして`dist`へ公開する。receiptはgeneration IDとbuild manifest bytesのhashを持つ。既存Distの置換は同一親FD配下のディレクトリ交換で原子的に行い、公開前後のbytesとidentityを検証する。失敗またはcancelではprevious Distを保持する。

`dist`は元素材・Source・`.unframe`への参照を持たず、そのディレクトリだけを別の場所へコピーできる。`preview <dist-directory>`は再ビルドせず共通Unity playerで表示し、編集・build APIを提供しない。`publish <dist-directory> <source-presentation-id> <control-plane-origin>`はDistのソースIDを引数で指定し、全素材bytesをhash・サイズで検証してから、認証したアカウントの公開先に送信する。Preview用Web UIとUnity playerはCLI側の実行環境に必要である。local BuildManifest の `sourceDraftRevision` は `0` とし、publication と Delivery artifact は出力しない。Compiler / Renderer の domain diagnostics は exit code `1`、
discovery / read / write I/O は exit code `3` とする。

## 4. Interactive TUI boundary

interactive shell は Bun を runtime とし、OpenTUI の Solid renderer を使用する。このリポジトリの dependency と lockfile は pnpm で管理する。利用者のプロジェクトは任意の `node_modules` 対応パッケージマネージャーを選べる。TUI は command の選択、keyboard navigation、
quit lifecycle を所有する。選択後は TUI を閉じ、選択した command と project directory を headless process に渡す。
filesystem host と Browser process は headless process が所有する。

- `@opentui/core`: Zig native renderer と terminal lifecycle
- `@opentui/solid` + `solid-js`: declarative view
- `@opentui/keymap`: navigation / selection / quit key binding
- `web-tree-sitter`: `@opentui/core` が要求する peer dependency

`@opentui/react`、`@opentui/ssh`、dynamic runtime plugin loading は採用しない。TUI state transition は
`model.ts` の pure reducer と explicit effect に閉じ、Bun/OpenTUI を使わず Vitest で検証できる。描画 integration
は Bun と OpenTUI test renderer で検証する。

## 5. Dependency rules

headless application は Compiler / Web Renderer のほか、Core、Contracts、Tailwind、worker-host の公開 API を利用する。project の固定 Node graph と Style 変換の準備・起動は CLI、PostCSS 変換は Tailwind、Style / capture 共通の隔離・資源制限・終了確認は worker-host が所有する。Browser の配置と起動は Web Renderer に残す。TUI adapter だけが
OpenTUI stack に依存する。`unframe-components` は fixture の devDependency であり、CLI runtime の project
discovery / component registry ではない。依存 version は pnpm lockfile で固定し、repository toolchain は Bun と
Node.js の両方を提供する。

## 6. Process and acceptance boundary

build は config・Source・導入済み依存の bytes と graph から revision を固定し、dist 置換前に再検査する。
変更を検出した場合は `cli-output-stale` を返し、成功済み dist を保持して未公開 generation を回収する。
build lease と検証済みの一時Distディレクトリはrevisionに含めない。これは外部編集の検出であり、非協調 editor との
原子的な保存を保証しない。ローカル Author host は source lease と journal により Source の保存と recovery を行う。

`pnpm presentation check|build <project>` は Bun process entry である。この entrypoint だけが単一の
`AbortController` と `SIGINT` / `SIGTERM` listener を所有し、同じ signal を application API に渡す。listener は
常に解除し、`process.exit()` は呼ばず `process.exitCode` と stdout/stderr の stable result を使う。

`nix run .#presentation` の check mode は通常の package check の後、provision 済み repository-local Fixed Browser
で reference project の check と temp copy への build を2回行う。4つの v2 JSON と PNG / Font asset set
の relative path と SHA-256 manifest が完全一致することを検証する。fix mode と通常 package check は Browser を起動しない。

## Local build cache

`build` は Compiler の検証済みキャッシュ境界を `.unframe/cache/builds-v1` に接続する。key は Source / Asset bytes、Compiler / Renderer / Browser / font identity と build context / encode policy を含む。hit でも全成果物と binary checksum を Compiler が再検証し、cache failure / corruption は再 capture へ戻す。SurfaceのbuildはBrowser identityを現在環境から取得するため、hitでもBrowser sessionを開閉する。ModelだけのbuildはBrowserを起動しない。

Linux / macOS ともに Go 製 native filesystem helper の directory FD に保存先を固定し、symlink を拒否する。entry は staging と atomic rename で公開し、失敗・cancel の staging は回収する。binary は checksum 名、完成 entry は既定16件で古いものを回収する。cache は dist / Release / Delivery の一部ではない。保存規則は [ADR-0022](../../../docs/decisions/0022-m4-structured-rendering-and-build-cache.md)、OS 別の境界は [ADR-0026](../../../docs/decisions/0026-native-linux-macos-host-adapters.md) に従う。

native filesystem helper は [`scripts/build-cli-filesystem.sh`](../../../scripts/build-cli-filesystem.sh) で `packages/unframe/workspace-node/native-bin/filesystem-helper-<platform>-<arch>` に生成する。依存は native 専用 Go module に固定する。CLI の `presentation` / `dev` / `tui` / `test` / `test:tui` の pnpm hook は生成を行う。`vp test` の直接実行、headless API の直接利用など hook を通らない consumer は、repository root で先に同 script を実行する。Source 保存 transaction もこの helper の FD 操作を使い、schema、checksum、cache key、保持方針は TypeScript が所有する。

## 7. Deferred

以下は current implementation に含めない。

- remote package registry、任意外部 renderer plugin の自動 discovery、distribution update
- remote build cache
- Windows / Intel Mac support

`init`、`dev`、`test`、`preview`、`publish`、watch と TUI / headless command の接続は実装済みである。`init` はテンプレートの登録素材も相対パスを保ってコピーする。renderer は host の固定 registry を利用し、publish の credential は process 外へ保存しない。

これらを追加する場合も、Compiler rule、Renderer implementation、durable publication state の所有権はこの
package に移さない。

## 8. Local Author host

`unframe author .` は同梱の Editor と Unity Player、ローカル API を native host の loopback で配信し、Linux は `xdg-open`、macOS arm64 は `open` でブラウザを開く。別途 UI 開発サーバーやビルド監視を起動する必要はない。Editor は同一 Origin の接続 API から token を取得してメモリーだけに保持し、URL やログには含めない。
CLI のディレクトリ引数は相対パスも受け付け、実行時の作業ディレクトリを基準に絶対パスへ解決して内部へ渡す。
Opaque preview には既存の固定 Browser と OS 別の隔離実行環境が必要である。

`@unframe-dev/contracts/author-http` がローカル HTTP 契約、Source が patch 生成、Author Service が編集ユースケース、`app/web/local-editor` が画面を所有する。
公開 scalar Props と host Transform を編集し、保存後に build を要求する。共有値・props spread は対象 Instance の局所 override として保存し、同一 session の Undo / Redo と継承への復帰を提供する。有限 State preview は Core の既存 Cue 実行器を使い、宣言済み操作と生成済み State 画像を接続する。React 内部の CSS 編集は提供しない。
保存 revision と成功した preview revision を区別し、capture 失敗でも保存済み Source と以前の preview を保持する。
認証・保存・回復規則は [実装契約](../../../docs/packages/REACT_COMPONENT_EXECUTION_CONTRACT.md#2-editor-host-と通信) を参照。

### Model / Video source tools

登録GLBはCompilerのtransform identity、MP4は `UNFRAME_FFMPEG_PATH` / `UNFRAME_FFPROBE_PATH` と `UNFRAME_MEDIA_RUNTIME_CLOSURE` のtool・worker identityを一回のbuild入力へ含める。MP4 workerはreadonly input、network隔離、時間・出力・memory上限を適用し、全decode、AVC SPS、stream/packet/frameを検査する。自動transcodeは行わない。

PreviewはModel/Video residencyと初期・再生stateを共通Unity playerへ渡す。Control PlaneとNative Runtimeは`unity-media-v1`を使用する。Local Editorは`local-web-preview`を使用し、選択した全PNGを常駐させる。Previewのメモリ予算上限は適用せず、描画機能・画像サイズの制約と素材の整合性検証を維持する。本番配信の予算上限はadmission設定でありQuest実機の性能測定結果を表さない。
