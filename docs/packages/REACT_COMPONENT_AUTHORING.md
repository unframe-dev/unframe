# React Component Authoring 設計案と実装計画

- **Status**: Proposed / A0 型試作検証済み、canonical Surface 拡張を採用。A1 実装中
- **Date**: 2026-09-27
- **Decision**: [ADR-0019](../decisions/0019-single-file-react-component-authoring.md)
- **Implementation contract**: [Lock・抽出・編集・capture](./REACT_COMPONENT_EXECUTION_CONTRACT.md)
- **Scope**: 一ファイルの React Component → 一 import 配置 → 静的 baked-web → Editor 編集・保存 → 有限 State

本書は作者向け API と実装の受け入れ条件を示す設計案である。三例の型推論を隔離した宣言型の試作で検証し、未決だった実装方式を関連 contract に記録した。現行 SDK は静的 Hero の定義・配置の入力検証までを提供する。以下の三例を Compiler で check / build する経路と有限 State の React API は未実装であり、React を標準経路として採用するかは縦断検証後に判断する。

A1 着手前の再確認で、現行 Core がすべての Semantic Node と Content Node の一対一対応を要求することが判明した。React の内部描画構造を保存しない本提案には、そのまま適用できない。Surface の Structured / Opaque 表現と Renderer の binding 検証を分ける追加設計を [ADR-0020](../decisions/0020-structured-and-opaque-surface-content.md) と [実装 contract](./REACT_COMPONENT_EXECUTION_CONTRACT.md#a1-の前提契約canonical-surface) で確定した。

## 1. 目標と現在地

Component 作者は公開契約と見た目を一ファイルで定義し、Presentation 作者は Component を一つ import して Props、3D 配置、Flow を記述する。Manifest、renderer entry、内部 Runtime ID、lock を配置のたびに手で結ばない。CSS・画像・描画 helper を別ファイルへ分けることは許す。

現行は Structured の Props / Theme / composition、有限 State、Interaction、Action / Output / Cue、host Timeline を実装している。Opaque は [Compiler pairing](../../packages/unframe-compiler/src/project/pair-authoring-declarations.ts) と [Renderer support](../../packages/unframe-renderer-api/src/capabilities/evaluate-first-milestone.ts) で拒否され、[Opaque bundler](../../packages/unframe-renderer-web/src/opaque/bundle-opaque-renderer.ts) は execution / capture に未接続である。[Web Editor](../../app/web/src/features/editor/infra/document-runtime.ts) は fixture と browser persistence を使用している。本計画は既存機能を再実装せず、それらへ新しい入力経路を接続する。

## 2. 作者向け API の三例

### 2.1 静的な Hero

```tsx
// Hero.component.tsx
import { defineComponent, editableText, prop } from "@unframe/unframe-authoring";
import "./components.css";

export const Hero = defineComponent({
  id: "hero",
  version: 1,
  props: { title: editableText({ required: true }) },
  surface: { logicalSize: [960, 540] },
  semantics: {
    rootNodeIds: ["title"],
    nodes: {
      title: {
        role: "heading",
        level: 1,
        parentId: null,
        order: 0,
        text: prop("title"),
      },
    },
  },
  render: ({ texts, bindings }) => (
    <section className="hero">
      <h1 {...bindings.title}>{texts.title}</h1>
    </section>
  ),
});
```

`editableText` は既存 string Prop と Editor 用 metadata へ展開する。`prop("title")` の型は同じ Component の Prop 定義から検査し、expected type や別の Props interface を作者に重複記述させない。必須 / default の規則と省略時 warning は既存の [Authoring Contract](./AUTHORING_CONTRACT.md) を維持する。number / boolean の公開 Prop も同じ推論対象とする。

`render` は同期関数で、入力は読み取り専用の `props`、State ごとの解決済み `texts`、`bindings`、`state` である。`props` は default 適用後なので全 field が具体値を持つ。例では `texts.title` が `props.title` を唯一の値の出所とし、作者が本文を二重定義しない。`bindings` は DOM へ付与する SDK 所有属性であり、callback や MR のイベント handler を含まない。UI ライブラリを使う場合も、最終 DOM へ属性を転送する必要がある。

`components.css` と使用 font bytes は明示入力に含める。試験 fixture は固定 font、固定サイズの section、heading と button の style を持つ。OS font に fallback しない。CSS import は静的契約抽出時に実行せず、描画依存として収集する。

### 2.2 有限 State と公開操作を持つ Reveal

```tsx
// Reveal.component.tsx
import { defineComponent, editableText, prop, setState } from "@unframe/unframe-authoring";
import "./components.css";

export const Reveal = defineComponent({
  id: "reveal",
  version: 1,
  props: {
    prompt: editableText({ required: true }),
    answer: editableText({ required: true }),
  },
  surface: { logicalSize: [960, 540] },
  semantics: {
    rootNodeIds: ["prompt", "answer", "revealButton"],
    nodes: {
      prompt: {
        role: "heading",
        level: 1,
        parentId: null,
        order: 0,
        text: prop("prompt"),
      },
      answer: {
        role: "paragraph",
        parentId: null,
        order: 1,
        text: prop("answer"),
      },
      revealButton: {
        role: "button",
        parentId: null,
        order: 2,
        text: "答えを表示",
        interactionId: "reveal",
      },
    },
  },
  interactions: {
    reveal: { kind: "click", event: "quiz.reveal", hitPriority: 0 },
  },
  initialState: "hidden",
  states: {
    hidden: {
      semanticOverrides: [{ id: "hide-answer", targetId: "answer", included: false }],
      enabledInteractionIds: ["reveal"],
    },
    revealed: { semanticOverrides: [], enabledInteractionIds: [] },
  },
  actions: {
    reveal: { inputs: {}, preconditions: [], effects: [setState("revealed")] },
  },
  outputs: {
    revealRequested: {
      payload: {},
      producer: { kind: "surfaceInteraction", interactionId: "reveal" },
    },
  },
  render: ({ texts, bindings, state }) => (
    <section className="reveal">
      <h1 {...bindings.prompt}>{texts.prompt}</h1>
      {state === "revealed" && <p {...bindings.answer}>{texts.answer}</p>}
      <button {...bindings.revealButton} disabled={state !== "hidden"}>
        {texts.revealButton}
      </button>
    </section>
  ),
});
```

State ごとに同じ base Semantic Tree へ既存規則の override を適用する。`setState` はこの単一 Surface の canonical `setSurfaceState` effect へ lower する提案 helper であり、新しい Runtime action ではない。宣言 record の key から State / Interaction / Action / Output の local ID と既存の kind を補う。

全宣言 State を build 時に描画する。JSX topology は State 間で変わってよいが、基底 Semantic Node の ID・role・親子関係は変えない。非表示の answer は完成 Semantic Tree と描画 binding の両方から除く。`texts` は membership 除外前の全基底 text key と解決済み string を保持するが、除外中 Node の binding の出現は拒否する。非活性の button は意味と描画に残せるが、有効な Hit Region を生成しない。

button に `onClick` は付けない。Runtime の Interaction → 公開 Output → Presentation Cue → 公開 Action が State を変更し、完成画像を切り替える。React の hooks やイベントは MR の状態を所有しない。

### 2.3 同じ Hero を二箇所へ配置し、Reveal を Flow から操作する

```ts
// presentation.unframe.ts
import { definePresentation } from "@unframe/unframe-authoring";
import { Hero } from "./Hero.component";
import { Reveal } from "./Reveal.component";

const sharedTitle = "Welcome";
const placement = {
  owner: { kind: "presentation" },
  audience: { kind: "all" },
  parent: { kind: "stage" },
  physicalSizeMeters: [1.6, 0.9],
  fit: "contain",
} as const;

export default definePresentation({
  id: "example",
  metadata: { title: "Component authoring" },
  stage: {
    coordinateSystem: {
      unit: "meter",
      handedness: "right",
      upAxis: "+Y",
      forwardAxis: "-Z",
    },
    size: [6, 3, 6],
  },
  scene: [
    {
      ...placement,
      id: "opening-hero",
      component: Hero,
      props: { title: sharedTitle },
      transform: { position: [-1, 1.5, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
    {
      ...placement,
      id: "closing-hero",
      component: Hero,
      props: { title: sharedTitle },
      transform: { position: [1, 1.5, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
    {
      ...placement,
      id: "quiz",
      component: Reveal,
      props: { prompt: "2 + 2 は？", answer: "4" },
      transform: { position: [0, 0.5, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
  ],
  assets: [],
  flow: {
    initialGroupId: "main",
    variables: {},
    groups: {
      main: {
        id: "main",
        initialStepId: "question",
        steps: {
          question: {
            id: "question",
            cues: [
              {
                id: "show-answer",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "quiz",
                  outputId: "revealRequested",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "quiz",
                    actionId: "reveal",
                    arguments: {},
                  },
                ],
                next: { kind: "stay" },
              },
            ],
          },
        },
      },
    },
  },
  operations: [],
});
```

配置対象ごとの Props 型を推論し、異なる Component が同じ scene 配列にあっても必須値・余分な key・型不一致を拒否する。Flow の Instance / Action / Output 参照は既存の Compiler 検証を通す。作者が接続するのは公開 ID だけであり、内部 Surface ID や package lock は使わない。通常の React の子は scene Instance とは別の型で、独立した配置・owner・Flow target を持たない。

初期の静的検証では Hero 二件だけを配置し、cues を空にする。有限 State の工程で上記の Reveal と Cue を加える。上記例の共有値を含む GUI 編集は、後述の局所 override 対応後に検証する。

## 3. 静的抽出と描画の境界

```text
Component source snapshot
  ├─ 静的公開契約 ──→ Manifest / 検証済み Props / Semantic Tree
  └─ render AST + 描画依存 ──→ virtual renderer entry / locked bundle
                                      ↓
Presentation ──→ Instance / host Spatial / Surface ──→ isolated Browser
                                      ↓                    ↓
                         canonical Definition        capture / bindings
                                      └────→ RenderBundle / Assets / BuildManifest
```

- 最初は `*.component.tsx` 一ファイルに一つの named export `defineComponent` を認める。Presentation からの import は静的な Component 参照に解決し、関数 object を plain-data Declaration Graph に格納しない。
- 静的 field は ADR-0018 の const / import / spread / literal と許可 builder の規則を使う。関数実行、描画値への依存、循環、計算された公開 ID を拒否する。
- 元 module を import / evaluate して `render` を取得しない。render 関数と参照する描画 helper / import を別 virtual module へ抽出し、公開契約の initializer は含めない。静的な共有値は検証済みの値として渡す。Component 自身や Presentation、契約 builder の実行時参照は拒否する。
- 描画 helper と依存 package の初期化は Browser の隔離領域だけで実行する。関数・条件分岐・map は描画内部で利用できる。静的側からそれらの値を読めない。未分類の実行可能な top-level statement は拒否する。
- React 用 JSX 型環境と Structured SDK 用 JSX 型環境を明示的に分ける。型検査と抽出後の guard の両方で公開契約を検証する。

意味の抽出と binding の検証は別である。対象 subset の heading / paragraph / button は、State ごとの完成 Tree に含まれる Node につき binding を一件要求する。未宣言・重複・除外済み binding、描画要素の欠落、対象外への Hit Region を拒否する。geometry は宣言済み binding の DOM から測定する。任意 CSS や React が作る実際の文字・可視性と意味の完全一致は保証せず、標準 Text binding の契約試験と visual fixture で確認する。

## 4. 生成規則、依存と成果物

| 作者が指定する値                              | ツールが生成・検証する値                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Component ID / 公開契約 version               | Manifest identity。version は package version と別で、変更互換性を自動判定しない                            |
| Instance ID / semantic record key             | 種別付きの安定 tuple から host / Surface / Semantic ID を導出。配列位置、ファイル名、行番号は ID に使わない |
| Component logicalSize                         | build の viewport と既存 pixel target policy の入力                                                         |
| Instance physicalSizeMeters / fit / transform | Instance 固有の canonical Surface と host Spatial。物理寸法は transform scale 適用前の値                    |
| owner / audience / parent                     | 生成物への継承と参照検証。最初は Stage 直下のみ                                                             |
| scene 配列順                                  | host の order。並べ替えても ID は変えない                                                                   |
| React source / CSS / font / 画像 / 依存       | renderer entry hash、依存 integrity、provenance と成果物                                                    |

host の初期値は `active: true`、`visible: true`、`opacity: 1`、name は Instance ID とする提案。初期 API は Transform 全要素と物理サイズを必須にする。静的 Component が states を省略した場合、単一の `default` State と空の公開操作を生成する。State を宣言した場合は initialState を必須にし、暗黙の State は加えない。

ローカル Component は entry と到達する local files の hash で revision を識別し、配布 package の version / integrity を持たない。外部 package は pnpm locator と content integrity、dependency graph で固定する。lock / assembly は local / package origin と structured / opaque mode の union に変更する。具体的な serialized shape、循環依存の扱い、hash 入力と生成 ID の算出は [実装 contract 0節](./REACT_COMPONENT_EXECUTION_CONTRACT.md#0-lock-v2-と生成-id) を正本とする。

依存更新と build を分離する。明示的な依存更新で pnpm の固定解決結果から描画に必要な依存全体を snapshot し、`unframe.lock` へ保存する。通常の check / build は network、host node_modules、registry へ fallback せず、lock を変更しない。ローカル Source 編集後は、固定外部依存を変更しない local lock 更新を明示的に行う。Editor はこの更新を保存操作に含める。手書き編集で local hash が古い場合、build は更新の必要を診断する。

既存 lock v1 は Structured 前提のため、Opaque / local origin / binary asset を含む lock v2 へ変更する。旧入力への暗黙変換や互換 fallback は作らず、loader / assembly carrier / guard / reference / fixture を A1 で明示更新する。既存 Structured の宣言と canonical 出力の意味は維持する。

固定 React runtime、UI ライブラリ、CSS と url 参照先、font、画像を Browser で閉じて解決する。現行 CSS emit だけではこの条件を満たさない。CSS preprocessor / utility CSS の build plugin が必要な場合は、固定した変換経路を明示的に追加するまで非対応とする。最初の実依存 fixture は repo の pnpm lock に固定した `@base-ui/react` の Button と通常 CSS / TTF・OTF を使う。

入力 lock に capture checksum を含めない。生成 PNG 等の checksum は AssetSet / BuildManifest に記録し、source・renderer・環境との整合は既存 build integrity で検証する。Manifest の意味 hash と renderer source hash を区別し、CSS だけの変更でも描画依存と成果物が更新されるようにする。位置だけを変えた場合、Definition 等の hash は変わり得るが、同じ描画条件の PNG bytes は変わらない。capture cache の実装は初期完了条件に含めない。

## 5. Editor の保存契約

Source と lock が正本であり、Editor 専用 JSON override を別の永続的な正本にしない。初期 Inspector は公開 scalar Props と host Transform に限定する。

| 入力                                         | 保存動作                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| Instance 内の直接 literal                    | 対象 field を patch                                                                     |
| `title: sharedTitle`                         | 対象 Instance の title を literal へ置換し、sharedTitle は変更しない                    |
| `props: sharedProps`                         | `props: { ...sharedProps, title: "変更後" }` へ局所 override を作る                     |
| spread 由来の配置値                          | 対象 Instance の末尾で変更 field を明示。Transform は既存解決値を保持して対象軸だけ変更 |
| 一意の Instance 宣言へ対応できない           | 編集不可の理由を表示し、共有定義を暗黙変更しない                                        |
| source / IR hash が command の期待値と異なる | stale conflict として拒否し、再読込を要求                                               |

最初は直接 literal の Props / Transform を扱い、その後に共有値と spread の override を追加する。共通値を複数 Instance で変更する操作は対象外とする。

Source patch、再度の静的検証、local lock 再生成を成功させてから保存する。source lease と fsync した journal によって協調するツール間の一括可視性と crash recovery を実現する。commit 中の失敗は recovery 完了まで読み取りを拒否し、外部編集が検出されたファイルを自動 rollback しない。lease に参加しない外部エディタの同時保存を完全に直列化する保証はしない。詳細は [実装 contract 3節](./REACT_COMPONENT_EXECUTION_CONTRACT.md#3-source-保存の-transaction) に従う。

描画は保存後に実行する。capture 失敗でも検証済み Source は保持し、最後に成功した preview を古い revision として表示する。保存済み revision と表示中の artifact revision を混同しない。初期 Undo / Redo は同じ session の保存済み編集を逆 patch として扱い、最新 hash を検証し、外部編集があれば拒否する。

実行場所は Linux ローカル CLI host とし、同じ origin で Editor assets と認証付き HTTP API を配信する。process 起動・project root と filesystem は CLI、文書の編集 command と Inspector は Web、patch と検証は Compiler が所有する。token、ETag、commandId による再送、job の cancel / stale と artifact 取得は [実装 contract 2節](./REACT_COMPONENT_EXECUTION_CONTRACT.md#2-editor-host-と通信) に従う。remote build service は作らない。

## 6. 実装順と受け入れ条件

| 工程            | 担当領域 / 成果                                                                                                              | 必要な検証 / 完了条件                                                                                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A0 契約確定     | 隔離した型試作、三例、Lock / 抽出 / 保存 / capture contract、ADR-0020                                                        | 8節の型試験と canonical Surface の追加方針を確認。runtime 検証とは区別する                                                                                                                                                            |
| A1 静的経路     | Contracts / Core / Renderer API の Surface 分岐、Authoring / Compiler の分類・抽出・生成 Manifest・配置 lower、CLI の新 lock | schema / integrity / fixture と Structured 回帰、Opaque binding の対応・所有検証。React 関数と module initializer を実行せず check が通る。必須 Prop、余分な key、非静的依存、重複 ID を拒否。Instance 追加・並べ替えで既存 ID が不変 |
| A2 静的 capture | Renderer API / Web、CLI の閉じた bundle と隔離実行                                                                           | Hero と実 UI ライブラリ fixture を描画。CSS / font / 画像を固定、外部取得拒否、binding 検証、mount 完了判定、timeout / cancel / cleanup を確認。反復 build の全公開成果物が一致                                                       |
| A3 直接編集     | Compiler の Source patch、CLI host、Web Inspector / preview                                                                  | 直接 literal の文言・位置を変更して保存・再読込できる。二 Instance が独立。位置のみの変更で PNG が同一。競合・保存失敗・capture 失敗を区別                                                                                            |
| A4 共有値編集   | 局所 override、同一 session Undo / Redo                                                                                      | 2.3 の sharedTitle と追加の props spread fixture を片方だけ編集でき、共有元と対象外 comment を維持。stale command と古い build 結果を適用しない                                                                                       |
| A5 有限 State   | Opaque State capture、公開 Action / Output と既存 Flow 接続                                                                  | Reveal の全 State を capture。missing / duplicate / undeclared binding を拒否。既存 Core とローカル preview で Output → Cue → Action → State の経路を確認。React event は使用しない                                                   |
| A6 採否判断     | 検証記録、契約・package 文書・reference 更新                                                                                 | 作者例、visual 結果、再現性、編集往復、cold / warm build と編集から preview までの時間を報告。React 標準化の採否を明記                                                                                                                |

A2 の同じ入力には明示 source、lock、設定、Compiler / renderer / Browser / encoder、locale、timezone、font と viewport を含む。実装 contract 4節の Linux bubblewrap / cgroup profile と終了条件を実装し、capability 欠落時は実行を拒否する。設計の独立レビューと OS 隔離の実試験は区別し、A2 で runtime を独立レビューする。

工程は依存順に進める。契約確定後の型 fixture と renderer fixture の準備は並行できるが、Editor を仮の永続モデルへ接続しない。A1〜A5 は対象を絞った Red → Green → Refactor と各境界の統合試験を行う。既存 Structured の回帰も維持する。包括的な `nix run .#check` は予定差分を終え、明示的にコミットを依頼された段階で実行する。

速度の合否値は未設定であり、測定前に「高速」とは評価しない。A2 で測定方法を固定し、A3 の操作結果を基に必要な応答時間を決める。有限 State の経路をローカルで確認しても、Delivery・Realtime service・Unity / Quest の統合完了とは扱わない。

## 7. 対象外と採用時の文書更新

初期対象外は複数 Surface、React 内部の GUI 編集・Detach、Opaque Slot / Parts / Variants、任意動的 Runtime UI、remote build / registry / publish、automatic partition、capture cache、既存 Editor fixture の自動移行である。Structured の既存機能は削除しない。

A1 の最初に今回の型・実装 contract を公開 SDK と guard へ反映し、実装する subset に合わせて [ADR-0018](../decisions/0018-static-typescript-jsx-authoring.md)、[ADR-0013](../decisions/0013-local-compiler-project-filesystem-contract.md)、[Authoring Contract](./AUTHORING_CONTRACT.md)、[Architecture](./ARCHITECTURE.md)、関連 package の文書を更新する。描画は ADR-0014 の baked-web の範囲を維持する。React 専用事項は本設計から採用された contract へ移し、Structured の M3A 契約を React にそのまま適用しない。

本書のレビューでは、三例が矛盾なく lower できるか、作者が内部生成物を手で管理していないか、意味と描画の責任、Source 保存の正本、未実装事項を実装済みと記述していないかを確認する。

## 8. A0 の検証結果と実装への引き継ぎ

[型試作](../../packages/unframe-authoring/prototypes/react-component/README.md) は production export に接続しない宣言型と fixture である。三例は CSS import を除いて同じ形を保ち、実 React 型で JSX を検査する。

Authoring 側の TypeScript 7.0.2 と Compiler 側の TypeScript 6.0.3 の両方で型検査が成功した。6.0.3 ではファイルを書き換えずに負例の抑制コメントを除去し、19 箇所に 19 件の診断が出ることも確認した。

- 正例: 異種 scene の Props、default の省略と render 側の具体値、texts / bindings の key、明示 State と暗黙 `default` State。
- 拒否例: 必須 Prop 欠落、余分な Prop、型不一致、未定義 / 非 string Prop 参照、initialState の不正、未定義 State の Action、required / default の不正、非同期 render。19 個の `@ts-expect-error` を外して各箇所の実診断を確認した。
- 型検査で保証しないもの: 任意型 assertion の健全性、完全な意味 schema、Flow ID の存在、static extraction、DOM binding、filesystem transaction、依存 snapshot、Browser / cgroup の動作。これらは実装 contract の試験を A1〜A5 で行う。

```sh
pnpm --filter @unframe/unframe-authoring exec tsc --noEmit -p prototypes/react-component/tsconfig.json
```

A0 では、Props の必須 / default の排他性と、default 解決後の render 型を区別した。複数 Action effect に正常な State と未定義 State が混在すると条件型の分配で拒否を失う問題も、負例を追加して修正した。試作の型が通ることを Compiler 実装の完成と扱わない。

A1 では、型試作をそのまま export せず、既存 schema / semantic guard と一致する公開型へ統合する。Source 非実行の拒否試験、lock v2 の hash / origin / cycle fixture、Structured 回帰を先に用意し、Component 分類 → Manifest / renderer descriptor 抽出 → Instance / ID lowering → CLI frozen check の順に接続する。capture と Editor はこの工程へ混ぜない。

A1 は共通 Surface / Renderer 境界の移行を先に完了させ、その後に静的抽出・lock v2・配置変換を接続する。型試作の成功は、この canonical 表現の成立を証明していない。
