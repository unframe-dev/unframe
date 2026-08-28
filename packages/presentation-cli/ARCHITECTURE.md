# Presentation CLI Architecture

- **Status**: Current headless command boundary and interactive TUI shell
- **Scope**: Authoring Project JSON を Compiler / Web Renderer に接続し、Bun 上の OpenTUI command selector と headless API を提供する
- **Related**:
  - [Presentation Implementation Design](../../docs/presentation/DESIGN.md)
  - [Presentation Compiler Architecture](../presentation-compiler/ARCHITECTURE.md)
  - [Web Renderer Architecture](../presentation-renderer-web/ARCHITECTURE.md)

## 1. Role

`presentation-cli` は headless な `runPresentationCli` と、interactive な `runPresentationTui` を別 entrypoint
として公開する。CLI 自身は Authoring semantic rule、Renderer artifact、実ファイルシステムの置換を所有しない。
Host が project JSON の読取り、Fixed Browser adapter、明示的 build context、単一の artifact write transaction
を注入する。

```text
runPresentationCli
├─ parse explicit command and absolute paths
├─ host.readProject(project.json)
├─ check: presentation-compiler.checkDeclarationProject
└─ build: compiler + presentation-renderer-web
   └─ host.writeBuildArtifacts(output, complete artifact set)
```

実装は package の public entrypoint だけを import する。Compiler / Renderer の内部 module を deep import
せず、input と adapter の accessor・mutation 防御は各 public boundary に委譲する。

```text
src/
├─ index.ts                              # headless export only
├─ application/
│  ├─ types.ts                          # headless host / result contract
│  └─ run-presentation-cli.ts           # check / build orchestration
└─ tui/
   ├─ model.ts                          # renderer-independent state and effects
   ├─ view.tsx                          # OpenTUI Solid view
   ├─ run.tsx                           # Bun / Zig core / keymap lifecycle
   └─ main.tsx                          # executable entrypoint
```

root export は native module を import しない。OpenTUI の Zig core を必要とする利用者だけが `./tui` subpath
または `pnpm tui` を使う。これにより Node / Vitest 上の headless check と build は native TUI lifecycle から
独立する。

## 2. Current command contract

`args` は dense な string array であり、project JSON と output directory は絶対 path でなければならない。

```text
check <absolute-project.json> [--format text|json]
build <absolute-project.json> <absolute-output-dir> [--format text|json]
```

`check` は project JSON を Compiler に渡すだけで、Browser adapter / Renderer を読まず、Compiler diagnostics
を意味変更せず安定順で text または JSON に表示する。`build` は injected Fixed Browser adapter と build
context から baked-web renderer を一つ作り、Compiler の公開 build API を呼ぶ。

Exit code は `0` が成功、`1` が domain diagnostics、`2` が usage / invocation、`3` が project I/O または
write I/O である。成功時の JSON output は `ok: true`、失敗時は diagnostic array を持つ。text diagnostics は
`path: code: message` の一行形式である。

## 3. Artifact boundary

build の成功時だけ、CLI は次の deterministic な全ファイルを辞書順 path で一度に `writeBuildArtifacts` へ渡す。

- `definition.json`
- `render-bundle.json`
- `assets/<percent-encoded asset id>.png`

CLI は個別の file write、既存 output の削除、partial output の rollback を行わない。Host はこの complete
artifact set を transaction として扱い、成功または失敗を返す。Compiler / Renderer の domain diagnostics は
exit code `1`、project JSON の読取り・parse と host write の失敗は exit code `3` とする。どの失敗でも、
write boundary は呼ばれないか、単一 boundary の失敗として扱う。

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

headless application は `presentation-compiler` と `presentation-renderer-web` にだけ依存する。TUI adapter だけが
OpenTUI stack に依存する。`presentation-components` は fixture の devDependency であり、CLI runtime の project
discovery / component registry ではない。依存 version は pnpm lockfile で固定し、repository toolchain は Bun と
Node.js の両方を提供する。

## 6. Deferred

以下は current implementation に含めない。

- TUI command selection と実 headless command / filesystem host の接続
- 実 Browser process の選定・起動・終了、capture、signal lifecycle
- project discovery、TSX authoring、`unframe.config.ts`、lockfile、plugin discovery
- `init`、`dev`、`test`、`preview`、`publish` command
- watch / incremental cache、remote publish adapter、credential integration
- real filesystem の staging / atomic replacement strategy

これらを追加する場合も、Compiler rule、Renderer implementation、durable publication state の所有権はこの
package に移さない。
