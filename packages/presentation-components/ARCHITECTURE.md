# Presentation Components Architecture

- **Status**: Proposal / Target, not implemented
- **Scope**: Unframe 標準 Primitive、Component、Theme の package
- **Related**:
  - [Presentation Architecture](../../docs/presentation/ARCHITECTURE.md)
  - [Presentation Implementation Design](../../docs/presentation/DESIGN.md)
  - [Presentation Authoring Architecture](../presentation-authoring/ARCHITECTURE.md)

## 1. Role

`presentation-components` は Unframe が提供する再利用可能な標準 Primitive、Component、Theme を所有する。Presentation 全体の composition や renderer implementation ではなく、author が利用する versioned component contract と宣言的 source の配布単位である。

`presentation-authoring` が Manifest / Theme / Structure の宣言 API と形式を所有し、この package はその API で表現する標準値と標準 source を所有する。

## 2. Owned content

- Spatial Primitive の Manifest
- Surface Primitive の Manifest と structured definition
- 標準 Structured Component と Variant
- 必要な場合の標準 Opaque Component source
- 標準 Theme、Token、Named Style
- renderer compatibility と required capability の declaration
- component contract fixture と任意の preview fixture

```text
components/<name>/
├─ <name>.manifest.ts
├─ <name>.structure.tsx   # Structured の場合
├─ <name>.web.tsx         # Opaque baked-web の場合
└─ <name>.css             # Opaque source が必要な場合
```

## 3. Structured and opaque ownership

Structured Component は Manifest と Structure を正本とし、Component 固有 renderer implementation を持たない。generic renderer が lower 後の Primitive graph を描画する。

Opaque Component は Manifest を意味の正本、renderer entry を描画の正本とする。DOM、React tree、CSS、実行結果から Manifest にない State、Interaction、Action、Output を追加しない。

Authoring mode は Component version ごとに固定する。Structured / Opaque の変更は migration を伴う公開 contract 変更として扱う。

## 4. Component contract

各 Component は必要な範囲で次を公開する。

- Component ID、version、migration metadata
- Props、Slots、Parts、Variants
- Runtime States
- compile-time Actions と Outputs
- Theme requirements
- Semantic Node / Surface / Interaction の公開 binding
- 対応 renderer ID と required capability
- Editor metadata

Preview は開発補助であり、default Props、Manifest、Structure の正本ではない。Preview がなくても check、build、publish できなければならない。

## 5. Invariants

- Manifest にない interaction や Output を renderer source が発生させない。
- Structured renderer は Structure にない semantic information を追加しない。
- local ID は Component Instance への展開時に deterministic な global stable ID へ変換できる。
- local ID を配列位置、React key、renderer の実行順序から暗黙生成しない。
- Action / Output は Component 固有 runtime command を残さず canonical contract へ lower できる。
- package lock は Component ID、version、integrity、Manifest hash を固定し、Structured では Structure hash、Opaque では renderer entry hash も固定する。
- renderer compatibility は data として宣言し、concrete renderer package へ import 依存しない。

## 6. Non-responsibilities

- Presentation 全体の composition と Global Flow
- Compiler pipeline と plugin selection
- generic renderer implementation
- product-specific template と user content
- Control Plane publication、Delivery、Runtime progression

## 7. Dependency rules

`presentation-components` は `presentation-authoring` と `presentation-core` に依存できる。`presentation-compiler`、`presentation-renderer-api`、concrete renderer、Web Editor には依存しない。

Opaque source が React などを必要とする場合、その依存は Component renderer entry の build input として明示し、semantic package の初期化 side effect にしない。

## 8. Validation strategy

- Manifest / Structure schema と semantic validation
- Action / Output lowering fixture
- package lock と integrity drift test
- Structured Component の generic renderer conformance test
- Opaque Manifest と renderer binding の completeness test
- Component version / migration fixture
- visual regression は renderer package と共有する fixture に対して実行する

## 9. Deferred decisions

- 最初に提供する Primitive / Component set
- Component distribution と lockfile format
- Opaque dependency capability と sandbox policy
- Component / renderer drift の完全な検証方式
