# ADR-0013: Local Compiler の project filesystem contract を固定する

- **Status**: Accepted
- **Date**: 2026-08-29
- **Deciders**: Unframe 開発チーム
- **関連**: [ADR-0006](0006-presentation-rendering-strategy.md), [Presentation Architecture](../packages/ARCHITECTURE.md), [Presentation CLI Architecture](../../packages/unframe-cli/ARCHITECTURE.md)

## Context

M1 の Local Compiler は、virtual Authoring Project と injected host までを実装している。しかし実利用する project root、設定、locked package、artifact の公開先を未定義のままにすると、source identity、filesystem traversal、出力置換、cancel 時の可視性が host ごとに変わる。これは同一入力の artifact hash と、失敗時に partial output を公開しないという M1 の要件を満たせない。

本 ADR は M1 の local-only filesystem boundary を固定する。remote registry、plugin discovery、watch、cache、publish、複数 platform を対象にしない。

## Decision

### Project root と入力

CLI は POSIX filesystem だけを M1 の対象にする。process command は absolute project directory を明示的に受け、その `realpath` を project root とする。上方向の discovery は行わず、同じ directory に `unframe.config.ts` と `unframe.lock` がともに存在しなければ I/O diagnostic で fail closed にする。root 外を参照する、入力中に symbolic link がある場合も I/O diagnostic とする。Windows path、junction、case-insensitive path の同一性は M1 では unsupported である。

discovery、config、lock、authoring source は regular file だけを受け入れる。reader は traversal 中と open 時に symbolic link を拒否し、root-relative POSIX path を正規化して `..`、empty segment、NUL、absolute path を拒否する。root から recursive scan した project-owned `.ts`、`.tsx`、`.d.ts` は、fatal UTF-8 decode 後に root-relative POSIX `fileName` と `sourceText` の一度だけの snapshot として virtual Authoring Project に渡す。`unframe.config.ts`、`.unframe`、`dist`、`.git`、`node_modules` は source input から除外する。directory scan と materialized source の順序は UTF-16 code-unit 昇順に固定し、filesystem の返却順を入力にしない。scan 対象の symbolic link、unsafe traversal、read race、UTF-8 failure は stable I/O discovery diagnostic で fail closed にする。`entryFile` はこの snapshot 内に存在しなければならない。

### `unframe.config.ts`

`unframe.config.ts` は実行しない data-only file とする。AST から次だけを受け入れる。

```ts
export default { entryFile: "presentation.unframe.tsx" };
```

`entryFile` は project root relative の POSIX path で、regular file を指さなければならない。import、call、identifier、spread、computed property、getter、任意の追加 property を拒否する。設定を TypeScript / JavaScript として evaluate せず、unsupported syntax と値の不正は stable config diagnostic とする。

### `unframe.lock` v2

