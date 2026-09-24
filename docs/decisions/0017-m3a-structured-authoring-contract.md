# ADR-0017: M3A の Structured Authoring 契約を固定する

- **Status**: Accepted
- **Date**: 2026-09-19
- **Related**: [Structured Authoring Contract](../packages/AUTHORING_CONTRACT.md), [Presentation v2](../packages/DATA_MODEL.md), [ADR-0011](./0011-surface-partition-contract.md), [ADR-0014](./0014-presentation-rendering-scope.md)

## Context

M1 の Local Compiler は静的な `Surface → Frame → Text` subset を v1 成果物へ出力できる。一方、Presentation v2 の成果物契約は定義済みだが、Compiler、Core の完全な意味検証、Renderer API、Web renderer はまだ一つの v2 経路として接続されていない。Theme と Structured composition を旧出力へ追加すると、後で同じ機能を v2 へ作り直すことになる。

また、既存の Authoring 型は Props、Slots、Parts、Variants を先行して表現するが、宣言全体の runtime guard と個別 builder の検証範囲に差がある。この差を残したまま Compiler の拒否制限を外せない。

## Decision

M3A は静的な `baked-web` の Authoring から成果物生成までを Presentation v2 へ縦断接続する。旧 v1 出力の互換経路は追加しない。

M3A で実装する Authoring の意味規則は [Structured Authoring Contract](../packages/AUTHORING_CONTRACT.md) を正本とする。対象は型付き Theme、Props、Slots、Parts、Variants、Frame / Text の absolute な入れ子、Font Asset 解決である。Contracts、Core、Authoring、Components、Compiler、Renderer API、Web renderer、Asset 情報、CLI / reference project を同じ変更系列で接続する。

State の visual variation、Interaction、Timeline、Native UI、Video、Delivery、Runtime、Unity 接続は後続スライスに残す。v2 に型が存在していても M3A が扱わない入力は明示的に拒否する。

Component migration metadata と自動変換は後続へ延期する。M3A は Component version と package lock / integrity の整合性を検証し、不適合な更新を build error にする。

[ADR-0011](./0011-surface-partition-contract.md) の Part isolate と partition permission は有効な後続設計として維持するが、M3A には含めない。M3A の公開 Part は property ごとの権限リストを持たず、適合する content、placement、style の override を受ける。

## Consequences

- **Positive**: Theme と composition を最終的な v2 成果物境界で一度だけ実装できる。
- **Positive**: Authoring 型、runtime schema、意味検証、renderer 入力、reference artifact の drift を同じ縦断 fixture で検出できる。
- **Negative**: M3A は複数 package と生成物を同時に移行する破壊的変更になる。
- **Negative**: migration と partition isolate を必要とする Component は後続実装まで利用できない。
- **Follow-up**: 実装前に Authoring の declaration guard と builder の検証を一致させる。

## Adoption and Exceptions

- M3A の各機能は Contracts から reference project まで同じ変更系列で実装し、v1 / v2 の二重出力を追加しない。
- default 適用の warning、参照・型・循環・owner・配置・必須値の error を deterministic な diagnostic として fixture 化する。
- 本 ADR の範囲を変える場合は、契約文書と実装計画を同じ変更で更新する。Runtime や partition を M3A に追加する変更は別の設計判断として記録する。
