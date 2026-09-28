# ADR-0019: 一ファイルの React Component Authoring を採用前提で実装する

- **Status**: Proposed（採用前提で実装。正式採用と詳細の確定は未了）
- **Date**: 2026-09-27
- **Related**: [設計案と実装計画](../packages/REACT_COMPONENT_AUTHORING.md)、[実装 contract](../packages/REACT_COMPONENT_EXECUTION_CONTRACT.md)、[ADR-0018](./0018-static-typescript-jsx-authoring.md)、[ADR-0014](./0014-presentation-rendering-scope.md)、[ADR-0013](./0013-local-compiler-project-filesystem-contract.md)

## Context

現行の Structured Authoring は Manifest、Structure、lock、Instance と Spatial Node の接続を作者に要求する。Opaque は build-time React 描画を想定しているが、bundle から Browser execution / capture への接続は未実装である。公開契約と描画を一つの Component 定義へまとめ、Presentation から一つの import で配置する作者体験を検証する。

Web の UI ライブラリを使う Component の標準経路として採用する前提で、React の最小縦断経路を先に通す A 案を進める。本 ADR の API・保存・依存管理の詳細は実装で検証・調整する提案であり、既存の Accepted ADR をこの文書だけで変更しない。

A0 で三例の型推論と拒否入力を検証し、lock v2、static / render 抽出、ローカル HTTP host、journal による保存、Linux capture profile を実装 contract に具体化した。実装に進める設計と、動作確認済みの機能は区別する。

A1 着手前に確認した canonical Surface の Content Tree 必須規則との差は、[ADR-0020](./0020-structured-and-opaque-surface-content.md) の Structured / Opaque 分岐で解消する。この共通モデルの変更は採用済みであり、React 経路の導入判定とは区別する。

## Decision

一ファイルの Component から静的な公開契約と実行可能な描画コードを分離し、単一 Surface の静的 `baked-web`、Editor 編集・保存、有限 State の順で検証する。

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

各工程の受け入れ条件は設計案に置く。型推論と拒否診断、静的領域の非実行、binding、反復 build、Instance 編集の保存と競合を回帰テストで固定する。既存 Structured の成果物・拒否条件も検証する。

縦断検証では、採用する方向性を前提に、標準経路として提供できる範囲と残課題を確認する。静的領域の非実行、隔離実行、再現性、保存の整合性を成立させられないなど、前提を覆す結果が出た場合に方針を再検討する。実装へ移る際は対象 subset の契約を先に確定し、ADR-0018 の適用領域、ADR-0013 の source / lock / 保存契約、Authoring Contract と package 文書を同期する。未対応入力を既存経路へ暗黙 fallback させない。

## Follow-ups

- [x] 三つの作者向け例の型推論・拒否入力を検証し、生成・保存・実行規則を A0 の実装設計へ具体化する。
- [x] canonical Surface の Structured / Opaque 表現、schema の移行、Core / Renderer の検証境界を ADR-0020 で確定する。
- [ ] 静的 React capture と、Editor から Source へ戻る保存経路を検証する。
- [ ] 有限 State、公開 Action / Output と既存 Flow の接続を検証する。
- [ ] 対応 UI ライブラリと CSS 処理、build 時間・再現性の測定結果を記録し、提供可能な範囲と残課題を確定する。
