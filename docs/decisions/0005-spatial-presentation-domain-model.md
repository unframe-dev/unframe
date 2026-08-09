# ADR-0005: 空間プレゼンテーションのドメインモデルを定義する

- **Status**: Accepted
- **Date**: 2026-08-09
- **Deciders**: Unframe 開発チーム
- **関連**: [ADR-0001（アーカイブ）](./archived/0001-backend-mvp-design.md), [ADR-0003（アーカイブ）](./archived/0003-full-renewal.md), [`ARCHITECTURE.md`](../../ARCHITECTURE.md)

## Context

Unframe では、従来のスライド送りに加えて、発表者の位置移動、身体動作、コントローラー入力を空間内の演出へ結び付けたい。単純なページ列だけでは、一つの空間を保ったまま段階的に要素を変化させる進行や、身体に追従する要素群を表現しにくい。

Unity には `stage`、`groups`、`steps`、`cues` などを持つローカル JSON importer の型と Element loader が存在する。旧 Go HTTP API、OpenAPI、DB、MR manifest は削除済みであり、同じ形式ではない。Trigger、Cue、Action、Transition、身体 Anchor の実行系も未実装である。このため、試作 JSON を契約として固定せず、まずアプリケーション間で共有するドメイン上の境界を定める必要がある。

## Decision

Unframe の目標ドメインモデルとして、空間的な発表単位とその内部進行を次のように分離する。

```text
Presentation
└─ Group
   ├─ initial state
   ├─ static elements
   ├─ anchored element groups
   └─ Step
      └─ Cue
         ├─ Trigger
         └─ Actions
            └─ Transition (optional)
```

### 発表単位と進行

- `Group` は従来のページに近い空間的な発表単位とする。同じ Group 内で複数回の進行と演出を行える。
- Group の有効化時に Element の初期状態を適用し、最初の `Step` を有効にする。
- `Step` は Trigger の有効範囲を制限する。Runtime は現在の Step に属する Cue だけを監視し、意図しない入力による誤進行を抑える。
- `Cue` は一回の論理的な進行を表し、一つの Trigger と複数の Action をまとめる。
- `Action` は何を変更するかを表し、時間補間が必要な場合だけ `Transition` が変化方法を表す。

### 配置と入力

- 空間に固定する Element は Presentation Origin からの相対配置として扱う。
- 身体やコントローラーへ追従する複数の Element は、Anchor とローカル Transform を持つまとまりとして扱う。
- Trigger は位置、相対モーション、論理ボタン入力などの意味を表し、特定デバイスの物理入力名から分離する。デバイス固有の入力変換と Trigger 判定は Unity Runtime が担う。

### 永続定義と Runtime State

Web が編集して保存する Presentation Definition には、次を含める。

- スキーマバージョンと Presentation のメタデータ
- Stage、座標規約、Zone などの空間定義
- Asset 参照
- Group、Element、初期状態、Step、Cue、Trigger、Action、Transition

次の値は保存定義へ含めず、Unity または将来の同期機構が Runtime State として管理する。

- 現在の HMD、身体、コントローラーの姿勢と入力状態
- 現在の Group、Step、再生位置、Transition の進捗
- 現在接続している参加者など、実行中に変化する状態

### Element と Asset

- Element は識別子、種別固有の Content、初期状態、Transform を持つ判別可能な型として扱う。
- ファイル実体を必要とする Element はパスや URL を直接所有せず、Asset ID で参照する。配信時の URL 解決は backend または importer の境界で行う。
- 進行ロジックを Element に埋め込まず、Cue の Action が対象 Element の状態を変更する。
- 目標とする Element 種別は `text`、`image`、`video`、`model`、`audio`、`shape` とする。ただし、各アプリケーションが対応済みの種別は契約と実装で個別に確認する。
- Positionはmeter単位、Scaleは無次元倍率の3要素配列、Rotationは正規化した`[x, y, z, w]` Quaternionとする。座標系はright-handed、Y-up、forward -Zで統一する。

### 現行契約との関係

Control Plane OpenAPIはこのADRを採用し、Presentation Resourceの`definition`へGroup / Step / Cueを含むaggregateを保存する。Group、Step、Cue、ElementはDefinition内で安定したIDを持ち、Definition全体をrevision条件付きで原子的に更新する。旧SlideベースのAPI、DB、manifest契約は使用しない。

外部契約artifactは生成済みControl Plane OpenAPIとし、手書きJSON文書を別の契約一次資料にはしない。生成元はControl Planeの共有Zod schemaとOpenAPI document builderである。Web EditorとUnityはまだtarget contractへ接続していないため、consumer移行時に生成型またはadapterと互換性テストを追加する。

## Alternatives Considered

### Option A: Slide または Page の列だけで進行を表す

却下した。一つの空間を維持した段階進行を複数ページへ分割すると、空間配置の重複と状態引き継ぎが増え、身体動作による一回の演出を自然に表現できない。

### Option B: すべての Trigger を常時有効にする

却下した。身体動作や位置移動は日常的な動きでも成立し得るため、現在の進行段階と無関係な Trigger まで監視すると誤発火しやすい。Step を明示的な有効範囲として使う。

### Option C: Element 自身に Trigger と演出処理を持たせる

却下した。一回の入力で複数 Element を同時に変更しにくくなり、表示内容、進行条件、演出の責務が結合する。Cue、Action、Transition を Element から分離する。

### Option D: Unity 用 JSON を component contract とは独立した共通契約にする

却下した。Web、backend、Unity の型が別々に進化して drift する。外部契約へ昇格させる場合は、対応する Control Plane または Realtime component の契約生成経路へ統合する。

## Consequences

- **Positive**: 表示内容、空間配置、入力判定、進行、状態変化の責務が分かれ、Web の編集モデルと Unity の実行モデルを対応付けやすくなる。
- **Positive**: Step により、モーションや位置 Trigger の監視範囲を明示できる。
- **Positive**: 永続定義と Runtime State を分けることで、同じ Presentation Definition を再現可能な入力として扱える。
- **Negative**: Web EditorのSlideモデルとUnityの手書きimporterを、Groupベースの生成契約へ移行する作業が残る。
- **Negative**: Trigger の競合、Group のライフサイクル、Anchor 消失、Transition の完了条件など、状態機械の詳細設計が必要になる。
- **Neutral**: Unity の既存 importer と Element loader は検証材料として利用できるが、現行 API の consumer や完成した Runtime とはみなさない。

## Follow-ups

- [x] Control Planeの保存APIはGroupベースのDefinition aggregateとし、旧Slide APIを引き継がない。
- [x] IDのスコープ、参照整合性、Asset参照位置をControl Plane schemaで定義する。
- [x] 座標系はmeter、right-handed、Y-up、forward -Z、Rotationは正規化QuaternionとしてControl Plane schemaへ固定する。
- [ ] `active`と`visible`のUnity runtime上の適用差を実装する。
- [ ] Group Trigger の監視範囲、Group の切り替えと再入場時の初期化規則を決定する。
- [ ] 同一 Step で複数 Cue が成立した場合の優先度、排他、再発火、debounce を決定する。
- [ ] Step 遷移の表現と、Action / Transition の完了に対する遷移タイミングを決定する。
- [ ] Dynamic Anchor の追従方法と、追跡対象を失った場合の挙動を決定する。
- [ ] Element 種別ごとの Content と Action を component contract で定義し、consumer を同期する。
