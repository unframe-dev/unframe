# Presentation CLI Architecture

- **Status**: v2 State 別 build filesystem boundary
- **Scope**: Authoring Project を Compiler / Web Renderer に接続し、Bun 上の OpenTUI command selector と headless API を提供する
- **Related**:
  - [Presentation Implementation Design](../../docs/packages/DESIGN.md)
  - [Presentation Compiler Architecture](../unframe-compiler/ARCHITECTURE.md)
  - [Web Renderer Architecture](../unframe-renderer-web/ARCHITECTURE.md)
  - [ADR-0013: Local Compiler の project filesystem contract](../../docs/decisions/0013-local-compiler-project-filesystem-contract.md)

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
   └─ managed staging + atomic dist symlink replacement
```

実装は package の public entrypoint だけを import する。Compiler / Renderer の内部 module を deep import
せず、input と adapter の accessor・mutation 防御は各 public boundary に委譲する。

```text
src/
├─ index.ts                              # headless export only
├─ application/
│  ├─ types.ts                          # headless host / result contract
│  └─ run-presentation-cli.ts      # check / build orchestration
├─ filesystem/build-lock.ts              # process-local build exclusion lease
├─ process/
│  ├─ main.ts                           # Bun executable entrypoint
│  └─ run-presentation-process.ts       # SIGINT/SIGTERM owner
└─ tui/
   ├─ model.ts                          # renderer-independent state and effects
   ├─ view.tsx                          # OpenTUI Solid view
   ├─ run.tsx                           # Bun / Zig core / keymap lifecycle
   └─ main.tsx                          # executable entrypoint
```

root export は native module を import しない。OpenTUI の Zig core を必要とする利用者だけが `./tui` subpath
または `pnpm tui` を使う。これにより Node / Vitest 上の headless check と build は native TUI lifecycle から
独立する。

lock v2 は self-contained package bytes と local file hash を検証する。`refresh` は固定依存 graph を保持し、`update` はスクリプト無効の frozen pnpm install 後に snapshot を取り直す。`--recreate` は v1 を読み替えず Source から新規生成し、失敗時は旧 lock を保持する。workspace / link dependency は未対応で、root-relative tarball と registry locator を対象とする。

## 2. Command contract

現行 public API の `args` は descriptor-safe snapshot の後に検査する dense な string array である。M1
process command は absolute project directory を受け、その realpath を root として同じ directory の`unframe.config.ts`、
`unframe.lock`を読む。上方探索は行わない。public input、command grammar、build context、host callback も descriptor-safe
snapshot と explicit validation で boundary validation する。host の callback
invocation と Compiler / Renderer の cross-boundary semantic diagnostics は、この構造検査の後に扱う。

```text
check <absolute-project-directory> [--format text|json]
build <absolute-project-directory> [--format text|json]
lock refresh <absolute-project-directory> [--format text|json]
lock update <absolute-project-directory> [--recreate] [--format text|json]
author <absolute-project-directory>
```

`check` は discovery、config、lock、Source frontend と assembly を検証するだけで、Browser adapter / Renderer を読まず起動しない。
`build` は Opaque Surface の locked renderer を閉じた bundle にして Linux の隔離 worker で capture する。namespace / cgroup が利用できなければ `opaque-isolation-unavailable` を返す。成功後だけ既存の atomic publish へ進む。Structured は同じ静的検証を通過してから Fixed Browser adapter と build context で baked-web renderer を作り、Compiler の公開 build API を呼ぶ。
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

`unframe.lock` v2 の asset は `id`、`mediaType`、`hash`、`size`、canonical `dataBase64` を持ち、loader が Compiler の asset carrier へ変換する。現行 compile の source asset は `font/ttf` / `font/otf` に限定する。Compiler が bytes と参照を検証し、出力 AssetSet には descriptor だけを残す。raster size は CLI option ではなく ADR-0012 の長辺 2048 policy から導出する。

## 3. Artifact boundary

build の成功時だけ、CLI は次の deterministic な全ファイルを辞書順 path で一度に `publishAtomicArtifacts` へ渡す。

- `definition.json`
- `render-bundle.json`
- `asset-set.json`
- `build-manifest.json`
- `assets/<percent-encoded asset id>.<png|ttf|otf>`

filesystem host は root 固定の `dist` に対し complete artifact set を `.unframe/generations/<generation-id>` に閉じ、成功時だけ validated
relative target の managed `dist` symlink を atomic replacement する。失敗または cancel では previous `dist` を維持し、今回の
staging を公開しない。local BuildManifest の `sourceDraftRevision` は `0` とし、publication と Delivery artifact は出力しない。Compiler / Renderer の domain diagnostics は exit code `1`、
discovery / read / write I/O は exit code `3` とする。

## 4. Interactive TUI boundary

interactive shell は Bun を runtime とし、OpenTUI の Solid renderer を使用する。pnpm は引き続き dependency と
lockfile の管理を担当し、Bun を package manager として使用しない。TUI が現在所有するのは `check` / `build`
command の選択、keyboard navigation、quit lifecycle までであり、選択後の filesystem host や Browser process
はまだ接続しない。

- `@opentui/core`: Zig native renderer と terminal lifecycle
- `@opentui/solid` + `solid-js`: declarative view
- `@opentui/keymap`: navigation / selection / quit key binding
- `web-tree-sitter`: `@opentui/core` が要求する peer dependency

`@opentui/react`、`@opentui/ssh`、dynamic runtime plugin loading は採用しない。TUI state transition は
`model.ts` の pure reducer と explicit effect に閉じ、Bun/OpenTUI を使わず Vitest で検証できる。描画 integration
は Bun と OpenTUI test renderer で検証する。

## 5. Dependency rules

headless application は `unframe-compiler` と `unframe-renderer-web` にだけ依存する。TUI adapter だけが
OpenTUI stack に依存する。`unframe-components` は fixture の devDependency であり、CLI runtime の project
discovery / component registry ではない。依存 version は pnpm lockfile で固定し、repository toolchain は Bun と
Node.js の両方を提供する。

## 6. Process and acceptance boundary

build は config・Source・lock の bytes から revision を固定し、dist 置換前に再検査する。
変更を検出した場合は `cli-output-stale` を返し、成功済み dist を保持して未公開 generation を回収する。
build lease と一時 dist link は revision に含めない。これは外部編集の検出であり、非協調 editor との
原子的な保存を保証しない。ローカル Author host は source lease と journal により Source / lock の保存と recovery を行う。

`pnpm presentation check|build <project>` は Bun process entry である。この entrypoint だけが単一の
`AbortController` と `SIGINT` / `SIGTERM` listener を所有し、同じ signal を application API に渡す。listener は
常に解除し、`process.exit()` は呼ばず `process.exitCode` と stdout/stderr の stable result を使う。

`nix run .#presentation` の check mode は通常の package check の後、provision 済み repository-local Fixed Browser
で reference project の check と temp copy への build を2回行う。4つの v2 JSON と PNG / Font asset set
の relative path と SHA-256 manifest が完全一致することを検証する。fix mode と通常 package check は Browser を起動しない。

