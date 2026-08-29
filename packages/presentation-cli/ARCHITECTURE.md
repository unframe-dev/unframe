# Presentation CLI Architecture

- **Status**: M1 filesystem-backed headless application boundary
- **Scope**: Authoring Project を Compiler / Web Renderer に接続し、Bun 上の OpenTUI command selector と headless API を提供する
- **Related**:
  - [Presentation Implementation Design](../../docs/presentation/DESIGN.md)
  - [Presentation Compiler Architecture](../presentation-compiler/ARCHITECTURE.md)
  - [Web Renderer Architecture](../presentation-renderer-web/ARCHITECTURE.md)
  - [ADR-0013: Local Compiler の project filesystem contract](../../docs/decisions/0013-local-compiler-project-filesystem-contract.md)

## 1. Role

`presentation-cli` は headless な `runPresentationCli` と、interactive な `runPresentationTui` を別 entrypoint
として公開する。CLI は Authoring semantic rule や renderer implementation を所有しないが、ADR-0013 に従い explicit
project root、data-only config / lock、Fixed Browser lifecycle、managed output の原子的公開を組み立てる。headless
application API はテスト用に Fixed Browser session factory、AbortSignal、固定 build context を注入できる。production default
は packaged Fixed Browser と固定 toolchain context を使用し、project reader や output directory は注入しない。

```text
runPresentationCli
├─ parse explicit absolute project directory
├─ M1 filesystem host: explicit root + config / lock, materialize virtual project
├─ check: presentation-compiler.checkAuthoringProjectAssembly（Browserなし）
└─ build: compiler + presentation-renderer-web
   └─ managed staging + atomic dist symlink replacement
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

## 2. Command contract

現行 public API の `args` は descriptor-safe snapshot の後に検査する dense な string array である。M1
process command は absolute project directory を受け、その realpath を root として同じ directory の`unframe.config.ts`、
`unframe.lock`を読む。上方探索は行わない。public input、command grammar、build context、host callback も descriptor-safe
snapshot と explicit validation で boundary validation する。host の callback
invocation と Compiler / Renderer の cross-boundary semantic diagnostics は、この構造検査の後に扱う。

```text
check <absolute-project-directory> [--format text|json]
build <absolute-project-directory> [--format text|json]
```

`check` は discovery、config、lock、Source frontend と assembly を検証するだけで、Browser adapter / Renderer を読まず起動しない。
`build` だけが Fixed Browser adapter と build context から baked-web renderer を作り、Compiler の公開 build API を呼ぶ。

Exit code は `0` が成功、`1` が `syntax` / `type` / `semantic` / `renderer`、`2` が `usage`、`3` が `io`、signal cancel の
`130` が `cancel` である。成功時の JSON output は `ok: true`、失敗時は diagnostic array を持つ。diagnostic JSON は
`"usage" | "syntax" | "type" | "semantic" | "renderer" | "io" | "cancel"` の `family` field を必ず持ち、text diagnostics は
`path: family/code: message` の一行形式である。family と順序は ADR-0013 に従う。

## 3. Artifact boundary

build の成功時だけ、CLI は次の deterministic な全ファイルを辞書順 path で一度に `publishAtomicArtifacts` へ渡す。

- `definition.json`
- `render-bundle.json`
- `assets/<percent-encoded asset id>.png`

filesystem host は root 固定の `dist` に対し complete artifact set を `.unframe/generations/<generation-id>` に閉じ、成功時だけ validated
relative target の managed `dist` symlink を atomic replacement する。失敗または cancel では previous `dist` を維持し、今回の
staging を公開しない。manifest と Delivery artifact は出力しない。Compiler / Renderer の domain diagnostics は exit code `1`、
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

headless application は `presentation-compiler` と `presentation-renderer-web` にだけ依存する。TUI adapter だけが
OpenTUI stack に依存する。`presentation-components` は fixture の devDependency であり、CLI runtime の project
discovery / component registry ではない。依存 version は pnpm lockfile で固定し、repository toolchain は Bun と
Node.js の両方を提供する。

## 6. Deferred

以下は current implementation に含めない。

- TUI command selection と M1 process command の接続
- process entry、reference project acceptance、`nix run .#presentation` への接続
- remote package registry、plugin discovery、distribution update
- `init`、`dev`、`test`、`preview`、`publish` command
- watch / incremental cache、remote publish adapter、credential integration
- Windows / case-insensitive filesystem support

これらを追加する場合も、Compiler rule、Renderer implementation、durable publication state の所有権はこの
package に移さない。
