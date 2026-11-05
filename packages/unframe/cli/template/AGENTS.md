# プレゼンテーションの作成

このプロジェクトは Unframe のプレゼンテーションです。`@unframe-dev/authoring` の宣言 API を使い、ソースから表示・再生用の成果物を生成します。

## 作成方針

- 目的、対象者、伝えたい内容、発表の流れを依頼から読み取り、不明な条件は確認してください。
- 見出し、本文、図表の優先順位を明確にし、不要な補助ラベルや説明を増やさないでください。
- MR 空間での読みやすさを考え、文字サイズ、コントラスト、Surface の実寸・位置・視距離を確認してください。
- 内容の出典と、素材・フォントの利用条件を確認してください。秘密情報や認証情報をソースへ含めないでください。

## 編集するファイル

| ファイル                   | 役割                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `presentation.unframe.tsx` | タイトル、Stage、空間配置、コンポーネントのインスタンス、Group / Step / Cue による進行 |
| `surface.manifest.ts`      | コンポーネントの props・状態・操作・出力と、構造ファイルへの参照                       |
| `surface.structure.tsx`    | Surface のサイズ、レイアウト、見た目、意味構造、操作領域                               |
| `*.component.tsx`          | React の描画と、編集可能な props・意味構造・状態・操作                                 |
| `theme.unframe.ts`         | テーマのトークンと名前付きスタイル                                                     |
| `unframe.config.ts`        | エントリーファイルと素材 ID・ローカルファイルの対応                                    |
| `assets/`                  | プレゼンで使用する画像・フォントなどの素材                                             |

## 使用するライブラリ

プレゼンのソースから直接使う Unframe のライブラリは、基本的に `@unframe-dev/authoring` です。解析・ビルド・Preview・公開は `unframe` CLI から実行します。`compiler` や `build` などをプロジェクトへ追加する必要はありません。

| API                                                    | 用途                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| `definePresentation`                                   | Stage、scene、flow をまとめ、プレゼン全体を定義する                 |
| `defineComponentManifest` / `defineComponentStructure` | コンポーネントの公開仕様と、宣言形式の見た目・操作領域を定義する    |
| `Frame` / `Surface` / `Text`                           | 宣言形式の構造を専用 JSX で記述する。React の DOM 要素とは別の API  |
| `defineComponent`                                      | React の `render` と、props・意味構造・状態・操作をまとめて定義する |
| `editableText` / `prop`                                | React 形式で編集可能な文字列 prop と、意味構造からの参照を定義する  |
| `defineTheme` / `tokenRef` / `namedStyleRef`           | 宣言形式の共通トークン・スタイルと参照を定義する                    |
| `assetRef`                                             | 登録した素材を asset ID で参照する                                  |
| `cue` / `componentOutput` / `invokeComponentAction`    | 出力を受けて操作を実行する Cue を定義する                           |

### コンポーネントの作り方

テンプレートの宣言形式は、Unframe のレイアウト・スタイル・意味構造を明示して作る方法です。`surface.manifest.ts` と `surface.structure.tsx` を編集するところから始めてください。props・状態・出力などの公開仕様は manifest、具体的な構造は structure に記述します。専用 JSX を使うファイルでは `jsxImportSource` を `@unframe-dev/authoring` にします。テンプレートの `tsconfig.json` はこの設定です。

HTML / CSS で見た目を作りたい場合は、React 形式の `defineComponent` を使います。`react` と `react-dom` を pnpm で追加し、型定義の `@types/react` を devDependency に追加してください。React DOM の API も直接使う場合は `@types/react-dom` も追加します。React ファイルを `*.component.tsx` として作成してください。専用 JSX と混同しないよう、React ファイルには `/** @jsxImportSource react */` を指定します。

各 `*.component.tsx` は、`export const 名前 = defineComponent({ ... })` を一つだけ持つ形にしてください。`defineComponent` にはオブジェクトリテラルを直接渡し、`render` はその場に同期のアロー関数で記述します。補助関数は描画用として非公開にし、メタデータの生成には使わないでください。

次の例は `Title.component.tsx` です。利用条件を確認した、日本語の表示文字を含む Regular フォントを `assets/title.ttf` に用意してください。テンプレートにはフォントは同梱されていません。

```tsx
/** @jsxImportSource react */
import { defineComponent, editableText, prop } from "@unframe-dev/authoring";
import "./title.css";

export const Title = defineComponent({
  id: "title",
  version: 1,
  props: { title: editableText({ default: "発表タイトル" }) },
  surface: { logicalSize: [800, 450] },
  semantics: {
    rootNodeIds: ["heading"],
    nodes: {
      heading: {
        role: "heading",
        level: 1,
        parentId: null,
        order: 0,
        text: prop("title"),
      },
    },
  },
  render: ({ texts, bindings }) => (
    <main className="title-card">
      <h1 {...bindings.heading}>{texts.heading}</h1>
    </main>
  ),
});
```

同じディレクトリの `title.css` でフォントとレイアウトを指定します。CSS import の型宣言として、`style.d.ts` に `declare module "*.css";` も追加してください。

