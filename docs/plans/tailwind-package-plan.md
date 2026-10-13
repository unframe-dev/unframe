# プロジェクト所有の Tailwind 設定を接続する計画

- Status: 実装・対象検証済み。以下は採用した設計と受け入れ条件の記録。
- Scope: `unframe-tailwind` と CLI / Compiler / Renderer への接続。
- 検証: [再実行手順と結果](../../scripts/experiments/tailwind-config/README.md)。

現在の利用方法と制約は [unframe-tailwind README](../../packages/unframe-tailwind/README.md) を参照する。Node 依存 snapshot、隔離 worker、共通 prepared input、Compiler / Renderer / CLI / Preview への接続を実装した。

パッケージの設定互換性テスト、CLI / Compiler / Renderer の対象テスト・型検査・lint、`nix flake check --no-build` を確認した。実 Node / Browser の統合テストでは、固定依存による native plugin 実行、隔離と資源制限、入力の追加・削除、helper の JSON 変更、キャッシュを削除した再描画の一致、設定エラー時の既存 Dist / Preview 維持を確認した。包括的な repository gate はコミット依頼時に実行する。

プレゼンプロジェクトの `postcss.config.*`、Tailwind の CSS / JS 設定、plugin をそのまま使う。Unframe は設定を別形式へ変換せず、プロジェクトが固定した PostCSS パイプラインを実行して描画用 CSS を得る。CSS Modules、SVGR、WOFF2、import alias はこの計画の対象外。

## 検証から決めたこと

Node 24.13.0 / Linux x64 で実パッケージを使用した 18 件のテストが成功した。対応形式と再実行手順は検証 README、各テストケースの結果は専用 `results.json` に記録する。

- ESM / CJS / TS、関数 config、TS helper、公式 `@config` / `@plugin` が動作したため、標準 loader と公式 PostCSS plugin を採用する。
- helper / JSON の変更は fresh process で反映したが、任意のファイル読込は依存通知に現れなかった。初版は全入力スナップショットを cache / watch の正本にする。
- 相対画像 URL は entry を基準として再配置された。API の CSS 配置基準を固定する。
- 最適化有効時の source map は元 CSS の内容を保持しなかった。map の返却と作者の元ファイルへの位置対応を分ける。
- `from` / `to` / `map` は実験 worker が上書きし、plain PostCSS と差が出た。本体では競合を診断する。

これらは設定変換の検証結果であり、OS 隔離、依存 snapshot の再配置、本体 build / Browser capture の検証結果ではない。

## 設定と依存の所有

プロジェクトが `postcss`、`tailwindcss`、`@tailwindcss/postcss`、追加 plugin を所有する。`unframe-tailwind` は対応範囲を宣言し、プロジェクトの固定済み依存を解決する。ホスト同梱の Tailwind への fallback は設けない。

PostCSS config は標準 loader でプロジェクト root から探索し、その root で探索を止める。ESM / CJS / TS と関数 config を扱う。loader と TS 読込処理系は Unframe のビルドツールとして固定する。設定が読み込む helper や JSON もビルド入力に含める。標準 loader が扱う他の設定形式は、検証済みの形式と区別する。

初版は root での標準探索に限定する。任意の設定ファイルを直接選ぶオプション、workspace 親からの設定継承は含めない。

Tailwind v4 の CSS-first 設定と `@config` / `@plugin` は公式 plugin に任せる。`tailwind.config.*` を独自に自動探索・merge しない。PostCSS plugin の並びとオプションを維持し、Tailwind を自動注入しない。

```js
// postcss.config.mjs
export default {
  plugins: { "@tailwindcss/postcss": {} },
};
```

```css
/* src/styles.css */
@import "tailwindcss" source("./");
@config "../tailwind.config.ts";
```

`@config` は JS / TS 設定を使う場合だけ必要。CSS の `@theme` だけで設定する構成も受理する。

## パッケージ API 案

CLI が固定したファイルと Node 依存を worker 内へ配置し、worker 内で次の Node API を呼ぶ。`projectRoot` は配置先を示すだけであり、この API 単体がファイルシステム隔離や入力固定を保証するわけではない。

```ts
type CompileStylesRequest = {
  projectRoot: string;
  entries: readonly string[]; // project-root-relative CSS paths
};

type StyleDiagnostic = {
  phase: "config" | "resolve" | "transform";
  severity: "warning" | "error";
  message: string;
  file?: string;
  line?: number;
  column?: number;
  plugin?: string;
};

type ObservedDependency =
  { kind: "file"; path: string } | { kind: "directory"; path: string; glob?: string };

type CompileStylesResult =
  | {
      ok: true;
      configFile: string;
      stylesheets: readonly {
        entry: string;
        css: string;
        sourceMap?: string;
      }[];
      observedDependencies: readonly ObservedDependency[];
      diagnostics: readonly StyleDiagnostic[];
    }
  | { ok: false; diagnostics: readonly StyleDiagnostic[] };

declare function compileStyles(request: CompileStylesRequest): Promise<CompileStylesResult>;
```

これは将来の公開 API 案であり、spike の worker protocol ではない。返却するファイル参照は論理 project / dependency path に正規化する。依存情報には通知されない読み取りがあり得るため、`observedDependencies` を完全な入力集合と呼ばない。実際に選択された処理系の locator / integrity は、CLI が固定した Node 依存グラフと照合する。

