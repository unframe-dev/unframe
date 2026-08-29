# ADR-0013: Local Compiler の project filesystem contract を固定する

- **Status**: Accepted
- **Date**: 2026-08-29
- **Deciders**: Unframe 開発チーム
- **関連**: [ADR-0006](0006-presentation-rendering-strategy.md), [Presentation Architecture](../presentation/ARCHITECTURE.md), [Presentation CLI Architecture](../../packages/presentation-cli/ARCHITECTURE.md)

## Context

M1 の Local Compiler は、virtual Authoring Project と injected host までを実装している。しかし実利用する project root、設定、locked package、artifact の公開先を未定義のままにすると、source identity、filesystem traversal、出力置換、cancel 時の可視性が host ごとに変わる。これは同一入力の artifact hash と、失敗時に partial output を公開しないという M1 の要件を満たせない。

本 ADR は M1 の local-only filesystem boundary を固定する。remote registry、plugin discovery、watch、cache、publish、複数 platform を対象にしない。

## Decision

### Project root と入力

CLI は POSIX filesystem だけを M1 の対象にする。process command は absolute project directory を明示的に受け、その `realpath` を project root とする。上方向の discovery は行わず、同じ directory に `unframe.config.ts` と `unframe.lock` がともに存在しなければ I/O diagnostic で fail closed にする。root 外を参照する、入力中に symbolic link がある場合も I/O diagnostic とする。Windows path、junction、case-insensitive path の同一性は M1 では unsupported である。

discovery、config、lock、authoring source は regular file だけを受け入れる。reader は traversal 中と open 時に symbolic link を拒否し、root-relative POSIX path を正規化して `..`、empty segment、NUL、absolute path を拒否する。directory scan の順序は UTF-16 code-unit 昇順に固定し、filesystem の返却順を入力にしない。

### `unframe.config.ts`

`unframe.config.ts` は実行しない data-only file とする。AST から次だけを受け入れる。

```ts
export default { entryFile: "presentation.unframe.tsx" };
```

`entryFile` は project root relative の POSIX path で、regular file を指さなければならない。import、call、identifier、spread、computed property、getter、任意の追加 property を拒否する。設定を TypeScript / JavaScript として evaluate せず、unsupported syntax と値の不正は stable config diagnostic とする。

### `unframe.lock` v1

`unframe.lock` v1 は UTF-8 の self-contained JSON object であり、network URL、registry lookup、tarball、ローカル package manager state を参照しない。M1 は remote install や plugin discovery を行わない。次が唯一受け入れる serialized shape である。`ContentHash` は `sha256:` に続く 64 桁の小文字 hexadecimal である。

```ts
type ContentHash = `sha256:${string}`;

type UnframeLockV1 = {
  schemaVersion: 1;
  packageDependencies: readonly PackageIdentity[];
  packages: readonly LockedPackage[];
  themeHashes: readonly { themeId: string; hash: ContentHash }[];
  componentLocks: readonly {
    componentId: string;
    version: number;
    lock: {
      packageVersion: string;
      packageIntegrity: ContentHash;
      manifestHash: ContentHash;
      structureHash: ContentHash;
    };
  }[];
  assets: Readonly<Record<string, { id: string; mediaType: string; checksum: ContentHash }>>;
};

type PackageIdentity = {
  packageName: string;
  packageVersion: string;
  packageIntegrity: ContentHash;
};

type LockedPackage = PackageIdentity & {
  files: readonly { fileName: string; sourceText: string }[];
  exports: readonly { subpath: string; targetFile: string }[];
  dependencies: readonly PackageIdentity[];
};
```

`packageDependencies` と `dependencies` は full package identity、`packages` は full identity、`files` は `fileName`、`exports` は `subpath`、`themeHashes` は `themeId`、`componentLocks` は `(componentId, version)` の UTF-16 code-unit 昇順で sort する。`assets` object は record key の UTF-16 code-unit 昇順で canonicalize する。これらの key は duplicate-free でなければならない。asset record key は asset catalog を参照するだけの key であり、checksum 由来とは定義しない。

すべての content hash は canonicalized semantic payload の SHA-256 を用いる。object key は UTF-16 code-unit 昇順、配列は上記の順序、JSON は canonical serialization を使用する。`packageIntegrity` は自身の `packageIntegrity` field だけを除いた flat `packageName`、`packageVersion`、`files`、`exports`、`dependencies` の canonical payload を hash し、dependency identityのintegrityを含める。theme hash は source location 等の metadata を除いた Theme declaration semantic payload、`manifestHash` と `structureHash` はそれぞれの declaration semantic payload を hash する。asset checksum は M1 では lock metadata-only であり、filesystem asset bytes の存在・内容を検証しない。source location、filesystem traversal order、staging directory、wall-clock、process ID は hash input に含めない。Declaration、Definition、RenderBundle は同じ canonical hash rule を用いる。

duplicate JSON key、不正 UTF-8、未知 required version、integrity mismatch、lock 内 package reference の欠落は lock diagnostic として fail closed にする。lock file が指す package source や metadata は source role と integrity を再検証してから virtual project に materialize する。

### Build output と atomic replacement

`generation-id` は 16 random bytes を lowercase hexadecimal で表した `[0-9a-f]{32}` とし、artifact identityではない。M1 の build は project root の `.unframe/generations/.staging-<generation-id>/` に staging を作り、`definition.json`、`render-bundle.json`、`assets/${encodeURIComponent(assetId)}.png` だけを完全に書く。PNG path は内部Compilerが生成した asset ID だけから導出し、全 artifact path を辞書順にする。manifest、Delivery artifact、publish metadata は M1 の公開artifactではない。

公開前に全 hash と I/O close を検証して staging を `.unframe/generations/<generation-id>/` へ rename する。公開先は root 固定の `dist` であり、CLI が管理する relative symbolic link とする。既存 `dist` が正確に3 segmentの relative target `.unframe/generations/<validated-id>`（`validated-id` は同じ grammar）を指す symlink でない場合は、置換・削除せず I/O diagnostic で拒否する。公開はこの同じ3 segment targetを持つ new symlink を作成して `rename` する一回の atomic replacement とする。root、`.unframe`、`generations`、generation directory はすべて root 内の non-symlink directory であることを `lstat` と open 時に検証し、外部symlinkとpath traversalを拒否する。build は公開済み generation を変更せず、staging / failed generation を公開しない。M1 は persistent managed marker も過去 generation の cleanup も導入せず、cleanup 対象は今回の process が作成した staging だけに限る。

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