```css
@font-face {
  font-family: TitleFont;
  src: url("./assets/title.ttf") format("truetype");
  font-weight: 400;
  font-style: normal;
}
.title-card {
  width: 800px;
  height: 450px;
  padding: 48px;
  box-sizing: border-box;
  font-family: TitleFont;
}
.title-card h1 {
  margin: 0;
  font-size: 48px;
  line-height: 1.4;
  font-weight: 400;
}
```

`texts` は props と意味構造から解決された文字列、`bindings` は意味ノードと描画要素を対応させる属性です。同じノードの文字列と属性を対応する DOM 要素に使ってください。

定義した `Title` をエントリーファイルで import し、scene のインスタンスに `component: Title` と `props` を指定します。React と Model を配置する scene は配列形式、既存の宣言形式と React を混在させる場合は `scene.components` に追加します。React インスタンスには `id`、`owner`、`audience`、`parent`、`physicalSizeMeters`、`fit`、`transform` も指定します。インストール済みの `ReactSceneBase` 型に従ってください。

React の描画結果は build 時に画像と操作領域へ変換されます。表示後の操作・状態遷移は Unframe の interactions・states・actions・outputs で定義してください。React のイベントハンドラーやクライアントの state だけに進行を持たせないでください。

描画時の外部通信は許可されません。外部画像・Web フォント・API の取得に依存せず、必要なデータと素材をローカルに用意してください。CSS の animation / transition は画像生成時に無効化されるため、再生時の動きは Unframe の Timeline や effect で定義してください。

### テーマ・CSS・素材

宣言形式では `defineTheme` の `tokens` に共通値、`namedStyles` に共通スタイルを定義し、Presentation の `theme.themeId` で選択します。例えば `theme.unframe.ts` を次のように定義できます。

```ts
import { defineTheme } from "@unframe-dev/authoring";

export default defineTheme({
  id: "default-theme",
  tokens: { "heading-size": { category: "logicalLength", value: 48 } },
  namedStyles: {},
});
```

構造側では `tokenRef({ tokenId: "heading-size", category: "logicalLength" })` を `fontSize` などに指定できます。文字の `font` と `lineHeight` も定義してください。

React 形式では通常の CSS を component ファイルから import します。フォントはローカル素材を CSS の `@font-face` から参照してください。Unframe のテーマは DOM の CSS に自動適用されません。

3D Model は既定 scene を選択した自己完結の glTF 2.0 バイナリ（`.glb`）を使用してください。buffer と PNG / JPEG 画像は GLB 内に埋め込み、外部ファイル参照は使わないでください。拡張は `KHR_materials_unlit` のみ対応します。素材の容量・構造の制限は `unframe check .` で確認してください。

Tailwind を使う場合は `postcss`・`tailwindcss`・`@tailwindcss/postcss` をプロジェクトへ追加し、`postcss.config.mjs` に `export default { plugins: { "@tailwindcss/postcss": {} } };`、import する CSS に `@import "tailwindcss";` を記述します。PostCSS 8 / Tailwind 4 が対象です。依存を導入し、下記の check / build を実行してください。

### 操作と進行

Group は発表のまとまり、Step はその中の進行単位、Cue は入力・出力を受けて操作や遷移を起こす定義です。初期位置は `flow.initialGroupId` と各 Group の `initialStepId` で指定します。

テンプレートの `start` Step の Cue は `surface-instance` の `opened` 出力を受け取ります。次の例で置き換えると、出力を受けて同じ Group の `details` Step へ進みます。`steps` に `details: { id: "details", cues: [] }` も追加してください。

```ts
import { cue, componentOutput } from "@unframe-dev/authoring";

const openDetails = cue({
  id: "open",
  trigger: componentOutput({ componentInstanceId: "surface-instance", outputId: "opened" }),
  actions: [],
  next: { kind: "step", stepId: "details" },
});
```

この `openDetails` を `start.cues` の要素にします。操作も実行する場合は、対象コンポーネントに定義済みの action を `invokeComponentAction({ componentInstanceId, actionId, arguments: {} })` で `actions` に追加します。DOM のクリックから直接 Step を書き換えず、interaction → output → Cue → action / 次の Step の対応をそろえてください。

## 宣言ソースの制約

Presentation、scene、flow、コンポーネントのメタデータなどの宣言は、通常の JavaScript として実行されず、Unframe が静的に解析します。TypeScript の型が合っていても、使用できない式があります。

- 宣言はオブジェクト・配列リテラル、定数、その参照と、Unframe が認識する宣言ビルダーで記述してください。共通値は定数として別ファイルから import できます。
- 宣言を置くモジュールでは import・型宣言・初期値のある `const`・export を使い、`let` / `var`、ループ、実行時の初期化処理は置かないでください。
- 宣言を組み立てるための `.map()`・`.filter()`・`.reduce()`、独自関数や任意のライブラリ関数の呼び出しは使わないでください。繰り返す要素も、必要な要素を配列リテラルに明示してください。
- 算術式、三項演算子、文字列の補間による値の生成も未対応です。寸法・時刻・回転などの計算結果は有限の数値や文字列のリテラルで記述してください。`as const` や `satisfies` を付けても、使える式は増えません。
- オブジェクト・配列の spread は、参照先も静的に解析できる場合に使えます。関数呼び出しで生成した配列を spread しても、この制約は回避できません。
- React 形式の `render` は描画用のコードです。ここでの JavaScript / JSX と、`defineComponent` のメタデータや Presentation の宣言で使える式を混同しないでください。
- 型検査や、宣言を直接 import して実行するテストだけでは、この制約違反を検出できません。変更後は「作業と確認」の `unframe check .` と `unframe build .` で Source の解析・生成を確認してください。

