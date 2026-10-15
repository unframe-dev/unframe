# ADR-0024: Presentation契約を正式名に統一する

## Status

Accepted

## Context

Presentation契約は完全版と初期subsetが並存していた。現行packagesは完全版を使うため、名前のV2 suffixと旧subsetの公開は不要である。

## Decision

- 旧Presentation v1のportable schema・fixture・exportを廃止し、データ移行や互換adapterを設けない。
- TypeScript型、公開import、ファイルパス、生成コマンド、Protobuf packageとservice名をバージョンsuffixのない正式名に統一する。
- serialized `schemaVersion` / `contractVersion` の値 `2`、通信の `protocol_version: "v2"`、field番号とenum数値は維持する。
- 移行中は旧Realtime v1のprotoと生成コードを既存サーバーの依存に限って残し、旧実行経路の撤去と同時に廃止する。現在は撤去済みである。旧HTTP CRUD契約の更新は別途行う。

### 生成 consumer の責務

[ADR-0023（アーカイブ）](./archived/0023-m5-generated-consumer-boundaries.md) の生成責務は、正式名への統一後も次の境界で維持する。

- `packages/contracts` を wire の正本、`packages/api-client-csharp` を独立した C# 生成 artifact / compile / conformance 境界とする。Go は `internal/gen/{presentation,delivery,realtime}/`、C# は `Unframe.{Presentation,Delivery,Realtime}` を使う。OpenAPI の namespace は `Unframe.ControlPlane` とする。
- Nix lock と exact generator version で再現生成し、source hash と generator version を provenance に記録する。output 全体と file set の drift を検査し、生成 directory を手編集しない。
- Unity は Proto と C# source のコピーを drift check する。standalone .NET assembly をそのまま持ち込まず、Unity-owned adapter に接続する。旧 `PresentationImport` の維持を要求しない。
- TypeScript は生成済み静的 codec と型を使い、descriptor を構造検査に使う。runtime の filesystem / `protoc` / 動的コード生成に依存しない。profile identity は [Runtime contract の規範 mapping](../packages/CONTRACT_RUNTIME.md#31-projection-profile) に従い、JSON number へ渡す `uint64` は安全整数範囲を検査する。
- Core は Delivery projection / admission と canonical snapshot の意味検証を所有する。Go の `internal/protocol/v2` は受信 wire、信頼済み fence / catalog、checkpoint bytes、replay cursor / State sequence を検査する。Flow / Cue の authoritative evaluation は Runtime Core が所有する。
- Unity-owned adapter は generated fence、projection、asset descriptor を保持する。未実装の Reliable payload を sequence だけ進めて成功扱いしない。生成物の conformance を、サービス稼働や Unity / Quest の実機検証の証拠にしない。

## Consequences

公開importとProtobufの完全修飾型名・RPC名は破壊的に変わる。旧名のaliasは残さず、consumerを再生成して参照を更新する。バージョン値とpayloadのbinary layoutは変えない。

Protobuf breaking baselineは正式名のdescriptorに更新する。更新時の旧baselineとの比較ではnamespace削除3件を検出した。以後は正式名を基準として互換性を検査し、field型変更・削除の負例でbreaking検査を確認する。旧名を互換aliasで維持する案は、並行契約の管理が残るため採用しない。

## Adoption and Exceptions

schema drift、breaking検査のnegative test、TypeScript / Go / C#のwire conformanceで生成物を確認する。unknown enum / 必須 variant / version の拒否、Delivery closure / budget、snapshot / checkpoint / fence の対象テストを維持する。wire の変更は正本、descriptor baseline、consumer、検証を同じ変更で更新する。

旧Realtime v1の一時的な例外は旧実行経路の撤去に伴い終了した。現行の通信契約は v2 だけとし、互換 fallback を追加しない。
