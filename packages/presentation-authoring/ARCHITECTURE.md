# Presentation Authoring Architecture

- **Status**: Proposal / Target, not implemented
- **Public package name**: `@unframe/presentation`
- **Scope**: 利用者向け Authoring SDK、制限付き DSL、semantic authoring operation
- **Related**:
  - [Presentation Architecture](../../docs/presentation/ARCHITECTURE.md)
  - [Presentation Implementation Design](../../docs/presentation/DESIGN.md)
  - [Presentation Core Architecture](../presentation-core/ARCHITECTURE.md)

## 1. Role

`presentation-authoring` は、Presentation Orchestrator、Theme Declaration、Component Manifest、Structured Component Structure を記述する公開 SDK を所有する。Authoring Source を実行して Presentation を作る runtime ではなく、Compiler が静的に認識できる declaration signature と authoring operation の契約である。

同じ operation を Code authoring と Web Editor の Semantic Command が共有し、Lossless Syntax Tree / Source Map を介した意味論的 round-trip の基礎にする。

## 2. Public surfaces

- `definePresentation`
- `defineTheme`
- Component Manifest builder
- Props、Slots、Parts、Variants、States、Actions、Outputs の builder
- Spatial / Surface / Layout primitive の authoring declaration
- Theme、Token、Named Style、Asset reference
- Stable ID、source metadata、Component Instance operation
- Structured / Opaque authoring mode
- override、Detach、semantic command が共有する operation vocabulary

公開 API は Compiler が AST 上で symbol と signature を識別できる形に保つ。任意の runtime side effect や import-time registration を必要としない。

## 3. Source boundaries

```text
presentation.unframe.tsx       # composition root
theme.unframe.ts               # Theme declaration
*.manifest.ts                  # Component public contract
*.structure.tsx                # Structured Component internal declaration
*.web.tsx / *.css              # Opaque renderer source, authoring SDKの所有外
```

Manifest は Component の公開意味を持つ。Structure は Structured Component の内部宣言を持つ。Opaque renderer の React / CSS 実装はこの package に含めず、Manifest がその entry と binding key を宣言する。

## 4. Static DSL contract

Presentation Orchestrator、Theme、Manifest、Structure は静的解析可能な制限付き DSL とする。

- 許可された declaration と expression を明示する。
- declaration は AST から Declaration Graph へ lower できなければならない。
- Stable ID と source correlation を失う暗黙生成を避ける。
- dynamic ID、loop / `map` による topology 生成、dynamic import、任意関数呼び出しを許可しない。
- filesystem、network、process environment、clock、random、DOM、React state に依存しない。
- arbitrary JS を必要とする処理は Opaque renderer source に閉じ込める。
- Preview source は build input や contract の正本にしない。

具体的な許可構文の判定、parse、typecheck、symbol resolution は Compiler が所有する。

## 5. Invariants

- `presentation.unframe.tsx` は Component の配置と接続を行う composition root であり、Component 内部を展開した正本にしない。
- Component Action は canonical Action batch、Output は明示された canonical event source / Trigger へ compile-time に完全に lower できる。
- Structured / Opaque mode は Component version ごとに一つに固定する。
- GUI が編集できる範囲は Manifest と Structure が宣言した semantic boundary を超えない。
- renderer の DOM、React tree、capture result から authoring semantics を逆推論しない。
- Detach は authoring operation であり、Delivery artifact から source を復元しない。

## 6. Non-responsibilities

- Authoring Source の parse、typecheck、AST lowering
- Declaration Graph normalization と semantic validation
- Opaque renderer bundle / execution
- renderer artifact generation
- project filesystem、lockfile、cache
- Web Editor UI と history state
- Control Plane persistence と publish
- Runtime progression evaluation

## 7. Dependency rules

`presentation-authoring` は `presentation-core` にだけ依存する。Compiler、Web Editor、Component package がこの package を利用する。Compiler や Web Editor への逆依存は禁止する。

## 8. Validation strategy

- declaration の型テスト
- AST fixture に対する recognized signature の contract test
- valid / invalid Manifest、Structure、Theme fixture
- Semantic Command と code patch の semantic equivalence fixture
- Structured / Opaque boundary と Action / Output lowering の fixture
- package import が filesystem、Browser、network side effect を起こさないことのテスト

## 9. Deferred decisions

- Static DSL の完全な許可構文
- Lossless Syntax Tree / source patching library
- `unframe.lock` と Component package distribution の形式
- public API の正確な naming と versioning