## 空間配置・Timeline・effect の制約

- scene の配列形式に置けるのは React コンポーネントと Model です。任意の spatial node や、宣言形式のコンポーネントを配列へ混ぜないでください。React の `parent` は Stage、Model の `parent` は Stage または presenter の Anchor、`audience` は `all` です。Model の Anchor は `kind: "anchor"`、`owner: { kind: "presenter" }`、`target`（head / leftHand / rightHand / body）、`followPosition`、`followRotation` を指定します。
- 宣言形式と React を混在させた scene では、共有 Scene Timeline（`flow.timelines`、Cue の `timeline.play` / `timelineCompleted`）は未対応です。複数の React / Model を共有 Timeline で動かす場合は scene の配列形式を使ってください。
- Timeline が変更できるのは `opacity` と `transform.position` / `rotation` / `scale` です。回転は角度ではなく正規化した `[x, y, z, w]` の quaternion、scale は各軸とも正の値で指定してください。
- 各トラックの keyframe は 0 ms から Timeline の duration まで時刻を厳密に増加させ、最後以外に `easingToNext` を指定してください。同じ Timeline 内で同じ対象の同じプロパティを複数トラックから変更しないでください。
- 場面をまたいで残す要素は presentation 所有、その Group だけで使う要素は group 所有にしてください。Timeline の owner は対象の寿命に合わせます。presentation 所有の Timeline から group 所有の要素は操作できません。
- `effect.start` は既存の対象 `nodeId` に対して起動します。位置・向きは対象ノードの transform で指定し、effect に未定義の position / direction を追加しないでください。実時間での長さは `durationMilliseconds / speed` ミリ秒で、端数は切り上げます。
- Wave は対象のローカル XY 平面で X の負方向から正方向へ描き進み、描画完了後も形を保持します。消したい時点で同じ `effectId` の `effect.stop` を実行してください。複数の波には別々の `effectId` を付けてください。

## 編集上の注意

- 既存の宣言を起点に編集し、API の詳細はインストール済み `@unframe-dev/authoring` の型定義で確認してください。未確認のプロパティや API を推測して追加しないでください。
- 宣言形式のコンポーネントを追加するときは `*.manifest.ts` と `*.structure.tsx` を使い、manifest の `authoring.structure`、両ファイルの `componentId`、Presentation からの参照をそろえてください。テーマは `*.unframe.ts` に定義してください。
- ID と参照先を一致させてください。特に component、instance、spatial node、state、interaction、output、Group / Step の対応を確認してください。
- manifest の出力と structure の操作領域、Cue の trigger / actions をつなぎ、意図した操作で進行するようにしてください。
- Stage の座標系は `stage.coordinateSystem` に従ってください。初期設定はメートル単位・右手系・上方向 `+Y`・前方向 `-Z` です。
- Surface の `physicalSizeMeters` は実寸、`logicalSize` は描画レイアウトのサイズです。両者と配置・scale の関係を考えて調整してください。
- 素材はプロジェクト内に配置し、`unframe.config.ts` の登録と宣言側の asset ID をそろえてください。
- 宣言形式の text node を追加するときは、使用する文字を含むフォント素材を登録し、直接の style またはテーマから `font`・`fontSize`・`lineHeight` が解決されるようにしてください。テンプレートにはフォント素材は含まれていません。

## 作業と確認

プロジェクトのルートで実行します。`unframe` は利用環境に用意された CLI を使ってください。

```bash
pnpm install --frozen-lockfile
```

ソース・素材・設定を変更した後は、次を実行してください。

```bash
unframe check .
unframe build .
```

依存の導入・更新はプロジェクトが選ぶパッケージマネージャーで行ってください。Unframe は導入済み `node_modules` を使用します。PnP は未対応です。`unframe.lock` と lock 更新操作は不要です。

ブラウザと Unity Preview Player を利用できる環境では、次を実行して表示を確認してください。

```bash
unframe author .
```

`author` は Local Editor と変更時の Preview build を起動し、`Ctrl+C` で終了します。表示確認では、文字や図の欠け・重なり、空間配置、操作領域、Step 遷移を確認してください。表示環境がない場合は未確認として報告してください。

- `pnpm-lock.yaml`、`vendor/`、`.unframe/`、生成された `dist/` を手作業で書き換えないでください。修正はソースへ行い、対応するコマンドで再生成してください。
- 型検査や build の成功と、実際の表示・操作確認は分けて報告してください。実行できなかった確認は、その理由を明記してください。
- 公開・アップロードはユーザーから依頼された場合に行ってください。
