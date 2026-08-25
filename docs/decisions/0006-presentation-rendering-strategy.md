# ADR-0006: プレゼンテーションアーキテクチャを定義する

- **Status**: Accepted
- **Date**: 2026-08-25
- **Deciders**: Unframe 開発チーム
- **関連**: [Presentation Architecture](../presentation-architecture.md), [ADR-0005: 空間プレゼンテーションのドメインモデルを定義する](./0005-spatial-presentation-domain-model.md), [Repository Architecture](../../ARCHITECTURE.md), [Server Architecture](../../app/server/ARCHITECTURE.md)

## Context

Unframe のプレゼンテーションは、コードと GUI による authoring、再利用可能な Component、2D UI と 3D 空間の合成、build、Asset 配信、Unity Runtime、Realtime の進行管理にまたがる。

これらを一つの JSON、TSX、DOM、Unity object graph にまとめると、編集用の抽象、永続化する意味、生成済み artifact、配信情報、実行中状態が混在する。特に、次の要求を同じ形式だけで満たすことは難しい。

- Code では Component と TSX に近い記述を利用する。
- GUI では Layout、配置、State、Flow を意味単位で編集する。
- 最終的な Presentation は検証可能で portable な契約として保存する。
- Web の表現力を利用しながら、Unity では任意の HTML、CSS、JavaScript を実行しない。
- Realtime Session では複数 client が同じ進行状態へ収束する。

ADR-0005 は Group、Step、Cue、Trigger、Action を中心とした空間プレゼンテーションのドメイン境界を定義した。本 ADR ではそれを拡張し、authoring から Runtime までを接続する Presentation 全体の目標アーキテクチャを決定する。

詳細な型、Scene Graph、Surface、Layout、State Machine、Timeline、RenderBundle、DeliveryManifest の仕様は [Presentation Architecture](../presentation-architecture.md) を正本とする。本 ADR は、そのアーキテクチャを採用する理由と主要な境界だけを記録する。

## Decision

[Presentation Architecture](../presentation-architecture.md) に記載する目標アーキテクチャを、Unframe の Presentation 設計の正本として採用する。

### 設計成熟度

この ADR が受理するのは上位アーキテクチャであり、すべての下位 contract を同時に固定するものではない。

| 対象 | 状態 |
| --- | --- |
| Architecture baseline | Accepted |
| Presentation Progression の意味モデル | v1 baseline |
| Progression wire / runtime schema | Draft |
| Authoring、Rendering、Delivery の下位 contract | Follow-up |

### 基本原則

- Presentation の意味、authoring source、build 成果物、delivery projection、Runtime State を分離する。
- TSX、JSON、Protobuf は用途ごとの表現形式であり、単独で意味モデル全体の正本にはしない。
- PresentationDefinition を renderer-independent な Presentation の意味モデルとする。
- GUI と Code は同じ Semantic Authoring IR を編集する。
- すべての参照可能な構成要素に安定 ID を割り当て、配列位置や描画順を識別子として使用しない。
- Component の公開契約と renderer implementation を分離する。
- Scene Graph、Presentation Progression、Renderer を独立した関心として扱う。
- Control Plane、Venue Edge、Unity Runtime は authoring code を実行しない。
- 現行実装と目標アーキテクチャを区別し、未実装の設計を既存機能として扱わない。

### 契約の階層

Presentation を次の契約へ分離する。

| 契約 | 責務 |
| --- | --- |
| Authoring Source | Presentation の composition、Component、Theme、Asset 選択を人が記述する |
| Semantic Authoring IR | GUI と Code が共同編集する正規化モデルと authoring metadata を保持する |
| PresentationDefinition | Scene、Surface、State、Interaction、進行など Presentation の意味を保持する |
| RenderBundle | Local Compiler が生成した Texture、Video、Native UI plan、Semantic Tree などを保持する |
| DeliveryManifest | target capability、認可、Asset binding、Signed URL を解決した Runtime projection を保持する |
| Release | 整合する PresentationDefinition、RenderBundle、Asset Set、contract version を immutable な publish 単位として束ねる |
| Runtime State | Session 中の現在 Group、Step、Node、Surface State、Timeline、playback、presence を保持する |

Authoring Source と Semantic Authoring IR は編集のための情報を保持する。PresentationDefinition は実行可能な意味を保持する。RenderBundle と DeliveryManifest は再生成可能な派生物とし、Release はそれらの整合する組み合わせを immutable に固定する。Runtime State は実行中にだけ存在し、PresentationDefinition へ書き戻さない。

### Authoring と Component

コードによる Presentation は、Component の配置と接続を行う composition root として記述する。Component 内部の Frame、Text、装飾を Presentation 全体へ展開して記述することを標準にはしない。

Component package は Props、Slots、Parts、Variants、States、Actions、Outputs、Theme requirements、対応 renderer、Editor metadata、version を公開契約として持つ。GUI は renderer implementation を解析せず、この公開契約から編集可能範囲を構築する。

Structured Component は renderer implementation とは別に、GUI が理解できる宣言的な内部構造を Authoring Source / IR に持つ。Component Action は canonical Action batch、Component Output は canonical semantic event へ compile-time に lower し、Component 固有の実行命令を Runtime contract へ残さない。

