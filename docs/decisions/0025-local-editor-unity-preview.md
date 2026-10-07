# ADR-0025: ローカル Editor の Unity Preview と成果物境界

## Status

Accepted — 設計上の決定。実装と受け入れ検証は未完了。

## Context

プレゼンテーションの作成から本番読み込みまでを確認するため、ローカルで保存・ビルド・プレビューできる Editor を用意する。Unity を Web に埋め込み、成果物の読み込み・描画を先に完成させる。Unity 上の選択・移動・配置は拡張目標とする。

現行 CLI の build は `dist` を更新する。保存時の Dev Preview に同じ出力先を使うと、本番向け成果物が編集によって書き換わる。また、現行 Delivery は PublishedPresentation と PublicationFence を前提としており、公開前のプレビューへそのまま流用できない。

## Decision

- Editor は既存 Local Author Host と Web UI を使い、ローカルで完結する。編集の正本は Authoring Source・素材・config・lock。Definition や Unity の GameObject を保存元にしない。
- Web の Author と既存 Editor の関連 UI を `features/editor/` の一つの編集経路へ統合する。Local Author API を保存境界とし、旧 PresentationDocument・ブラウザー内文書保存・React 側の3D描画は置き換える。ローカル編集・Preview に Control Plane login を要求せず、認証・device authorization・account settings は公開時の関心として分離する。認証画面は CP の信頼済み Web origin、公開 credential の取得・保持は device authorization を使う Local Host が所有する。
- Dev Preview は保存済み入力から専用 channel に生成し、Dist Preview は既存 `dist` を読み取り専用で開く。同じ Compiler・成果物検証を使い、Dev は `dist` を更新しない。Control Plane への公開は、明示的に選んだ `dist` のみを対象とする。
- Dev は保存時にローカル Source・その file closure 内の素材の lock hash を自動 refresh する。元ファイルとの対応を持たない埋込素材は保持する。依存 package の解決・version 更新は明示操作とし、通常の check／build／publish は frozen のままにする。
- Core の描画選択・Runtime catalog 構築を publication に依存しない処理として共通化する。ローカル Preview と本番 Delivery は Adapter を分け、同じ Unity 読み込み・描画処理へ接続する。本番の公開・認可・fence 検証は維持し、ローカル用の架空 Publication／Session は生成しない。
- WebGL Bridge・ローカル素材取得・プレビュー用カメラは Web Preview Adapter、XR 入力・anchor は Quest Adapter が所有する。renderer に transport を持ち込まない。
- 保存、build 成功、Unity load 成功を区別する。失敗・取消・古い結果で最後の正常表示を失わない。
- 初期は Structured／Opaque Source から生成した baked-web の初期状態表示と視点操作を完成させる。Inspector 編集は既存 Author が扱える範囲に限り、編集用 metadata がないことを表示・build の拒否理由にしない。未対応の描画入力は理由を示して拒否する。GUI 編集の拡張と未保存 live compile は拡張目標とする。
- publish 開始時に、正常表示中の Dist Preview と現在の `dist` の build identity／artifact hashes が一致することを必須にする。一致後は対象 generation を固定する。
- 公開 E2E は実 Control Plane・素材保存・認証／認可と割り当て済み Realtime を使い、upload → Delivery／素材取得 → 実 ConnectionSnapshot → native Unity Editor の共通 Runtime 描画までを確認する。WebGL Preview は Core の宣言初期状態、本番 Session は Realtime の現在状態を使う。Cue／Timeline 再生、WebGL の本番 Realtime 接続、Quest 実機は後続とする。

ADR-0013 の「出力公開先は root 固定の `dist`」を Dev channel に限り拡張する。既存の安全な filesystem 公開規則と ADR-0022 の cache 境界は維持する。出力先と Preview 入力契約は設計書に定める。

## Alternatives Considered

- **閲覧経路先行（採用）**: Dist の実表示、Dev 更新、Local Author 統合、公開 E2E の順に進める。GUI 編集の拡張より成果物と Runtime の接続を優先する。
- **編集の縦切り先行**: 選択・移動から Source 保存までを早く検証できるが、今回の主目標より GUI 編集の実装が先行するため採用しない。
- **全契約・全 renderer の一括整備**: 初期 Preview に必要な範囲を超えるため採用しない。

## Consequences

プレビューと公開用成果物を分離でき、同じ描画処理で表示上の差を検証できる。既存 Author の Dev build 出力先と、Delivery に結び付いた描画入力の分離が必要になる。WebGL と Quest は transport・platform が異なるため、ブラウザーの検証を Quest 実機の証拠として扱わない。

Control Plane の Publication／Delivery と Unity の native 接続は既存 main の実装を統合して検証する。旧 Web 文書から Source への自動移行・互換保存経路は導入しない。

## Adoption and Exceptions

[Local Editor 設計・実装計画](../packages/LOCAL_EDITOR_DESIGN.md) の段階別受け入れ条件で検証する。Core の既存 Delivery 検証・生成契約・conformance を維持し、Dev 更新時の `dist` 不変と実 WebGL 描画を確認する。GUI 編集、追加描画形式、未保存 live compile、Realtime 再生／WebGL 接続／Quest 実機は、それぞれ対応範囲と検証条件を定めて追加する。
