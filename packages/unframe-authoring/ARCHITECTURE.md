# Presentation Authoring Architecture

- **Status**: M3C Action / Output / Cue declarations implemented
- **Public package name**: `@unframe/unframe-authoring`
- **Scope**: 利用者向け Authoring SDK、制限付き DSL、semantic authoring operation
- **Related**:
  - [Presentation Architecture](../../docs/packages/ARCHITECTURE.md)
  - [Presentation Implementation Design](../../docs/packages/DESIGN.md)
  - [Presentation Core Architecture](../unframe-core/ARCHITECTURE.md)
  - [M3A Structured Authoring Contract](../../docs/packages/AUTHORING_CONTRACT.md)

## 1. Role

`unframe-authoring` は、Presentation Orchestrator、Theme Declaration、Component Manifest、Structured Component Structure を記述する公開 SDK を所有する。Authoring Source を実行して Presentation を作る runtime ではなく、Compiler が静的に認識できる declaration signature と authoring operation の契約である。

同じ operation を Code authoring と Web Editor の Semantic Command が共有し、Lossless Syntax Tree / Source Map を介した意味論的 round-trip の基礎にする。

## 2. Public surfaces

- `definePresentation`
- `defineTheme`
- Component Manifest builder
- Props、Slots、Parts、Variants、States、Actions、Outputs の builder
- Spatial / Surface / Layout primitive の authoring declaration
- Theme、Token、Named Style、Asset reference
- 型付き Prop / Token reference と Slot placeholder
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

宣言には型付き builder に加え、top-level `const`、project 内 import / re-export、静的 property access、object / array spread、`as const` / `satisfies` を使える。role を持たない `.ts` / `.tsx` は helper module として検証する。

`Surface`、`Frame`、`Text`、`Slot`、`ComponentInstance` を JSX tag として提供する。`jsxImportSource` は `@unframe/unframe-authoring` とし、内部構造と Presentation の配置を同じ canonical declaration に変換する。JSX の opaque Element 型は入力だけに使い、definition builder の戻り値は canonical declaration 型を保つ。

Compiler は locked SDK の export provenance を確認し、Source module と builder function を実行せず AST を lower する。任意関数、loop / branch、dynamic import、builder 関数自身の local alias は拒否する。builder の戻り値を `const` で共有することは許可する。許可構文と JSX の children 規則は [Authoring Contract](../../docs/packages/AUTHORING_CONTRACT.md) と [ADR-0018](../../docs/decisions/0018-static-typescript-jsx-authoring.md) を参照する。

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

`unframe-authoring` は `unframe-core` と Zod 4 にだけ依存する。Compiler、Web Editor、Component package がこの package を利用する。Compiler や Web Editor への逆依存は禁止する。

## 8. Validation strategy

- declaration の型テスト
- AST fixture に対する recognized signature の contract test
- valid / invalid Manifest、Structure、Theme fixture
- Semantic Command と code patch の semantic equivalence fixture
- Structured / Opaque boundary と Action / Output lowering の fixture
- package import が filesystem、Browser、network side effect を起こさないことのテスト

公開 builder / definition の入力は、descriptor ベースの null-prototype plain-data snapshot で accessor、cycle、sparse array、symbol key、非 JSON 値を先に拒否してから Zod 4 schema に渡さなければならない。snapshot 後は caller-owned object を再読せず、配列長も own data descriptor から取得して inherited getter と Proxy の `get` trap を実行しない。Zod は string、number、tuple、record、enum、discriminated union と declaration の構造を検証する。参照の存在、一意性、tree、owner 継承のように複数 declaration を横断する意味論だけは Compiler / Core の責務として残す。現行実装の例外は「Current implementation」に明記する。

definition ごとの pure type guard は builder と同じ local declaration validation を共有しなければならない。Compiler は post-lowering value の検査にこの guard を利用できるが、builder implementation や Authoring Source は実行しない。