`sourceMap` は処理系が返した map を保持する。初版ではこれだけを根拠に作者の元 CSS の位置へエラーを変換しない。検証した Tailwind 4.3.3 では、最適化有効時の `sourcesContent` が生成 CSS、無効時は元入力を含む結果だった。元入力への位置対応を保証するには、別の mapping 検証が必要となる。

初版では CLI が production の実行環境を固定し、Preview / 配信用 build で同じ条件を使う。`process.cwd()` と config の `ctx.cwd` は worker 内の project root、`ctx.env` と `NODE_ENV` は production に揃える。環境依存の設定値を追加するときは明示的な入力として identity に加える。

PostCSS の parser / syntax / stringifier などは設定に従う。`from` / `to` / source map の出力先は Unframe が所有するため、config に競合指定があれば診断し、黙って無視しない。出力はメモリで受け、config の任意の出力先へ書き込まない。

`from = snapshot/entry`、`to = from` とし、返却 CSS の相対 URL は入力 entry と同じ論理ディレクトリを基準にする。Renderer が CSS を別位置へ配置するときは、この基準から asset URL を解決して再配置する。

## CLI と各パッケージの境界

| 所有者           | 追加する責務                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| CLI              | スナップショット、Node 依存配置、worker の起動・取消・timeout・資源制限、入力と処理系の identity |
| unframe-tailwind | 標準 config の読込、project-local PostCSS の実行、CSS / map / 診断 / 観測依存の返却              |
| Compiler         | 変換済み CSS と元ファイルの対応を検証し、component closure / lock / hash に含める                |
| Renderer Web     | 変換済み CSS と asset を bundle / capture する                                                   |

config / plugin は実行可能な Node プログラムとして worker に渡す。Compiler の非実行 Authoring 解析へ混ぜない。既存のブラウザ capture の隔離は、先行する変換処理の隔離を代替しない。

既存 package snapshot の browser / import / production 解決を Node 用に転用しない。Node の import / require 条件、pnpm の peer context、package ごとの依存関係、platform に対応した optional native package を保持する。Node / OS / architecture / libc と native binary も固定対象とする。

現行 `snapshotInstalledPackages` に spike の依存を渡すと、`enhanced-resolve@5.26.0` の `browser` map の bare module key を拒否する。Node 変換処理は動いても現在の Unframe lock へそのまま取り込めない。これは native package 読込の失敗ではなく、その前の browser 用 snapshot 検証での停止である。

現在の TS ファイル収集から config だけを名前で除外しても helper が残る。Authoring entry から型検査対象を解決する経路と、config / CSS / 走査対象を含む変換入力の収集を分ける。

## 入力固定と生成物

初版はビルドごとに新しい worker を起動する。固定した source snapshot 全体と Node 依存グラフをキャッシュ入力に含める。PostCSS の file / directory dependency 通知は再ビルド判定の補助であり、それだけで任意 plugin の読み取りを網羅したとは扱わない。

source snapshot の変更・追加・削除を検出し、config helper / JSON 変更でも再実行する。Tailwind の増分 compiler を長寿命で使う最適化は初版に含めない。固定入力に対する独立実行で出力を比較し、キャッシュ hit を再現性の証明にしない。

worker の配置パスは安定させ、CSS / map / 診断へホストの一時ディレクトリが漏れないようにする。map の正規化は path field に限定し、CSS や `sourcesContent` の任意文字列を一括置換しない。

CSS の `@import` 展開・URL 再配置は公式 Tailwind plugin の処理を尊重する。変換後に残る asset URL を Unframe の閉じた asset graph に接続し、二重に相対パスを書き換えない。file URL、外部 URL、同一文書 fragment は区別する。

設定・依存・実行環境の固定だけで、時計や乱数に依存する任意 plugin の決定性まで保証できるわけではない。初版の保証対象は固定実行環境で再現性を確認した構成とする。

## 実装順と受け入れ条件

1. **Node 変換用スナップショット**: platform optional dependencies と peer context を保持して実行できる。ホスト filesystem / network へのアクセスを制限し、変更・追加・削除で identity が変わる。
2. **unframe-tailwind**: 技術検証の設定 fixture を package の受け入れテストに移し、上記 API を実装する。config 不在・読込失敗・plugin 失敗を元ファイルの診断へ変換する。取消・timeout・worker 異常終了は CLI が処理する。
3. **check / lock / build / Preview 接続**: 全経路で同じ prepared input を使う。`frozen-component-inputs` が CSS を独立に再探索する経路を改め、config / helper / source candidates / 生成 CSS を同じ identity に含める。
4. **Renderer 接続**: 別ディレクトリから import した CSS が持つ相対画像 URL、CSS 適用順、source map の位置対応、固定 Browser での描画を検証する。失敗時に既存 Dist / 正常 Preview を維持する。

段階ごとに振る舞いの失敗テストから実装する。作業中は対象限定のテスト・lint・型チェック、包括的な repository gate は明示的なコミット依頼時に実行する。

## 参考実装

- [Tailwind 4.3.3 PostCSS plugin](https://github.com/tailwindlabs/tailwindcss/blob/v4.3.3/packages/@tailwindcss-postcss/src/index.ts): CSS 変換、source scanner、依存通知。
- [postcss-load-config](https://github.com/postcss/postcss-load-config): 標準設定形式と plugin 読込。検証は独立 lockfile の 6.0.1 を使用。
- [Vite 8.0.13 CSS integration](https://github.com/vitejs/vite/blob/v8.0.13/packages/vite/src/node/plugins/css.ts): config と CSS pipeline の接続。workspace 親への探索は採用しない。
