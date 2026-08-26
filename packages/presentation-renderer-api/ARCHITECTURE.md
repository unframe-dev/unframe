# Presentation Renderer API Architecture

- **Status**: Proposal / Target, not implemented
- **Scope**: Compiler と concrete renderer の間の plugin contract
- **Related**:
  - [Presentation Architecture](../../docs/presentation/ARCHITECTURE.md)
  - [Presentation Implementation Design](../../docs/presentation/DESIGN.md)
  - [Presentation Core Architecture](../presentation-core/ARCHITECTURE.md)

## 1. Role

`presentation-renderer-api` は、Compiler が renderer implementation を選択・実行するための runtime-neutral plugin boundary である。Concrete renderer の処理や自動選択 policy は持たず、入力 capability、出力 artifact、diagnostics、provenance の共通契約を定義する。

## 2. Owned contract

- renderer identifier と version
- supported Surface Render Intent と capability declaration
- structured Primitive graph / opaque renderer entry の入力 contract
- renderer build context
- artifact candidate と resolved geometry の出力 contract
- deterministic output metadata と provenance
- stable diagnostic code
- renderer fixture と conformance harness

Conceptual interface は次の責務を持つ。

```text
RendererPlugin
├─ identity and version
├─ capability negotiation
├─ support(intent, input)
├─ build(context, input)
└─ provenance and diagnostics
```

正確な TypeScript API は実装時に定義する。

## 3. Input and output boundary

入力は `presentation-core` の semantic / build model と、Compiler が解決した明示的 build context に限定する。Renderer が project filesystem、environment variable、network を暗黙に探索しない。

出力は RenderBundle へ組み込める artifact descriptor、Surface State との mapping、resolved geometry、diagnostics、provenance とする。Renderer は PresentationDefinition の意味を書き換えない。

## 4. Invariants

- Renderer ID / version と output provenance を cache key と RenderBundle から追跡できる。
- `support` 判定と `build` 結果が同じ capability contract に従う。
- renderer output から Semantic Tree の意味を推測しない。
- RenderSurfaceId は build-local であり、canonical progression contract へ漏らさない。
- deterministic と宣言する plugin は同じ明示入力から同じ descriptor と content hash を生成する。
- renderer failure は semantic model の silent fallback に変換せず、diagnostic として返す。

## 5. Non-responsibilities

- Browser lifecycle、React / CSS rendering
- texture / video encoding
- concrete artifact generation
- renderer の自動選択 policy
- Compiler pass と cache orchestration
- CLI command、publish、Delivery

## 6. Dependency rules

`presentation-renderer-api` は `presentation-core` にだけ依存する。Compiler と concrete renderer が API に依存する。API から concrete renderer、Compiler、CLI への依存は禁止する。Concrete renderer 同士も依存しない。

## 7. Conformance strategy

- capability support matrix fixture
- valid / invalid build input fixture
- deterministic output / provenance fixture
- diagnostic code contract test
- Structured Semantic Tree を変更しないことの test
- renderer version と cache invalidation の fixture

Conformance harness は renderer implementation の process topology を固定せず、in-process / child process / remote adapter のいずれでも同じ観測可能な contract を検証できるようにする。

## 8. Deferred decisions

- plugin discovery と version negotiation
- process / isolate boundary
- capability vocabulary
- cancellation、timeout、resource budget の API
- Native UI / Video renderer API の追加時期
