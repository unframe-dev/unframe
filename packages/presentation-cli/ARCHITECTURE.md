# Presentation CLI Architecture

- **Status**: Proposal / Target, not implemented
- **Scope**: Authoring Project を操作する user-facing executable
- **Related**:
  - [Presentation Implementation Design](../../docs/presentation/DESIGN.md)
  - [Presentation Compiler Architecture](../presentation-compiler/ARCHITECTURE.md)
  - [Web Renderer Architecture](../presentation-renderer-web/ARCHITECTURE.md)

## 1. Role

`presentation-cli` は Authoring Project の project discovery、Compiler / renderer composition、diagnostic presentation、local development、publish adapter の user-facing entrypoint である。Semantic rule や compiler pass を実装せず、下位 library を公開 workflow として構成する。

Nix app、CI、repository script はこの CLI または package task を呼ぶ薄い wrapper とし、Presentation domain logic を複製しない。

## 2. Commands

Target command surface は次を想定する。

- `init`: Authoring Project の明示的な scaffold
- `dev`: watch、incremental check / build、local preview orchestration
- `check`: source / contract / semantic diagnostics
- `build`: canonical PresentationDefinition、RenderBundle、Asset Set の生成
- `test`: component / presentation fixture の実行
- `preview`: build artifact の local preview host
- `publish`: build result を public Control Plane contract へ送る

Command 名と option は実装時に確定する。`publish` は local compile と remote publication request を構成するが、durable PublishedPresentation や publication lock を所有しない。

## 3. Project boundary

CLI は明示された project root から次を解決する。

- `unframe.config.ts`
- `unframe.lock`
- Authoring Source と Asset
- `.unframe-cache/`
- `dist/`
- renderer plugin と toolchain version

Project root、cache、output を command invocation ごとに固定し、ambient current directory や user-global config による hidden build input を避ける。

## 4. Composition boundary

```text
CLI command
├─ resolve project / config / lock
├─ compose presentation-compiler
├─ register selected concrete renderers
├─ render diagnostics / progress
├─ host watch / preview
└─ call Control Plane publish adapter
```

CLI は package の内部 module を deep import せず、各 package の public entrypoint だけを利用する。

## 5. Invariants

- command exit code と machine-readable result を安定して対応させる。
- diagnostics の意味を CLI で再解釈・再実装しない。
- `check` と `build` は同じ Compiler validation contract を利用する。
- `publish` は build hash、source revision、artifact identity を明示して remote API へ渡す。
- credential を log、cache、dist に保存しない。
- cache と dist は再生成可能で、Authoring Source の正本として読まない。

## 6. Non-responsibilities

- semantic validation rule と compiler pass
- renderer artifact generation
- Control Plane の authorization、publicationEpoch、active-use lock
- durable Asset ownership と Signed URL generation
- Web Editor UI と Unity Runtime

## 7. Dependency rules

`presentation-cli` は `presentation-compiler` と、既定で有効にする concrete renderer に依存する。Publish は公開 Control Plane client adapter を介す。Control Plane implementation、Compiler 内部 module、Web Editor への依存は禁止する。

## 8. Validation strategy

- command parsing と exit code の table test
- temporary Authoring Project による CLI integration test
- diagnostics の text / JSON output fixture
- watch cancellation と stale build suppression の test
- preview host の artifact fence test
- publish adapter fake による request / error mapping test
- credential redaction test

## 9. Deferred decisions

- exact command / option contract
- local preview runtime
- plugin discovery と configuration
- authentication / credential provider integration
- publish adapter の retry / resumable upload orchestration contract。転送処理と durable state は client adapter / Control Plane が所有する
