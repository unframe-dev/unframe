# ADR-0020: Surface の Structured content と Opaque binding を区別する

- **Status**: Accepted
- **Date**: 2026-09-27
- **Related**: [ADR-0019](./0019-single-file-react-component-authoring.md)、[ADR-0015](./0015-presentation-definition-artifact-boundaries.md)、[Architecture](../packages/ARCHITECTURE.md)

## Context

従来の canonical Surface は Content Tree を必須とし、すべての Semantic Node を一つの Content Node に対応させていた。React Component の内部描画構造はコードが所有するため、この規則では明示された意味情報を独立して保存できない。

## Decision

Surface の `content` を判別 union にする。

- `structured`: `rootFrameId` と `nodes` に既存の描画ツリーを保持する。描画内容・layout の正本と、Semantic Node との一対一対応を維持する。
- `opaque`: `bindings` に binding key から Semantic Node ID への対応を保持する。基底 Semantic Node ごとに一つの binding を要求し、未宣言・重複・欠落を拒否する。内部描画ツリーは持たない。
- Semantic Tree、State、Interaction、host placement は共通とする。Opaque の State は意味と Interaction を扱い、`contentOverrides` は空に限定する。
- Renderer の内部 plan も Structured の Content Node 所有と Opaque の binding 所有を区別する。初期 Opaque は Surface 全体を所有する。
- React source、実行可能 module、DOM hierarchy は portable Definition に含めない。具体的な geometry は capture が解決する。

WIP の Presentation v2 schema を明示改訂し、旧 `rootFrameId` / `contentNodes` の入力を自動変換しない。既存 Source は新しい Compiler で再ビルドする。Structured の意味は維持するが、serialized bytes と Definition hash は変わる。

## Alternatives Considered

- 空の root Frame: 既存の Semantic Node 対応規則を満たさない。
- 仮の Text / Frame: 実際の React 描画と一致しない構造を正本として保存してしまう。
- canonical 接続を後回しにした描画試作: 技術検証はできるが、作者定義から Editor 保存までの縦断検証に必要な境界が残る。

## Consequences

Contracts、Core、Compiler、Renderer API / Web と fixture を一緒に更新する。Structured の保証を緩めずに Opaque の意味を保持できる一方、Surface を読む利用側は `content.kind` に応じた処理が必要になる。

## Adoption

schema と Core の拒否試験、Structured 回帰、Opaque の意味 materialization、Renderer の binding 所有、生成 JSON Schema / fixture の同期で検証する。Hit Region は [ADR-0021](./0021-surface-interaction-geometry.md) に従い、Core が Surface 単位で検証する。Opaque の DOM geometry / capture 実装と React 標準化の判断は ADR-0019 の後続工程に残す。
