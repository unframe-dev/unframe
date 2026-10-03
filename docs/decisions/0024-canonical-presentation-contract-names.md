# ADR-0024: Presentation契約を正式名に統一する

## Status

Accepted

## Context

Presentation契約は完全版と初期subsetが並存していた。現行packagesは完全版を使うため、名前のV2 suffixと旧subsetの公開は不要である。

## Decision

- 旧Presentation v1のportable schema・fixture・exportを廃止し、データ移行や互換adapterを設けない。
- TypeScript型、公開import、ファイルパス、生成コマンド、Protobuf packageとservice名をバージョンsuffixのない正式名に統一する。
- serialized `schemaVersion` / `contractVersion` の値 `2`、通信の `protocol_version: "v2"`、field番号とenum数値は維持する。
- 旧Realtime v1のprotoと生成コードは既存サーバーの依存として残し、旧実行経路の撤去と同時に廃止する。旧HTTP CRUD契約の更新も別途行う。

## Consequences

公開importとProtobufの完全修飾型名・RPC名は破壊的に変わる。旧名のaliasは残さず、consumerを再生成して参照を更新する。バージョン値とpayloadのbinary layoutは変えない。

Protobuf breaking baselineは正式名のdescriptorに更新する。更新時の旧baselineとの比較ではnamespace削除3件を検出した。以後は正式名を基準として互換性を検査し、field型変更・削除の負例でbreaking検査を確認する。旧名を互換aliasで維持する案は、並行契約の管理が残るため採用しない。

## Adoption and Exceptions

schema drift、breaking検査のnegative test、TypeScript / Go / C#のwire conformanceで生成物を確認する。旧Realtime v1は上記の既存実行経路に限る例外であり、新規consumerでは使用しない。
