# Presentation Components Architecture

- **Status**: M3A Authoring API に同期した初期 Structured Surface Primitive を実装済み
- **Scope**: Unframe 標準 Primitive、Component、Theme の package
- **Related**:
  - [Presentation Architecture](../../docs/packages/ARCHITECTURE.md)
  - [Presentation Implementation Design](../../docs/packages/DESIGN.md)
  - [Presentation Authoring Architecture](../unframe-authoring/ARCHITECTURE.md)
  - [M3A Structured Authoring Contract](../../docs/packages/AUTHORING_CONTRACT.md)

## 1. Role

`unframe-components` は Unframe が提供する再利用可能な標準 Primitive、Component、Theme を所有する。Presentation 全体の composition や renderer implementation ではなく、author が利用する versioned component contract と宣言的 source の配布単位である。

`unframe-authoring` が Manifest / Theme / Structure の宣言 API と形式を所有し、この package はその API で表現する標準値と標準 source を所有する。

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

Authoring mode は Component version ごとに固定する。Structured / Opaque の変更は Component version を更新する公開 contract 変更として扱う。migration metadata と自動変換は M3A より後に定義する。

## 4. Component contract

各 Component は必要な範囲で次を公開する。

- Component ID、version
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

`unframe-components` は `unframe-authoring` と `unframe-core` に依存できる。`unframe-compiler`、`unframe-renderer-api`、concrete renderer、Web Editor には依存しない。

Opaque source が React などを必要とする場合、その依存は Component renderer entry の build input として明示し、semantic package の初期化 side effect にしない。

## 8. Validation strategy

- Manifest / Structure schema と semantic validation
- Action / Output lowering fixture
- package lock と integrity drift test
- Structured Component の generic renderer conformance test
- Opaque Manifest と renderer binding の completeness test
- Component version / lock integrity fixture。migration fixtureはmigration contractの実装時に追加する
- visual regression は renderer package と共有する fixture に対して実行する

## 9. Deferred decisions

- Surface 以外に提供する Spatial / Surface Primitive と標準 Component set
- Component distribution と lockfile format
- Opaque dependency capability と sandbox policy
- Component / renderer drift の完全な検証方式
- Component migration metadata と自動変換
- Part partition permission / isolate

## 10. Current implementation

現在は `@unframe/unframe-components` から `standardSurfaceManifest`、`standardSurfaceStructure`、`standardTheme` と、それらを束ねる `standardComponents` を公開する。Structure は固定の `Surface → Frame → Text` Primitive graph、absolute layout、一つの `default` state、空の Interaction、`static / none / baked-web / reject` Render Intent を持つ。Text の primary font は Authoring の `AssetReference` で明示し、Structure は必須の `variantStyles` record を宣言する。

Manifest は実際に Structure へ結合できない Props、Slots、Parts、Variants、Actions、Outputs を先行公開しない。Structure の local ID と Text の font Asset reference は source に明示する。Renderer compatibility は `baked-web` という data で宣言し、renderer API や concrete renderer へ依存しない。

Authoring SDK は 6 category の Theme Token、同 category alias、Text / Frame Named Style、型付き Prop / Token reference、Variant style、typed Part override、Slot placeholder、nested Frame / Text を表現し、strict schema で検証する。Standard Theme 自体は空の Token / Named Style record のままであり、標準 visual design はまだ提供しない。

Component Props / Variant / Part / Slot の解決と展開、Spatial 3D Primitive、Interaction、Action / Output lowering、Opaque entry、package lock / integrity の縦断検証、migration、preview、visual regression はこの package の実装完了範囲に含めない。これらを暗黙の名前規約で補わず、Compiler / Renderer の対応 contract が実装された後に検証する。

型付き Theme、Props / Slots / Parts / Variants、nested Frame / Text の規則は [Structured Authoring Contract](../../docs/packages/AUTHORING_CONTRACT.md) を正本とする。Slot は Frame children 内の明示 placeholder を挿入位置とする。placeholder の `semanticParentId` は nested semantic roots の接続先を指定し、省略時は Surface の追加 roots として扱う。migration metadata / 自動変換と Part partition isolate は M3A に含めない。