Presentation Orchestrator と Structured Component は静的解析可能な制限付き DSL とする。任意コードを許す Opaque renderer は Local Compiler の sandbox 内だけで実行し、renderer artifact へ変換する。Opaque Component の意味情報は renderer の実行結果ではなく、Component Manifest から取得する。

GUI と Code の双方向変換は、任意のソース文字列を完全に再現することではなく、正規化後の意味論的同値性を保証する。自由な実装が必要な Component と GUI が内部構造まで編集できる Component は区別する。

Component の抽象を超えた編集は Authoring 上で Detach し、Delivery artifact や Texture から編集可能な Component source を復元しない。

### Scene、Surface、Layout

Scene Graph は、空間配置を表す Spatial Tree と、Surface 内の 2D UI を表す Surface Tree から構成する。

Group は物語上の進行スコープであり、Scene Graph の親子関係とは分離する。Spatial Tree は Stage、Anchor、Container、Model、Audio、Surface などの空間関係を保持する。Surface は 3D 空間と 2D UI を接続し、物理 size と logical size を持つ。

Surface 内部の Layout は absolute、stack、grid から始め、最終座標だけでなく配置意図を Authoring IR に保持する。Theme は型付き Token と Named Style を持ち、Layout、親子関係、Spatial Transform、Flow を変更しない。

Component は再利用と編集の境界、Surface は描画、状態、animation、interaction、Runtime resource の境界とする。一つの Component が複数 Surface や Native Node へ展開されることを許す。

Surface は、Spatial Tree 上で Transform を所有する Surface Node、PresentationDefinition 上の安定した Semantic Surface、RenderBundle 内部の派生的な Render Surface に分ける。Progression は Semantic Surface ID を参照し、Compiler の partition 結果を直接参照しない。

### Rendering

Semantic Scene Graph を優先し、renderer を Local Compiler と Delivery の出力戦略とする。

3D Model、Shape、Spatial Audio、Transform、Anchor tracking は Unity native で描画する。静的 UI と少数の有限状態 UI は Web で描画して Surface 単位に Texture 化する。継続的に変化する限定 UI は portable な Native UI とし、入力非依存の複雑な連続演出は Video とする。

Semantic Surface は具体 renderer ではなく Render Intent を持つ。Concrete renderer と解像度は build 結果と target capability に基づいて RenderBundle と DeliveryManifest で確定する。

Surface State は意味論的な状態として保持し、Texture ID や Unity object を参照しない。Renderer artifact は RenderBundle が Surface State に対応付ける。

Embedded Browser は v1 の標準 renderer に含めない。Control Plane と Unity Runtime は TSX、React、HTML、CSS、authoring JavaScript を実行しない。

### Presentation Progression

Group を State Machine のスコープ、Step を進行状態、Cue を Trigger で発火する遷移候補として扱う。

State Machine は離散的な進行と Surface State を管理し、Timeline は連続値の時間変化を管理する。Action は renderer-independent な意味論的対象を変更し、Texture や Unity API を直接操作しない。

Venue Edge を canonical authority とし、Trigger、Guard、Cue 選択、Action、Timeline 完了、Group / Step 遷移を一意に評価する。Unity は device input を Logical Event へ変換し、確定した Runtime State と Timeline を描画へ反映する。

Reliable Event、State Stream、Snapshot、Replay を分離し、再接続した client が同じ Presentation 進行と Surface State へ収束できるようにする。

Runtime State は、Venue Edge が管理する Shared Runtime State、role / capability に応じた Projection State、各 client だけが保持する Client-local State に分離する。Client-local State は Shared Progression を直接変更しない。

Room / Session は一つの immutable Release を pin する。Release は対応する PresentationDefinition、RenderBundle、Asset Set、contract version を束ね、DeliveryManifest と Snapshot は同じ Release を参照する。

