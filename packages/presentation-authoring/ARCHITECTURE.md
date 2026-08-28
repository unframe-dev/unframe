# Presentation Authoring Architecture

- **Status**: Initial declaration API implemented; compiler integration deferred
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

`presentation-authoring` は `presentation-core` と Zod 4 にだけ依存する。Compiler、Web Editor、Component package がこの package を利用する。Compiler や Web Editor への逆依存は禁止する。

## 8. Validation strategy

- declaration の型テスト
- AST fixture に対する recognized signature の contract test
- valid / invalid Manifest、Structure、Theme fixture
- Semantic Command と code patch の semantic equivalence fixture
- Structured / Opaque boundary と Action / Output lowering の fixture
- package import が filesystem、Browser、network side effect を起こさないことのテスト

公開 builder / definition の入力は、descriptor ベースの plain-data snapshot で accessor、cycle、sparse array、symbol key、非 JSON 値を先に拒否してから Zod 4 schema に渡す。Zod は string、number、tuple、record、enum、discriminated union と declaration の構造を検証する。参照の存在、一意性、tree、owner 継承のように複数 declaration を横断する意味論だけは Compiler / Core の責務として残す。

## 9. Deferred decisions

- Static DSL の完全な許可構文
- Lossless Syntax Tree / source patching library
- `unframe.lock` と Component package distribution の形式
- public API の正確な naming と versioning

## 10. Current implementation

現在は最初の reference Authoring Project に必要な次の宣言 API を提供する。

- `definePresentation`、`defineTheme`、`defineComponentManifest`、`defineComponentStructure`
- Props、Slots、Parts、Variants、States、Actions、Outputs の builder
- Token、Named Style、Asset reference
- Stage、Flow、resource owner / audience、Component Instance と package lock
- Spatial、Semantic Surface、absolute layout の Frame / Text
- Structured Component の Part / Slot mapping と Opaque Component の semantic binding
- topology を変更しない semantic override と Structured Component の Detach vocabulary

Topology を持つ宣言は explicit ID を必須とする。source metadata は Compiler が AST から付与するため入力では任意とし、source correlation と diagnostic に共有できる型を提供する。API は finite な JSON plain data だけを受け取り、import 時登録、暗黙 ID、入力 mutation、function 値を持たない。

最初の実装は static / non-interactive / baked-web Surface、absolute layout、flat Scalar payload に限定する。API 境界では空 ID、非 finite な数値、不正な source range、JSON で表現できない値を拒否する。参照の存在、一意性、tree、owner 継承、Manifest と Structure の整合性は declaration を横断するため、ここでは検証せず Compiler / Core の semantic validation に残す。

parse、AST lowering、reference resolution、normalization、renderer、filesystem は実装せず、それぞれ Compiler、Core、concrete renderer の境界に残す。

現時点の reference Authoring Project は package test 内の inline fixture であり、Stage、Surface Component、Semantic Tree、Flow を current contract へ lower できる入力として固定している。公開用の `examples/presentation/` source は Compiler / CLI と同じ品質ゲートで実行できる段階に追加する。
