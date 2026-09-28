# M3A Structured Authoring Contract

- **Status**: Implemented for static baked-web; runtime features deferred
- **Scope**: Static `baked-web` Theme and Structured composition
- **Related**: [ADR-0017](../decisions/0017-m3a-structured-authoring-contract.md), [Presentation v2](./DATA_MODEL.md), [Presentation Architecture](./ARCHITECTURE.md)

この文書は M3A の Authoring と compile-time 解決規則の正本である。公開 TypeScript 名、Zod field、diagnostic code などの実装詳細は、以下の意味を変えない範囲で実装時に確定する。

## Scope and resolution

M3A は静的な `baked-web` の生成経路を Authoring から Presentation v2 成果物まで接続する。旧 v1 出力の互換経路は追加しない。State の visual variation、Interaction、Timeline、Native UI、Video、Delivery、Runtime、Unity 接続は後続へ残し、M3A では明示的に拒否する。静的 Surface に必要な基本 State の宣言と v2 State envelope はこの拒否対象ではない。

値の解決順は次のとおりとし、後段が同じ property を上書きする。配列は要素単位に merge せず全置換する。

1. Primitive default
2. Named Style
3. Primitive の inline style
4. Variant
5. 公開 Part の Instance override

Named Style の継承と、一つの Primitive への複数 Named Style 適用は行わない。解決後の値は [v2 Definition schema](../../packages/contracts/src/presentation/v2/definition.ts) に従い、必須値の不足や不正値は build error とする。

## TypeScript / JSX source

Source は静的に解決し、module や builder 関数を実行しない。[ADR-0018](../decisions/0018-static-typescript-jsx-authoring.md) に従い、次の記法を同じ宣言モデルへ lower する。

- top-level `const` と、その値・宣言を共有する project-relative import
- 静的な property / literal index 参照、object shorthand、object / array spread
- 型注釈、type-only import、`as const`、`satisfies`
- SDK の JSX tag による Component 内部の構造と Presentation の Component 配置

object spread は後の property を優先し、array spread は要素順を保持する。宣言 file の default export は root builder の結果、またはその `const` 参照とする。宣言用 suffix 以外の `.ts` / `.tsx` は helper module とし、独立した Theme / Component として収集しない。未使用の helper も同じ静的構文の検査対象とする。

JSX は `Surface`、`Frame`、`Text`、`Slot`、`ComponentInstance` を SDK から import して使う。`Surface` は単一の Frame を子に持ち、`Frame` は子の配列を再帰的に平坦化して順序を保つ。`Text` は `value` 属性か string / Prop reference の子の一方を使う。`Slot` と `ComponentInstance` は子を持たない。属性 spread は後の値を優先し、`children` 属性と本文の子の併用は拒否する。Fragment、独自 tag、HTML tag、`key` / `ref`、`null` / `false` の子は受理しない。 Text 本文の改行・字下げは JSX の空白規則で正規化する。`&` を含む本文は entity 解釈を避け、`value` または `{ "A & B" }` のような文字列式で指定する。

任意関数、可変変数や代入、getter、動的 import、loop / map による topology 生成は拒否する。JSX も同じ非実行の制約に従い、stable ID、Props / Slots / Parts / Variants、lock の検証を省略しない。循環・解決不能な参照は参照位置の source diagnostic とする。展開後の値は定義位置を source map に保持し、記法やファイル分割だけで semantic hash を変えない。型注釈や assertion で runtime schema の検証を回避できない。

## Theme and font

Token category は `color`、`logicalLength`、`spatialLength`、`fontFace`、`duration`、`easing` とする。同じ Theme 内の同じ category の Token を alias できる。参照先の欠落、category の不一致、循環参照は build error とし、Compiler が具体値まで解決する。計算式と文字列展開は導入しない。

Named Style は部分指定可能な `TextStyle` と `FrameStyle` に限定する。対象 Primitive に適合する property だけを指定でき、値は具体値または適合する category の Token 参照とする。任意の CSS は受理しない。Shape / Model の style と、Theme による Layout、topology、親子関係、Spatial Transform、Flow の変更は M3A の対象外である。

Font Face Token は一つの Font Asset ID を参照する。TextStyle の primary font と順序付き fallback fonts は、それぞれ Asset を直接参照するか Font Face Token を参照する。Compiler は具体的な Asset ID に解決し、renderer はその素材を読み込む。primary font の未指定、参照先の欠落、読み込み失敗は build error とする。OS font への暗黙 fallback は行わず、fallback の空配列は許可する。

## Props

Prop の型は `string`、`number`、`boolean` とする。Structure の型が適合する値の位置に明示的な Prop 参照を置ける。Text 本文、数値の配置・寸法、表示可否などの値を変更できるが、Node ID、Node kind、親子関係、Node 数は変更できない。文字列埋め込み、計算式、任意関数は導入しない。