v1 の具体的な選択規則、Group lifecycle、Surface State、Timeline、Snapshot は [Presentation Progression の意味論](../presentation-architecture.md#12-v1-presentation-progression-の意味論) に従う。

### Component ごとの責務

- **Local Compiler**: Authoring Source を解析し、Component、Layout、Theme、Surface boundary、renderer artifact を解決する。
- **Control Plane**: PresentationDefinition、RenderBundle、Asset の schema、ownership、hash、revision を検証し、DeliveryManifest を生成する。
- **Venue Edge**: Session の進行、順序、Trigger、Guard、Action、Timeline、Reliable Event、Snapshot を管理する。
- **Unity Runtime**: DeliveryManifest を検証し、renderer graph、Asset lifecycle、Spatial rendering、local interpolation、input adapter を担当する。
- **Web Editor**: Semantic Authoring IR を semantic command で編集し、保存 revision や Runtime authority と分離した UI state を管理する。

## Alternatives Considered

### Option A: 最終 JSON を Authoring の唯一の正本にする

Runtime には単純だが、Component、Layout intent、Theme、Source mapping、GUI と Code の往復に必要な情報を失う。編集抽象と実行契約を混在させるため採用しない。

### Option B: TSX または React tree を PresentationDefinition として保存する

Web authoring には自然だが、任意コードの実行、安全性、決定性、Unity portability、GUI reverse conversion の境界が成立しないため採用しない。

### Option C: Web、Server、Unity がそれぞれ独自の Presentation model を持つ

各 application は局所的に実装しやすいが、意味、ID、State、Action、Asset の contract drift が発生するため採用しない。共有するのは実装ではなく、明示的な契約と生成 artifact とする。

### Option D: Component、Surface、Scene Node を一つの概念に統合する

再利用、編集、描画、空間 Transform、Runtime resource の lifecycle が結合し、Component の一部だけを別 renderer や別 Surface にすることが難しくなるため採用しない。

### Option E: 各 client が Presentation Progression を個別評価する

Tracking、input、clock、renderer の差によって Cue と State が分岐する。Snapshot と Replay だけでは決定結果を一致させられないため、Venue Edge を authority とする。

## Consequences

- **Positive**: Code、GUI、build、delivery、runtime を同じ意味モデルの周囲へ整理できる。
- **Positive**: Component の再利用性と Web の表現力を保ちながら、Unity で任意の authoring code を実行せずに済む。
- **Positive**: PresentationDefinition を保ったまま renderer、解像度、配信方法を変更できる。
- **Positive**: Stable ID と Semantic Authoring IR により、GUI と Code の意味論的な往復と semantic command を設計できる。
- **Positive**: Venue Edge の single authority と Snapshot / Replay により、複数 client の進行状態を収束させられる。
- **Negative**: Authoring Source、IR、PresentationDefinition、RenderBundle、DeliveryManifest の対応と versioning を管理する必要がある。
- **Negative**: Compiler、Component package、Surface partition、Native UI、Delivery、Realtime の複数契約を実装する必要がある。
- **Negative**: 自由な TSX と完全な GUI 内部編集を同時には保証できず、Structured / Opaque / Detach の境界が必要になる。
- **Negative**: Baked Surface は内容や locale の変更で再 build が必要になり、Texture memory と Asset lifecycle の管理も必要になる。
- **Neutral**: 詳細な schema、transport、build budget、capability negotiation は下位仕様として段階的に決定する。

## Implementation Status

この ADR は目標アーキテクチャを採用するものであり、すべてが現行コードへ実装済みであることを意味しない。

2026-08-25 時点では、現行 PresentationDefinition は ADR-0005 の Group、Step、Cue、Element を中心とした JSON / OpenAPI 契約である。Semantic Authoring IR、Component package、Spatial Tree / Surface Tree、RenderBundle、DeliveryManifest、hybrid renderer、v1 Presentation Progression の wire / runtime schema は target design であり、完成した production contract ではない。

この ADR だけで既存 schema を置き換えたとはみなさない。実装時は契約変更、migration、OpenAPI / Protobuf artifact、Web / Unity / Realtime consumer、contract test を同期する。

## Follow-ups

- [ ] Component Action / Output の canonical Action / semantic event への lowering contract を定義する。
- [ ] Structured Component の宣言的な内部構造と renderer implementation の source boundary を定義する。
- [ ] TSX-like DSL の制約、parse、Opaque renderer sandbox、semantic round-trip、source mapping、Detach を設計する。
- [ ] Surface Node、Semantic Surface、Render Surface と Group resource scope の canonical schema を定義する。
- [ ] Presenter / System / participant の actor selector、Anchor owner、Shared / Projection / Client-local State を定義する。
- [ ] Step entry、Timer、Cue consumption、Surface transition、Timeline、Media を復元できる Runtime Run / Snapshot contract を定義する。
- [ ] Immutable Release と PresentationDefinition、RenderBundle、Asset Set、Room / Session の pinning を定義する。
- [ ] Surface transition、Action batch、Timeline track の conflict policy と Timeline 補間規則を定義する。
- [ ] Surface State ごとの Semantic Tree と Native UI の宣言的 binding を定義する。
- [ ] Component から Render Surface への partition 規則、自動化範囲、author override を決定する。
- [ ] ADR-0005 で固定済みの座標系を前提に、Transform 合成、Quaternion 乗算、matrix layout、Unity 変換、Surface / UV 変換の完全な規約を定義する。
- [ ] SurfaceRenderIntent、Surface State、RenderBundle、DeliveryManifest の schema と versioning を定義する。
- [ ] Texture build budget、resolution、mipmap、compression、preload、eviction policy を定義する。
- [ ] Native UI portable subset、Semantic Tree、Hit Region の完全な schema を定義する。
- [ ] Deterministic Local Compiler と Component / renderer drift 検証を設計する。
- [ ] Presentation revision、RenderBundle revision、Asset lifecycle を原子的に対応付ける。
- [ ] DeliveryManifest Protobuf schema と capability negotiation を定義する。
- [ ] v1 Presentation Progression の意味論を Progression wire / Runtime contract、Realtime protocol、Snapshot、consumer へ落とし込む。
- [ ] Draft、Release、Room、active session の反映規則を決定する。
- [ ] Web、Compiler、Unity、Realtime の contract test と visual regression test を設計する。
