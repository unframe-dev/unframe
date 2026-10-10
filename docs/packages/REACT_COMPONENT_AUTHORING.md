# React Component Authoring

- **Status**: ローカル Authoring の実装・受け入れ検証。A1〜A5 を PR #111 に統合済み。A6 の検証範囲と計測は6節に記載
- **Date**: 2026-10-01
- **Decision**: [ADR-0019](../decisions/0019-single-file-react-component-authoring.md)
- **Implementation contract**: [Lock・抽出・編集・capture](./REACT_COMPONENT_EXECUTION_CONTRACT.md)
- **Scope**: 一ファイルの React Component → 一 import 配置 → 静的 baked-web → Editor 編集・保存 → 有限 State

本書は、Web の UI ライブラリを使う Component の作者向け API と、ローカル Authoring の提供範囲を示す。現行 SDK と Compiler は heading / paragraph / button、有限 State、公開 Action / Output の静的抽出・配置変換を提供する。lock v2 の frozen check と Linux の隔離 Browser capture を接続している。Opaque build は namespace / cgroup の実行条件が欠ける場合に拒否する。ローカル Inspector は公開 scalar Props と host Transform の局所編集・Undo / Redoに対応する。Unity Preview は宣言初期 State の静止表示を扱う。受け入れ範囲と導入条件は6節を参照する。