## 9. Deferred decisions

- Lossless Syntax Tree / source patching library
- `unframe.lock` と Component package distribution の形式
- public API の正確な naming と versioning
- Component migration metadata と自動変換
- Part partition permission / isolate

## 10. Current implementation

現在は M3C の reference Authoring Project に必要な次の宣言 API を提供する。

- `definePresentation`、`defineTheme`、`defineComponentManifest`、`defineComponentStructure`
- Props、Slots、Parts、Variants、States、Actions、Outputs の builder
- 6 category の Theme Token、同 category alias、Text / Frame の部分 Named Style
- `tokenRef`、`propRef`、`namedStyleRef`、`assetRef` と、Frame children に置く `slotPlaceholder`
- Stage、Flow、resource owner / audience、Component Instance と package lock
- Component Action の即時 Surface / Variable / Node effect、固定 Scalar payload の Output、Guard と fire policy を持つ Cue
- Spatial、Semantic Surface、absolute layout の nested Frame / Text。Text 本文、寸法、表示属性、対応する style scalar は型付き Prop reference を受け取る
- Structured Component の typed Variant style、typed Part override、Frame children 内の明示 `slot-placeholder` と Opaque Component の semantic binding
- Surface root が持つ semantic tree と、Frame-root Structure が持つ `baseSemanticTree`
- topology を変更しない semantic override と Structured Component の Detach vocabulary

Topology を持つ宣言は explicit ID を必須とする。source metadata は Compiler が AST から付与するため入力では任意とし、source correlation と diagnostic に共有できる型を提供する。API は finite な JSON plain data だけを受け取り、import 時登録、暗黙 ID、入力 mutation、function 値を持たない。

現行実装は static / finite-state、none / regions interaction の baked-web Surface、absolute layout、primitive な string / number / boolean Prop に限定する。State は Frame / Text の visual override、semantic override、enabled Interaction ID を宣言できる。Interaction は click event と hitPriority を明示する。API 境界では空 ID、非 finite な数値、不正な source range、JSON で表現できない値、旧 Slot / Part field、category のない Token reference、任意の style property を拒否する。参照の存在、一意性、alias cycle、tree、owner 継承、Manifest と Structure の整合性、解決後の値域は declaration を横断するため、Compiler / Core の semantic validation に残す。

parse、AST lowering、reference resolution、normalization、renderer、filesystem は実装せず、それぞれ Compiler、Core、concrete renderer の境界に残す。

package test の inline fixture に加え、公開用の `examples/presentation/` source が存在する。Compiler による解決と composition はこの fixture から v2 artifact まで接続し、Fixed Browser の反復 build で検証する。

Theme、Props、Slots、Parts、Variants、nested Frame / Text の意味規則は [Structured Authoring Contract](../../docs/packages/AUTHORING_CONTRACT.md) を正本とする。default、Named Style、inline style、Variant、Part の優先適用、Prop / Token 解決、Slot 展開、Part / Variant conflict、v2 出力接続は Compiler の責務であり、宣言 API の存在だけでは完了を意味しない。

個別 builder と宣言全体 guard は strict な runtime schema を共有し、Compiler の post-lowering も同じ guard を使う。Prop は `required: true` または型が適合する `default` の一方を必須とする。Slot は `slot-placeholder` の `id` / `slotId` で Frame children 内の挿入位置を表し、任意の `semanticParentId` で同じ Component の semantic node を親として参照する。`slotPlacements` と旧 `accepts` / `cardinality` / `required` は受理しない。Part は target kind ごとの content / placement / style だけを受け取り、旧 `overridable` を受理しない。

Frame-root Structure の semantic tree を宣言できる。Slot placeholder に `semanticParentId` があれば nested Component の semantic root をその node の子へ接続し、省略時は Surface の追加 root として扱う。参照先の存在と接続規則の検証は Compiler が所有する。Timeline、migration、自動変換、Part partition isolate は後続範囲である。
