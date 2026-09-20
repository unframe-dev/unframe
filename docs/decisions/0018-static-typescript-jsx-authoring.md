# ADR-0018: 静的 TypeScript と JSX による Authoring

- **Status**: Accepted
- **Date**: 2026-09-20
- **Related**: [Authoring contract](../presentation/AUTHORING_CONTRACT.md), [ADR-0017](./0017-m3a-structured-authoring-contract.md)

## Context

M3A は静的な描画機能を接続したが、Source は builder に巨大な literal を渡す形に制限され、値や宣言を名前で共有できない。TypeScript の型補完とファイル分割を活かし、Component 内部の構造と Presentation の配置を JSX でも記述できるようにする。

## Decision

Authoring Source を実行しない境界を保ち、Compiler の静的な構文解決を拡張する。

- top-level `const`、宣言の import、静的な property 参照、オブジェクトの shorthand / spread、配列の spread を解決する。`as const` と `satisfies` は型付けに利用できる。
- object spread は左から右へ適用し、後の値が同じ property を上書きする。配列の spread は要素順を保つ。
- 型付き SDK の JSX tag で内部の Surface / Frame / Text / Slot と Presentation の Component 配置を記述する。JSX は builder と同じ Declaration Graph へ lower する。
- helper module は共有値を持ち、Presentation / Theme / Manifest / Structure の収集対象とは区別する。参照の循環や解決不能は source diagnostic にする。
- 任意関数、可変変数、代入、動的な import、loop / map による topology 生成、実行環境依存の値は対象外とする。Source や SDK の関数を評価するための JavaScript runtime は導入しない。
- Component ID と Node ID は明示し、v2 の契約・hash・成果物境界を変更しない。

## Consequences

型補完、値の共有、ファイル分割、木構造の記述を改善する。一方で、TypeScript 全体を利用できるわけではなく、許可構文と拒否診断を維持する必要がある。通常の TS / React としてソースを実行する案は、非実行保証と再現性を変えるため採用しない。

## Adoption and Exceptions

同じ宣言を builder / const / import / spread / JSX で記述した場合の値と hash の一致、拒否構文、循環、source location を回帰テストで検証する。reference project は実際の利用例としてこの記法を使用し、CLI の反復 build で成果物の一致を確認する。実行可能な構文を増やす場合は本 ADR と Authoring contract を更新する。
