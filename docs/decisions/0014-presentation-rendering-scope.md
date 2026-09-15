# ADR-0014: Presentation の描画方式を限定する

- **Status**: Accepted
- **Date**: 2026-09-15
- **Deciders**: Unframe 開発チーム
- **Related**: [ADR-0006](./0006-presentation-rendering-strategy.md), [Presentation Architecture](../presentation/ARCHITECTURE.md), [描画方式の検証条件](../presentation/UI_RENDERING_COMPARISON.md), [ADR-0012](./0012-texture-budget-residency-contract.md)

## Decision Drivers

- Unity Runtime で任意の HTML、CSS、JavaScript を実行せず、配信物と実行時状態を検証可能にする。
- Web の表現力は build 時の決定論的な描画に利用する。
- 空間表現、静的 UI、限定的な動的 UI、事前確定した連続映像を、それぞれ適した実行責務へ分ける。
- Quest 実機での frame、memory、thermal、fidelity を方式ごとに測定し、配信可能な範囲を段階的に確定する。

## Context

Presentation Architecture は `baked-web`、`native-ui`、`video` を Surface renderer として記載し、任意コードを含む Opaque renderer source は隔離した Browser で build artifact へ変換する境界を持つ。一方、過去の比較文書には Unity 上の WebView で任意の HTML / JavaScript を実行する `embedded-web` も将来候補として残っていた。

実行時 WebView を許すと、Web runtime、Texture 転送、sandbox、subresource integrity、lifecycle、時刻と入力の bridge を新たな Runtime contract として管理する必要がある。本プロジェクトの対象用途を、これらを必要としない描画方式の組み合わせに限定する。

## Options Considered

- build 時の Web 描画と、Unity native の 3D / UI / Video を組み合わせる。
- Unity Runtime に `embedded-web` を追加し、任意の HTML / CSS / JavaScript を実行する。
- Surface UI をすべて Unity Native UI で再実装する。

## Decision

Presentation の描画方式を次に限定する。

| 対象                                 | 方式                                     |
| ------------------------------------ | ---------------------------------------- |
| 3D Model、空間配置、移動、回転、拡縮 | Unity Native 3D                          |
| 静的 UI、少数の有限 Surface State    | `baked-web`                              |
| Timer、Counter、短い動的 Text        | versioned portable subset の `native-ui` |
| 入力非依存で事前確定できる連続映像   | `video`                                  |

`baked-web` は固定した build-time Browser で TS / React / CSS を描画し、Texture artifact を生成する方式である。Opaque renderer の任意コード実行もこの隔離した build 境界に限定し、Unity Runtime、Control Plane、Realtime へ source や Browser runtime を配信しない。

`native-ui` は Timer、Counter、短い動的 Text に必要な portable plan と binding の allowlist に限定する。任意 CSS、任意 layout engine、任意 script、汎用 Web API は含めない。

`video` は映像内容を事前生成できる場合に使用する。開始・停止と再生時刻は Presentation の進行に従う。codec、alpha、audio、seek、loop、device capability は Delivery contract で検証する。

独立した音声、BGM、効果音、空間音声はプロジェクトの対象外とする。音声を使用できるのは Video artifact に含まれる audio track だけであり、Video と同じ再生状態と時刻に従う。独立音声用の Asset kind、Spatial Node、Action、capability、予約 field、adapter boundary は作らない。

`embedded-web`、WebView、および Unity Runtime で任意の HTML / CSS / JavaScript / WebAssembly を実行する方式はプロジェクトの対象外とする。`embedded-web` 用の artifact kind、capability、fallback、予約 field、adapter boundary を作らない。導入するには本 ADR を置き換える新しい ADR と、Runtime・Delivery・security・運用上の根拠が必要になる。

この決定は方式の責務と適用範囲を確定する。各方式の実装完了、Quest 実機性能、Delivery 対応を確定するものではない。特に ADR-0012 の v1 Delivery baseline は `baked-web` の Texture artifact だけを対象とし、`native-ui` と `video` は各方式固有の budget tier と consumer 実装が受理されるまで Delivery で拒否する。

## Consequences

- **Positive**: Runtime が実行する artifact と portable plan を閉じた union として検証できる。
- **Positive**: Web の layout と typography を build 時に利用しながら、Unity Runtime の Web runtime 依存を排除できる。
- **Positive**: Surface の空間 animation は Unity、意味状態は PresentationDefinition、描画は RenderBundle という既存境界を維持できる。
- **Negative**: 任意の実行時 Web UI、DOM animation、Web API、WebAssembly を Presentation Surface として利用できない。
- **Negative**: 動的 UI は portable subset の範囲に合わせ、範囲外の表現は有限 State、Video、Unity の空間演出へ分解する必要がある。
- **Follow-up**: `native-ui` と `video` の contract と budget を定義し、Unity consumer の実装・実機検証を経て配信可能条件を確定する。

## Adoption and Exceptions

- Surface の具体的な renderer kind は `baked-web`、`native-ui`、`video` だけを許可する。PresentationDefinition の `rendererPreference: "auto"` は Compiler に選択を委ねる指定として維持する。
- `embedded-web`、WebView、汎用 Web runtime を示す schema field、package、Unity adapter をレビューで受け入れない。
- 独立音声を示す Asset、Spatial Node、Action、capability、adapter をレビューで受け入れない。Video の audio feature は実際に audio track を含む Video artifact だけに使用する。
- build-time Browser の入力、capability、再現性、resource budget は Local Compiler の trust boundary として検証する。
- Quest 実機検証では採用済み方式の性能と適用条件を測定し、方式の追加候補を比較しない。
- 描画方式を追加する場合は新しい ADR で本決定を置き換える。
