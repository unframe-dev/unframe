# Presentation CLI Architecture

- **Status**: Current initial programmatic CLI boundary
- **Scope**: Authoring Project JSON を Compiler / Web Renderer に接続し、診断または build artifact を host へ渡す
- **Related**:
  - [Presentation Implementation Design](../../docs/presentation/DESIGN.md)
  - [Presentation Compiler Architecture](../presentation-compiler/ARCHITECTURE.md)
  - [Web Renderer Architecture](../presentation-renderer-web/ARCHITECTURE.md)

## 1. Role

`presentation-cli` は `runPresentationCli` という programmatic entrypoint を公開する。CLI 自身は Authoring
semantic rule、Renderer artifact、実ファイルシステムの置換を所有しない。Host が project JSON の読取り、Fixed
Browser adapter、明示的 build context、単一の artifact write transaction を注入する。

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

## 4. Dependency rules

production dependency は `presentation-compiler` と `presentation-renderer-web` に限る。`presentation-components`
は fixture の devDependency であり、CLI runtime の project discovery / component registry ではない。

## 5. Deferred

以下は current implementation に含めない。

- Node executable、実 Browser process の起動・終了、signal lifecycle
- project discovery、TSX authoring、`unframe.config.ts`、lockfile、plugin discovery
- `init`、`dev`、`test`、`preview`、`publish` command
- watch / incremental cache、remote publish adapter、credential integration
- real filesystem の staging / atomic replacement strategy

これらを追加する場合も、Compiler rule、Renderer implementation、durable publication state の所有権はこの
package に移さない。
