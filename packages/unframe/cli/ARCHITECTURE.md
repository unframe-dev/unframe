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
project root、data-only config / lock、Fixed Browser lifecycle、managed output の原子的公開を組み立てる。headless
application API はテスト用に Fixed Browser session factory、AbortSignal、固定 build context を注入できる。production default
は packaged Fixed Browser と固定 toolchain context を使用し、project reader や output directory は注入しない。

```text
runPresentationCli
├─ parse explicit absolute project directory
├─ M1 filesystem host: explicit root + config / lock, materialize virtual project
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

lock v3 は self-contained package bytes、local file hash、source Assetのpath/hash/sizeを検証する。`refresh` は固定依存 graph を保持し、`update` はスクリプト無効の frozen pnpm install 後に snapshot を取り直す。`--recreate` は旧schemaを読み替えずSourceから新規生成し、失敗時は旧 lock を保持する。workspace / link dependency は未対応で、root-relative tarball と registry locator を対象とする。

## 2. Command contract

現行 public API の `args` は descriptor-safe snapshot の後に検査する dense な string array である。M1
process command は absolute project directory を受け、その realpath を root として同じ directory の`unframe.config.ts`、
`unframe.lock`を読む。上方探索は行わない。public input、command grammar、build context、host callback も descriptor-safe
snapshot と explicit validation で boundary validation する。host の callback
invocation と Compiler / Renderer の cross-boundary semantic diagnostics は、この構造検査の後に扱う。

```text
init <absolute-project-directory> [--format text|json]
check <absolute-project-directory> [--format text|json]
test <absolute-project-directory> [--format text|json]
build <absolute-project-directory> [--format text|json]
lock refresh <absolute-project-directory> [--format text|json]
lock update <absolute-project-directory> [--recreate] [--format text|json]
```

process entrypoint は上記を headless API へ委譲し、次の command を追加する。

```text
author <absolute-project-directory>
dev <absolute-project-directory>
preview <absolute-project-directory>
publish <absolute-project-directory> <presentation-id> <control-plane-origin>
```

`check` は discovery、config、lock、Source frontend と assembly を検証するだけで、Browser adapter / Renderer を読まず起動しない。
`build` は Opaque Surface の locked renderer を閉じた bundle にして OS 別の native worker で capture する。Linux は namespace / cgroup、macOS arm64 は Seatbelt と process group の監視を使う。必要な隔離 capability が利用できなければ `opaque-isolation-unavailable` を返す。保証差と検証状態は [ADR-0026](../../../docs/decisions/0026-native-linux-macos-host-adapters.md) に従い、成功後だけ既存の atomic publish へ進む。Structured Surface を含む build は同じ静的検証を通過してから Fixed Browser adapter と build context で baked-web renderer を作り、Compiler の公開 build API を呼ぶ。
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

`unframe.config.ts`の`assets`はlogical Asset IDから`{ path, mediaType }`へのdata-only登録であり、pathはproject内のregular fileを指す。lock v3のassetは`id`、`path`、`mediaType`、`hash`、`size`を持つ。bytesはfilesystem snapshotからCompilerの独立入力へ渡し、lockやdeclaration projectのJSONへ埋め込まない。登録済み素材は一ファイル64 MiB、合計256 MiBまで読み込み、Compilerは画像16 MiB・フォント/GLB64 MiBの上限と実bytesのhash/size/signatureも検証する。CheckとDist buildは素材・登録・変換条件がlockと異なる場合に拒否し、明示的な`lock refresh`/`lock update`で採用する。AuthorとDev buildは最新素材を取り込み、そのhashと変換条件をDev用snapshotへ固定する。Devはlockの素材pinと既存Distを更新しない。GLBはCompilerの静的Model変換へ渡し、配布GLBをlogical Asset IDのままatomic出力する。MP4は隔離validatorで検証し、Video artifactと配布MP4へ接続する。raster sizeはCLI optionではなくADR-0012の長辺2048 policyから導出する。

## 3. Artifact boundary

build の成功時だけ、CLI は次の deterministic な全ファイルを辞書順 path で一度に `publishAtomicArtifacts` へ渡す。

- `definition.json`
- `render-bundle.json`
- `asset-set.json`
- `build-manifest.json`
- `assets/<percent-encoded asset id>.<png|jpg|ttf|otf|glb|mp4>`

filesystem host はcomplete artifact setを内部generationへ固定し、`build-receipt.json`を含む通常ディレクトリとして`dist`へ公開する。receiptはgeneration IDとbuild manifest bytesのhashを持つ。既存Distの置換は同一親FD配下のディレクトリ交換で原子的に行い、公開前後のbytesとidentityを検証する。失敗またはcancelではprevious Distを保持する。

`dist`は元素材・Source・lock・`.unframe`への参照を持たず、そのディレクトリだけを別の場所へコピーできる。`preview <absolute-dist-directory>`は再ビルドせず共通Unity playerで表示し、編集・build APIを提供しない。`publish <absolute-dist-directory> <presentation-id> <control-plane-origin>`は同じDistの全素材bytesをhash・サイズで検証してから送信する。Preview用Web UIとUnity playerはCLI側の実行環境に必要である。local BuildManifest の `sourceDraftRevision` は `0` とし、publication と Delivery artifact は出力しない。Compiler / Renderer の domain diagnostics は exit code `1`、
discovery / read / write I/O は exit code `3` とする。

## 4. Interactive TUI boundary

interactive shell は Bun を runtime とし、OpenTUI の Solid renderer を使用する。pnpm は引き続き dependency と
lockfile の管理を担当し、Bun を package manager として使用しない。TUI は command の選択、keyboard navigation、
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

build は config・Source・lock の bytes から revision を固定し、dist 置換前に再検査する。
変更を検出した場合は `cli-output-stale` を返し、成功済み dist を保持して未公開 generation を回収する。
build lease と検証済みの一時Distディレクトリはrevisionに含めない。これは外部編集の検出であり、非協調 editor との
原子的な保存を保証しない。ローカル Author host は source lease と journal により Source / lock の保存と recovery を行う。

`pnpm presentation check|build <project>` は Bun process entry である。この entrypoint だけが単一の
`AbortController` と `SIGINT` / `SIGTERM` listener を所有し、同じ signal を application API に渡す。listener は
常に解除し、`process.exit()` は呼ばず `process.exitCode` と stdout/stderr の stable result を使う。

`nix run .#presentation` の check mode は通常の package check の後、provision 済み repository-local Fixed Browser
で reference project の check と temp copy への build を2回行う。4つの v2 JSON と PNG / Font asset set
の relative path と SHA-256 manifest が完全一致することを検証する。fix mode と通常 package check は Browser を起動しない。

