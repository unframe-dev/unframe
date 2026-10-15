# ADR-0019: 一ファイルの React Component Authoring を採用する

- **Status**: Accepted（Linux のローカル Authoring と baked-web PNG preview に限定）
- **Date**: 2026-10-01
- **Related**: [設計案と実装計画](../packages/REACT_COMPONENT_AUTHORING.md)、[実装 contract](../packages/REACT_COMPONENT_EXECUTION_CONTRACT.md)、[ADR-0018（アーカイブ）](archived/0018-static-typescript-jsx-authoring.md)、[ADR-0014](./0014-presentation-rendering-scope.md)、[ADR-0013](./0013-local-compiler-project-filesystem-contract.md)

## Context

Structured Authoring は Manifest、Structure、lock、Instance と Spatial Node の接続を作者に要求する。一ファイルの React Component から公開契約と描画を分離し、一つの import で配置することで、この手動接続と Props / 型の重複を減らす。

静的抽出、隔離 capture、有限 State、Source 保存と局所編集をローカル経路で検証した。提供範囲と性能の根拠は [受け入れ記録](../packages/REACT_COMPONENT_AUTHORING.md#6-受け入れ検証と導入条件) に示す。Surface の描画内容と意味の分離は [ADR-0020](./0020-structured-and-opaque-surface-content.md) に従う。

## Decision

一ファイルの React Component を、ローカル Authoring の Opaque 経路として採用する。公開契約は非実行で抽出し、全宣言 State を Linux の隔離 Browser で PNG にする。ローカル Inspector は公開 scalar Props、host Transform と宣言済み操作を扱う。

- 作者は Component ID、公開契約 version、Props、明示 semantics、React render を定義する。Presentation は Component 参照、Instance ID、所有範囲と配置を定義する。Manifest、renderer entry、host Spatial Node と lock への接続はツールが生成する。
- 公開契約と Presentation は非実行の静的解析を維持する。元の Component module を実行して契約を取得せず、AST から描画用 virtual module と依存を抽出する。
- Semantic Tree と公開操作は明示宣言を正本にする。描画の binding は宣言済みの意味へ対応し、DOM から意味を推測しない。React のイベントや状態を MR Runtime の操作・状態へ自動変換しない。
- Editor は Instance の公開 Props と host Transform を編集し、Source と lock を保存する。React の内部構造はコードが所有する。
- 通常 build は固定済み依存を検証する。ローカル source の lock 更新と外部依存の更新を区別し、成果物 checksum は出力 BuildManifest 等へ記録する。
- Structured は維持する。共通の配置・公開契約を利用できるようにし、React の内部編集、Structured への自動変換、機能差を隠す互換層は追加しない。

## Alternatives Considered

- **B: Structured の API 整理を先行**。既存経路の改善には適するが、一ファイルの静的抽出と React capture の不確実性が残る。配置 API の整理は A の必要工程として取り込む。
- **C: 両 Authoring mode と全公開機能を同時に整備**。初期から State、Slot、Parts 等を広げると、問題を切り分けにくい。有限 State の使用例は先に設計し、実装は静的経路の検証後に行う。

## Consequences

- **Positive**: 型と値の重複、Manifest / lock / Spatial Node の手動接続を減らし、Web の描画資産を利用できる。
- **Negative**: 一ファイルでも二つの解析・実行領域が必要になる。任意 React の表示と意味の完全一致、内部 GUI 編集、portable rendering は保証しない。
- **Impact**: Authoring、Compiler、Renderer API / Web、CLI と Web Editor を変更する。Contracts / Core の Surface 表現も ADR-0020 に従って変更する。Structured の意味は維持し、成果物は改訂 schema に合わせて再ビルドする。Control Plane・Realtime・Unity の完成をこの検証の成果に含めない。

## Adoption and Exceptions

型推論と拒否診断、静的領域の非実行、binding、反復 build、Instance 編集の保存と競合を回帰テストで固定する。既存 Structured の成果物・拒否条件も維持する。Browser の受け入れ試験は `scripts/ci/opaque-capture.sh`、提供範囲と実測は作者向け文書で管理する。

隔離・固定依存・保存整合性の要件を満たさない host / 入力は拒否する。未対応入力を既存経路へ暗黙 fallback させない。SDK の一般配布や任意 UI ライブラリの互換性は未検証であり、リポジトリ内 fixture の成功から一般化しない。速度改善と描画 cache は後続とし、今回の導入は毎回 capture を行う待ち時間を許容するローカル作業に限定する。

## Follow-ups

- [x] 静的抽出・全 State capture、直接 / 共有値の局所編集・保存・Undo / Redo、公開 Action / Output と既存 Flow の接続を検証する。
- [x] 固定 Base UI fixture の visual・再現性・描画依存変更・性能を記録し、ローカル提供範囲と導入条件を確定する。
- [ ] publish / Delivery の受け入れ検証と Go / C# / Unity / Quest consumer の接続・実機確認。
- [ ] SDK の一般配布、対応 UI ライブラリの拡大と描画 cache / 速度改善。
