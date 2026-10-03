# ADR-0023: Delivery / Runtime v2 の生成 consumer 境界

## Status

Accepted

## Context

Delivery / Runtime の正本は [v2 Protobuf](../../packages/contracts/proto/unframe/) と [配信・実行契約](../packages/CONTRACT_RUNTIME.md) である。Unity は既に v2 message source を使用する一方、Go の生成対象は v1、`api-client-csharp` は placeholder だった。生成先とアプリケーションの責務を揃え、同じ wire を三言語で検証する必要がある。

## Decision

- `packages/contracts` を wire の正本、`packages/api-client-csharp` を独立した C# 生成 artifact / compile / conformance 境界とする。Go source は Realtime の `internal/gen/{presentation,delivery,realtime}/v2` に生成する。生成 directory を手編集しない。
- Nix lock の toolchain と generator の exact version を検査し、OpenAPI の C# client / model、Protobuf message / service artifact を生成する。source hash と generator version を provenance に記録し、生成 output 全体と file set の drift を検査する。
- Protobuf namespace は既存の `Unframe.{Presentation,Delivery,Realtime}.V2` を維持する。OpenAPI は `Unframe.ControlPlane` とする。Unity は既存の generated source 配置方式を使い、コピーした Proto source と C# message source も drift check の対象とする。standalone .NET assembly を Unity にそのまま持ち込まない。
- TypeScript は生成済み静的 codec と型を使い、descriptor を構造検査に使う。runtime の filesystem / `protoc` / 動的コード生成に依存しない。profile identity は [規範 mapping](../packages/CONTRACT_RUNTIME.md#31-projection-profile) を使い、標準 Protobuf JSON と区別する。JSON 数値へ渡す `uint64` は安全整数範囲を検査する。
- Core は Delivery projection / admission と canonical snapshot の意味検証を所有する。Go の `internal/protocol/v2` は generated message の受信検査、信頼済み fence / catalog との照合、checkpoint bytes、replay cursor / State sequence の境界を所有する。Flow / Cue の authoritative evaluation を wire mapper に入れない。
- Unity-owned adapter は generated fence、projection、asset descriptor を保持して利用する。既存 `PresentationImport` は別経路として維持する。実装していない Reliable payload を sequence だけ進めて成功扱いしない。

## Consequences

source contract の変更を Go / C# / TypeScript と Unity の生成物へ追跡できる。再現 generation、standalone compile、共通 binary fixture、breaking-change 検査を gate に加える費用がある。source 配置の採用により Unity と独立 C# package に message source のコピーが残るため、両方の drift check が必要になる。

Control Plane の publication persistence / 認証済み device capability 正規化、Realtime v2 service の authoritative evaluator / live replay / nonce lifecycle、Unity の network reconnect / renderer / 実機 residency は application-owned work とする。package の conformance や純粋 adapter の成功を、これらの稼働や Quest の GPU budget 計測の証拠にしない。

## Adoption and Exceptions

生成・drift、三言語の encode/decode fixture、unknown enum / 必須 variant / version の拒否、Delivery closure / budget、snapshot / checkpoint / fence の対象テストを維持する。Unity の純粋 adapter 検証と Editor / device 検証の結果を分けて記録する。wire の変更は正本、descriptor baseline、consumer、検証を同じ変更で更新し、互換 fallback を追加しない。