A1 の lock は self-contained な v2 JSON とする。正確な shape、順序、bytes / graph hash、local / package origin、Structured / Opaque mode は [React Component 実行契約0節](../packages/REACT_COMPONENT_EXECUTION_CONTRACT.md#0-lock-v2-と生成-id) を正本とする。通常の check / build は local bytes と lock 内 package bytes だけを使い、node_modules や network に問い合わせない。旧 v1 は拒否する。

`lock refresh` は現在の package graph を保持して local Component と Theme を再計算する。`lock update` は pnpm 9 形式の固定解決から package bytes を取得する明示操作であり、lifecycle script と pnpmfile を実行しない。v1 からは `lock update <project> --recreate` で新規生成し、旧 lock 内だけの資産は引き継がない。入力・検証の失敗時は旧 lock を保持する。

React の local CSS / asset も同じ regular-file 規則で bytes を snapshot する。lock に含まれる path / bytes hash と Component の到達 closure を frozen check で照合する。Source と lock を一組で保存する Editor transaction は後続の A3 であり、現行の lock 単体更新とは区別する。

### Build output と atomic replacement

`generation-id` は 16 random bytes を lowercase hexadecimal で表した `[0-9a-f]{32}` とし、artifact identityではない。M1 の build は project root の `.unframe/generations/.staging-<generation-id>/` に staging を作り、`definition.json`、`render-bundle.json`、`asset-set.json`、`build-manifest.json` と PNG / Font assets を完全に書く。asset path は内部Compilerが生成した asset ID と検証済み mediaType から導出し、全 artifact path を辞書順にする。Delivery artifact と publish metadata はこの build の公開artifactではない。

公開前に全 hash と I/O close を検証して staging を `.unframe/generations/<generation-id>/` へ rename する。公開先は root 固定の `dist` であり、CLI が管理する relative symbolic link とする。既存 `dist` が正確に3 segmentの relative target `.unframe/generations/<validated-id>`（`validated-id` は同じ grammar）を指す symlink でない場合は、置換・削除せず I/O diagnostic で拒否する。公開はこの同じ3 segment targetを持つ new symlink を作成して `rename` する一回の atomic replacement とする。root、`.unframe`、`generations`、generation directory はすべて root 内の non-symlink directory であることを `lstat` と open 時に検証し、外部symlinkとpath traversalを拒否する。build は公開済み generation を変更せず、staging / failed generation を公開しない。M1 は persistent managed marker も過去 generation の cleanup も導入せず、cleanup 対象は今回の process が作成した staging だけに限る。

同一 project に対する Unframe CLI の build は process 境界で直列化する。publication 中に別の非 Unframe process が project tree の directory entry を敵対的に差し替える場合に対する filesystem CAS は M1 の保証外とする。publication boundary は各 entry を commit point 直前まで再検証するが、この前提を越えて unmanaged entry と atomic replacement を同時に保護する kernel primitive は要求しない。

### Signal、cancel、Browser lifecycle

process entry だけが `SIGINT` と `SIGTERM` listener を所有し、`AbortSignal` へ一回だけ変換する。library は global listener を追加・変更しない。process entry は listener を `finally` で必ず解除し、phase 境界で cancellation を確認する。同期 Compiler API は signal-aware ではないため signal を渡さない。Fixed Browser capture wrapper だけが同じ signal を capture に渡す。cancel を受けたら新規 phase を開始せず、active Browser context と Browser process を close し、今回の staging を cleanup する。signal による終了 code は 130 とする。

commit point は `dist` symlink の atomic replacement が成功した時点だけである。commit point 前の `syntax`、`type`、`semantic`、`renderer`、`io`、`cancel` failure は previous `dist` を維持し、partial artifact を公開しない。M1 は commit point 後の過去generation cleanupを行わない。

### Stable diagnostics

CLI は source location と deterministic ordering を保持し、diagnostic JSON に次の union の `family` を必ず持たせる。text format は `path: family/code: message` の一行形式とする。

```ts
type DiagnosticFamily = "usage" | "syntax" | "type" | "semantic" | "renderer" | "io" | "cancel";
```

- `usage`: command grammar または invocation
- `syntax`: config / authoring / lock の parse または static grammar
- `type`: module、symbol、TypeScript typecheck
- `semantic`: declaration、assembly、Definition / bundle invariant、integrity
- `renderer`: Browser provisioning、capture、encode、renderer cancellation
- `io`: discovery、UTF-8 / filesystem、staging、atomic replacement、cleanup
- `cancel`: signal による cancel

これらは host exception text、absolute temporary path、process ID を stable message に含めない。`usage` は exit code `2`、`cancel` は exit code `130`、`io` は exit code `3`、その他の family は exit code `1` とし、既存の `cli-invalid-usage` code は `usage` family に属する。

## Alternatives Considered

### Config を実行する

任意の JavaScript config は project discovery 時に process / filesystem / network capability を導入し、Authoring declaration を実行しない M1 boundary と矛盾するため採用しない。

### Output directory を削除してから再生成する

途中失敗と cancel で previous artifact が失われる。managed generations と symlink replacement は公開状態を一つの commit point に限定できるため採用する。

### Lock から registry を参照する

network availability と registry の mutable state が同一入力の再現性を壊す。M1 は自己完結 lock に限定し、distribution / plugin workflow は後続 milestone で扱う。

## Consequences

- **Positive**: check は filesystem input を検証しても Browser を起動せず、build だけが Fixed Browser と artifact publication を所有できる。
- **Positive**: lock、config、source、render environment が artifact identity を決め、失敗・cancel 時にも previous output を保持できる。
- **Negative**: M1 は POSIX-only であり、symlink を使う既存 project や動的 config を受け入れない。
- **Neutral**: `dist` は directory ではなく managed symlink となるため、利用者は artifact を読むだけで直接編集しない。

## Follow-ups

- [ ] M3 以降で package distribution、migration metadata、より広い authoring DSL を contract と実装で接続する。
- [ ] M4 以降で renderer cache、opaque module resolution、resource budget を接続する。
- [ ] M6 以降で watch、preview、plugin discovery、cross-platform filesystem support を設計する。