## Local build cache

`build` は Compiler の検証済みキャッシュ境界を `.unframe/cache/builds-v1` に接続する。key は Source / Asset bytes、Compiler / Renderer / Browser / font identity と build context / encode policy を含む。hit でも全成果物と binary checksum を Compiler が再検証し、cache failure / corruption は再 capture へ戻す。SurfaceのbuildはBrowser identityを現在環境から取得するため、hitでもBrowser sessionを開閉する。ModelだけのbuildはBrowserを起動しない。

Linux / macOS ともに Go 製 native filesystem helper の directory FD に保存先を固定し、symlink を拒否する。entry は staging と atomic rename で公開し、失敗・cancel の staging は回収する。binary は checksum 名、完成 entry は既定16件で古いものを回収する。cache は dist / Release / Delivery の一部ではない。保存規則は [ADR-0022](../../../docs/decisions/0022-m4-structured-rendering-and-build-cache.md)、OS 別の境界は [ADR-0026](../../../docs/decisions/0026-native-linux-macos-host-adapters.md) に従う。

native filesystem helper は [`scripts/build-cli-filesystem.sh`](../../../scripts/build-cli-filesystem.sh) で `packages/unframe/cli/.cache/filesystem-helper` に生成する。依存は native 専用 Go module に固定する。CLI の `presentation` / `dev` / `tui` / `test` / `test:tui` の pnpm hook は生成を行う。`vp test` の直接実行、headless API の直接利用など hook を通らない consumer は、repository root で先に同 script を実行する。Source 保存 transaction もこの helper の FD 操作を使い、schema、checksum、cache key、保持方針は TypeScript が所有する。

## 7. Deferred

以下は current implementation に含めない。

- remote package registry、任意外部 renderer plugin の自動 discovery、distribution update
- remote build cache
- Windows / Intel Mac support

`init`、`dev`、`test`、`preview`、`publish`、watch と TUI / headless command の接続は実装済みである。`init` はテンプレートの登録素材も相対パスを保ってコピーする。renderer は host の固定 registry 内で `unframe.lock` の pin を解決し、publish の credential は process 外へ保存しない。

これらを追加する場合も、Compiler rule、Renderer implementation、durable publication state の所有権はこの
package に移さない。

## 8. Local Author host

`author` は native host の loopback に Web Inspector を配信し、Linux は `xdg-open`、macOS arm64 は `open` で起動 URL を開く。token 付き URL はログに出さず、origin だけを表示する。
先に repository root で `pnpm --filter @unframe/local-editor build` を実行する。
起動は `pnpm --filter @unframe/core presentation author /absolute/project`。
Opaque preview には既存の固定 Browser と OS 別の隔離実行環境が必要である。

`src/author/contract.ts` がローカル HTTP 境界、Compiler が Source patch、`app/web/local-editor` が画面を所有する。
公開 scalar Props と host Transform を編集し、保存後に build を要求する。共有値・props spread は対象 Instance の局所 override として保存し、同一 session の Undo / Redo と継承への復帰を提供する。有限 State preview は Core の既存 Cue 実行器を使い、宣言済み操作と生成済み State 画像を接続する。React 内部の CSS 編集は提供しない。
保存 revision と成功した preview revision を区別し、capture 失敗でも保存済み Source と以前の preview を保持する。
認証・保存・回復規則は [実装契約](../../../docs/packages/REACT_COMPONENT_EXECUTION_CONTRACT.md#2-editor-host-と通信) を参照。

### Model / Video source tools

登録GLBはCompilerの固定transform identity、MP4は`UNFRAME_FFMPEG_PATH` / `UNFRAME_FFPROBE_PATH`と`UNFRAME_MEDIA_RUNTIME_CLOSURE`が指定するNix tool・worker hashをsource lockへ束縛する。Distのtool更新後は明示的な`lock refresh`が必要となる。Devは最新tool identityをsnapshotへ記録する。MP4 workerは既存worker hostでreadonly input、network隔離、時間・出力・memory上限を適用し、全decode、AVC SPS、stream/packet/frameの検査結果をAssetsへ渡す。拡張子だけのadmissionや自動transcodeは行わない。

PreviewはModel/Video residencyと初期・再生stateを共通Unity playerへ渡す。Control PlaneとNative Runtimeは`unity-media-v1`を使用する。Local Editorは同じfeature/budgetでprofile IDだけを`local-web-preview`とする。これらの上限はadmission設定でありQuest実機の性能測定結果を表さない。