## Local build cache

`build` は Compiler の検証済みキャッシュ境界を `.unframe/cache/builds-v1` に接続する。key は Source / Asset bytes、Compiler / Renderer / Browser / font identity と build context / encode policy を含む。hit でも全成果物と binary checksum を Compiler が再検証し、cache failure / corruption は再 capture へ戻す。Browser identity を現在環境から取得するため、hit でも Browser session は開閉する。

Linux の directory FD に保存先を固定し、symlink を拒否する。entry は staging と atomic rename で公開し、失敗・cancel の staging は回収する。binary は checksum 名、完成 entry は既定16件で古いものを回収する。cache は dist / Release / Delivery の一部ではない。詳細は [ADR-0022](../../docs/decisions/0022-m4-structured-rendering-and-build-cache.md) に従う。

## 7. Deferred

以下は current implementation に含めない。

- TUI command selection と M1 process command の接続
- remote package registry、plugin discovery、distribution update
- `init`、`dev`、`test`、`preview`、`publish` command
- watch、remote cache / publish adapter、credential integration
- Windows / case-insensitive filesystem support

これらを追加する場合も、Compiler rule、Renderer implementation、durable publication state の所有権はこの
package に移さない。

## 8. Local Author host

`author` は Linux の loopback に Web Inspector を配信し、`xdg-open` で起動 URL を開く。token 付き URL はログに出さず、origin だけを表示する。
先に repository root で `pnpm --filter @unframe/web build:author` を実行する。
起動は `pnpm --filter @unframe/unframe-cli presentation author /absolute/project`。
Opaque preview には既存の固定 Browser と cgroup / namespace 実行環境が必要である。

`src/author/contract.ts` がローカル HTTP 境界、Compiler が Source patch、`app/web` が画面を所有する。
公開 scalar Props と host Transform を編集し、保存後に build を要求する。共有値・props spread は対象 Instance の局所 override として保存し、同一 session の Undo / Redo と継承への復帰を提供する。有限 State preview は Core の既存 Cue 実行器を使い、宣言済み操作と生成済み State 画像を接続する。React 内部の CSS 編集は提供しない。
保存 revision と成功した preview revision を区別し、capture 失敗でも保存済み Source と以前の preview を保持する。
認証・保存・回復規則は [実装契約](../../docs/packages/REACT_COMPONENT_EXECUTION_CONTRACT.md#2-editor-host-と通信) を参照。