各 Prop は必須、または型が適合する default を持つもののどちらか一方とする。Instance が必須 Prop を省略した場合、未宣言 Prop、型不一致、解決後の不正値は build error とする。空文字、`0`、`false` は明示値として扱う。

default のある Prop を Instance が省略した場合は build を継続し、Component Instance ID、Prop 名、採用した default 値を含む compile warning を出す。default と同じ値を明示した場合は warning を出さない。

## Slots and nested components

Slot binding は順序付きの Component Instance ID 配列とし、省略と空配列を許可する。`cardinality`、`required`、Component の許可リスト `accepts` は削除し、M3A の入力では旧 field を拒否する。

配置先は親 Frame の `children` 内の明示 Slot placeholder とする。Compiler はその位置を binding 配列順の子 Instance に置き換え、既存 children との前後関係を保持する。省略または空配列の Slot は子を挿入しない。

Slot placeholder は同じ Component の Semantic Node ID を `semanticParentId` として指定できる。指定した場合、子 Instance の semantic roots をその Node の既存の子の後へ binding 配列順で接続する。参照先の欠落は build error とする。省略時は親 Surface の追加 semantic roots として結合する。

参照先が存在し配置可能であることを検証する。一つの Instance の配置先は一つだけとし、同じ Slot 内または別 Slot での重複、自己参照、循環参照を build error にする。同じ Component を複数箇所へ置く場合は別の Instance ID を使う。Slot の親子は同じ resource owner を持たなければならず、Compiler は owner を暗黙に変更しない。

トップレベル Component は `Surface`、Slot 内 Component は `Frame` を root とする。Slot 内の別 `Surface` は拒否する。Slot 内 Instance は独立したトップレベル配置として描画せず、親 Component の配置先から相対配置して親と同じ Surface に展開する。Instance ID を維持し、内部 Node ID は Instance ID と Component 内の stable local Node ID から一意に導出する。

## Variants

Variant は Primitive の style property だけを上書きできる。本文、配置、Node topology は変更できない。選択された複数 Variant が同じ Node の同じ property を上書きする場合は、宣言順で解決せず build error とする。

Instance が Variant を省略した場合、Manifest に default があれば適用して compile warning を出す。default がなければその Variant の override を適用しない。未定義の選択肢と、選択肢に存在しない default は build error とする。

## Parts

Manifest の公開 Part は、対象 Primitive に適合する Text 本文の文字列、placement、style を Instance から上書きできる。property ごとの permission list `overridable` は削除し、M3A の入力では旧 field を拒否する。未公開 Part、対象に適合しない field、不正な型・値、Node topology の変更は build error とする。

一つの Part ID は一つの Primitive Node に結び付け、一つの Node に複数の Part ID を割り当てない。存在しない Node への binding は拒否する。Frame の子は自動的に公開せず、直接変更する子は別の Part として公開する。

Part isolate と partition permission は [ADR-0011](../decisions/0011-surface-partition-contract.md) の後続設計であり、M3A の Part override には含めない。

## Primitive nesting and defaults

M3A は `Frame` 内の `Frame` / `Text` と absolute layout に対応する。子の位置は親 Frame を基準とし、入れ子の Frame にも style と clipping を適用する。Stack / Grid は拒否する。

Primitive default は次のとおりとする。

| Target | Default                                                              |
| ------ | -------------------------------------------------------------------- |
| Common | `visible: true`、`opacity: 1`                                        |
| Frame  | 透明背景、border なし、clipping なし                                 |
| Text   | 黒、regular、start alignment、overflow clip、fallback fonts は空配列 |

Text content、位置、寸法、primary font、font size、line height には暗黙 default を設けない。解決後に不足していれば build error とする。Primitive default の使用だけでは warning を出さない。

## Version, lock, and deferred migration

M3A は Component version、package lock、package integrity と Theme / Manifest / Structure の hash 整合性 を検証する。不適合な Props、Slots、Parts、Variants を含む package 更新は build error とし、暗黙に変換しない。

Component migration metadata と自動変換は後続へ延期する。State、Interaction、Action / Output、Runtime、partition isolate の契約もこの文書では確定しない。

## Implementation prerequisite

Authoring SDK の個別 builder と declaration 全体の guard は local declaration schema を共有し、Compiler の post-lowering も同じ guard を使う。Prop default、Slot / Part の旧 field、Named Style の JSON object 形状をこの境界で検証する。型付き Theme と composition は Compiler が具体的な v2 値へ解決する。M3A の範囲外にある動的機能の拒否制限は維持する。