Surface の Structured / Opaque 表現と Renderer の binding 検証の境界は [ADR-0020](../decisions/0020-structured-and-opaque-surface-content.md) と [実装 contract](./REACT_COMPONENT_EXECUTION_CONTRACT.md#a1-の前提契約canonical-surface) に従う。

## 1. 目標と現在地

Component 作者は公開契約と見た目を一ファイルで定義し、Presentation 作者は Component を一つ import して Props、3D 配置、Flow を記述する。Manifest、renderer entry、内部 Runtime ID、lock を配置のたびに手で結ばない。CSS・画像・描画 helper を別ファイルへ分けることは許す。

現行は Structured の Props / Theme / composition、有限 State、Interaction、Action / Output / Cue、host Timeline を実装している。React Opaque は [Compiler pairing](../../packages/unframe-compiler/src/project/pair-authoring-declarations.ts) から canonical Surface まで接続し、全宣言 State を隔離 capture する。[Opaque bundler](../../packages/unframe-renderer-web/src/opaque/bundle-opaque-renderer.ts) は locked React / CSS / asset を閉じた bundle にして capture へ渡す。[Local Editor](../../app/web/src/features/editor/editor-app.tsx) は Source Inspector と Unity Preview を統合し、CLI Host に接続する。

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

State ごとに同じ base Semantic Tree へ既存規則の override を適用する。`setState` はこの単一 Surface の canonical `setSurfaceState` effect へ lower する helper であり、新しい Runtime action ではない。宣言 record の key から State / Interaction / Action / Output の local ID と既存の kind を補う。

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

静的 fixture は Hero 二件と空の cues を使用し、有限 State fixture は Reveal と Cue の接続を検証する。共有値を使う scalar Prop と host Transform を片方の Instance だけで編集し、Undo / Redo で継承へ戻す経路を検証している。

Opaque の Theme 指定は任意とし、未指定でも宣言検証を通す。明示した場合は参照先が一意に解決することを検証する。Structured の Theme 解決規則は維持する。

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

host の初期値は `active: true`、`visible: true`、`opacity: 1`、name は Instance ID とする。初期 API は Transform 全要素と物理サイズを必須にする。静的 Component が states を省略した場合、単一の `default` State と空の公開操作を生成する。State を宣言した場合は initialState を必須にし、暗黙の State は加えない。

ローカル Component は entry と到達する local files の hash で revision を識別し、配布 package の version / integrity を持たない。外部 package は pnpm locator と content integrity、dependency graph で固定する。lock / assembly は local / package origin と structured / opaque mode の union に変更する。具体的な serialized shape、循環依存の扱い、hash 入力と生成 ID の算出は [実装 contract 0節](./REACT_COMPONENT_EXECUTION_CONTRACT.md#0-lock-v2-と生成-id) を正本とする。

依存更新と build を分離する。明示的な依存更新で pnpm の固定解決結果から描画に必要な依存全体を snapshot し、`unframe.lock` へ保存する。通常の check / build は network、host node_modules、registry へ fallback せず、lock を変更しない。ローカル Source 編集後は、固定外部依存を変更しない local lock 更新を明示的に行う。Editor はこの更新を保存操作に含める。手書き編集で local hash が古い場合、build は更新の必要を診断する。

lock v2 は Opaque / local origin / binary asset を含む。旧 lock v1 からの暗黙変換や互換 fallback は提供せず、Source を更新して lock を明示再生成する。既存 Structured の宣言と canonical 出力の意味は維持する。

固定 React runtime、UI ライブラリ、CSS と url 参照先、font、画像を Browser で閉じて解決する。通常 CSS の import と url 依存を固定 bundle に含める。CSS preprocessor / utility CSS の build plugin が必要な場合は、固定した変換経路を明示的に追加するまで非対応とする。実依存 fixture は repo の pnpm lock に固定した `@base-ui/react` の Button と通常 CSS / TTF・OTF を使う。

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

A3 は直接 literal の Props / Transform を扱う。共有値・spread は対象 Instance の局所 override として編集できる。共通値を複数 Instance で変更する操作は対象外とする。

Source patch、再度の静的検証、local lock 再生成を成功させてから保存する。source lease と fsync した journal によって協調するツール間の一括可視性と crash recovery を実現する。commit 中の失敗は recovery 完了まで読み取りを拒否し、外部編集が検出されたファイルを自動 rollback しない。lease に参加しない外部エディタの同時保存を完全に直列化する保証はしない。詳細は [実装 contract 3節](./REACT_COMPONENT_EXECUTION_CONTRACT.md#3-source-保存の-transaction) に従う。

描画は保存後に実行する。capture 失敗でも検証済み Source は保持し、最後に成功した Unity Preview を古い revision として表示する。保存済み revision と表示中の artifact revision を混同しない。Undo / Redo は同じ session の保存済み編集を逆 patch として扱い、最新 hash を検証し、外部編集があれば履歴を破棄する。

実行場所は Linux ローカル CLI host とし、同じ origin で Editor assets と認証付き HTTP API を配信する。process 起動・project root と filesystem は CLI、文書の編集 command と Inspector は Web、patch と検証は Compiler が所有する。token、ETag、commandId による再送、job の cancel / stale と artifact 取得は [実装 contract 2節](./REACT_COMPONENT_EXECUTION_CONTRACT.md#2-editor-host-と通信) に従う。remote build service は作らない。

## 6. 受け入れ検証と導入条件

React Component の抽出・capture・Source 保存の検証範囲を以下に示す。現在の編集入口と Dev／Dist の Unity 表示は [Local Editor](./LOCAL_EDITOR_DESIGN.md) を参照する。

| 対象                 | 検証する振る舞い                                                                                          | 主な根拠                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 静的抽出・型         | 契約 initializer の非実行、React / Structured の型検査分離、必須 Props・参照の拒否                        | Compiler の `extract-react-components` / `typecheck-authoring-project` / `react-scene-source` テスト                             |
| capture              | 全宣言 State、binding / geometry、透明合成、固定 font / glyph、隔離と回収                                 | Renderer Web の `opaque-*.integration.test.ts`                                                                                   |
| 分割合成             | 透明 button・空 State・clip、未分割画像と partition 合成の画素比較                                        | Compiler / Core の partition テスト、`playwright-fixed-browser.integration.test.ts`（各 channel の差は最大2 byte）               |
| 再生成               | 全公開成果物の反復一致、配置のみ変更した PNG の一致、CSS / font / React 描画変更で PNG と描画 hash が変化 | CLI の `opaque-project.integration.test.ts`                                                                                      |
| 編集往復             | 二 Instance の局所編集、共有元・対象外 Source・コメントの保持、Undo / Redo、保存競合・再送・recovery      | Compiler / CLI / Web の Source 編集・Author テスト                                                                               |
| 編集 metadata と診断 | `editableText` の textarea、診断の種類・path・元 Source 位置、抽出 render / helper の描画例外             | Compiler の型位置テスト、Renderer の位置写像テスト、CLI の `author-source-diagnostics.integration.test.ts`、Web の Author テスト |
| 鮮度と失敗           | 保存後の新 PNG、capture 失敗・build 中 cancel・外部 Source 変更で成功済み dist を保持                     | CLI の `author-capture.integration.test.ts` / revision テスト                                                                    |
| 有限 State 成果物    | 宣言済み State の画像と Interaction / Output → Cue → Action の参照を生成・検証する                        | Compiler / CLI の混在 build。Local Preview は初期 State の静止表示                                                               |

Browser の受け入れ試験は以下で再現する。依存 install / lock refresh を含む試験全体の時間を、個別 build の時間と混同しない。

```bash
nix develop --command scripts/dev/install-presentation-browser.sh
nix develop --command scripts/ci/opaque-capture.sh
```

隔離実行には cgroup v2 の memory / pids controller と systemd user manager の delegation、user namespace、Chromium sandbox が必要である。条件を満たさない場合は拒否し、弱い実行環境へ fallback しない。Browser 試験は共有 host の並列負荷で timeout することがあるため、計測時は `vp test run --maxWorkers=1 --reporter=verbose --silent=false` で対象 fixture を単独実行する。

Base UI Button と固定 React / CSS / image / font の組合せを実 Browser で検証している。UI ライブラリ全体の互換性は保証しない。任意の Vite / PostCSS / Tailwind 設定や host node_modules を描画依存の解決に利用しない。参照 PNG は、見出し・button・画像を目視し、文字欠落と配置の破綻がないことを確認する。

2026-10-01 の単独測定では、Base UI fixture の初回 build は **17,282 ms**、同一入力の反復 build は **13,794 ms**、Author の保存開始から新しい PNG artifact の取得までは **25,936 ms** だった。保存の測定は snapshot 更新と capture を含み、画像の HTTP 転送・decode・画面描画は含まない。反復 build も毎回 capture し、描画 cache は使わない。

測定環境は Linux 7.2.8 / x86_64、Intel Core i7-14700F（28 logical CPU）、約49 GB RAM、固定 Bun 1.4.2、Rolldown 1.1.5、Playwright 1.62.1 の managed Chromium headless shell revision 1234 である。この fixture と環境では、個別 build **30秒以内**、保存から PNG artifact 取得 **60秒以内**をローカル導入の確認基準とする。各一回の測定から定めた作業上の基準であり、任意入力や他 host の性能保証ではない。時間の閾値を回帰テストに組み込まず、環境・入力を固定した単独測定で確認する。生成 PNG（2048×1152）は、見出し・button の文字と画像の配置を目視確認した。

## 7. 対象外

固定 Dist の公開と Delivery／Realtime／native Unity 接続は [Local Editor の検証](./LOCAL_EDITOR_DESIGN.md#5-検証と残る実証) で扱う。実サービス E2E と Quest 実機確認の完了は本書では主張しない。React 内部の GUI 編集、共有元の一括変更、Opaque 内部の自動分割、描画 cache、`init` と remote registry も提供しない。SDK の一般配布は未検証であり、reference の手製 SDK 型 snapshot を package 配布の証明にしない。

A0〜A5 の実装経緯は [歴史的な計画](../plans/pr111-react-authoring-acceptance.md) に残す。現行の入力・保存・隔離契約は [実装 contract](./REACT_COMPONENT_EXECUTION_CONTRACT.md) を正本とする。
