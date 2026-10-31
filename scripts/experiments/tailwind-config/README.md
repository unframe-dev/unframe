# PostCSS と Tailwind の設定互換性検証

各プレゼンプロジェクトが所有する標準 config を読み、実際の PostCSS / Tailwind で CSS を生成する検証。ESM / CJS / TS、関数 config、helper import、plugin 順序、別バージョンの解決を確認した。本体での利用方法と制約は [unframe-tailwind README](../../../packages/unframe/tailwind/README.md) を参照する。

このディレクトリは独立した pnpm workspace。リポジトリ本体の package / lockfile は変更せず、実験の依存を専用 lockfile で固定する。

## 再実行

リポジトリ root から実行する。Node 24.13.0、pnpm 11.14.0 を使用する。

```bash
pnpm --dir scripts/experiments/tailwind-config install --frozen-lockfile
pnpm --dir scripts/experiments/tailwind-config typecheck
pnpm --dir scripts/experiments/tailwind-config test
```

実験コードは strict TypeScript として型検証し、Node 24 のネイティブ TypeScript 実行を使用する。テストは一時プロジェクトを作り、各実行で新しい Node process を起動して後始末する。[results.json](./results.json) に環境、固定依存、互換性検証 18 件の成否、観測結果を出力する。別途、schema と root 境界のテスト 3 件も実行する。2026-10-14 の実行では 18 件すべて成功した。実験は repository-wide CI の対象に追加していない。

未知の API の挙動を観測してから assertion にした探索検証であり、本体機能の Red / Green を実施したものではない。Node 標準 test runner から実パッケージを呼び、変換処理を mock していない。

## 検証環境

| 項目                      | 値                                      |
| ------------------------- | --------------------------------------- |
| OS / architecture / libc  | Linux / x64 / glibc 2.42                |
| Node / pnpm               | 24.13.0 / 11.14.0                       |
| PostCSS / config loader   | 8.5.29 / postcss-load-config 6.0.1      |
| Tailwind / PostCSS plugin | 4.3.3。比較用プロジェクトでは両方 4.2.1 |
| TS loader / 追加 plugin   | jiti 2.7.0 / @tailwindcss/forms 0.5.11  |

`process.report` で oxide と Lightning CSS の `.node` 実体のロードを確認した。install script は無効で、導入済みの platform package を利用する。

## 結果と設計への反映

| 検証                               | 結果                                                                         | 計画への反映                                               |
| ---------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| PostCSS の `.mjs` / `.cjs` / `.ts` | 設定された plugin が動作。TS helper の enum も処理                           | 標準 loader を使用し、独自の設定形式を作らない             |
| 関数 config と caller CWD          | `ctx.cwd` / `process.cwd()` を project root に揃え、env 分岐と自動走査が動作 | worker の cwd / env を固定する                             |
| Tailwind の CSS-first / `@config`  | theme / utility、ESM / CJS / TS config の色が出力へ反映                      | Tailwind に解釈を任せ、config を自動探索しない             |
| local plugin / `@plugin`           | local plugin の順序変更が出力に反映。forms plugin も動作                     | ユーザーの plugin 構成を保持する                           |
| config 不在・親 config             | root で探索停止。親 config は実行されない                                    | config 不在を明示エラーにする                              |
| Tailwind 未設定                    | 空の plugin 配列では Tailwind を注入しない                                   | 標準 PostCSS の結果と Renderer の入力受理を区別する        |
| 設定・plugin・CSS の失敗           | config / transform の段階と原因を取得                                        | 元のエラーを診断へ変換する                                 |
| helper / JSON の変更               | fresh process で反映。ただし dependency message は 0 件                      | 通知だけを cache / watch の正本にしない                    |
| クラス・走査ファイルの追加削除     | fresh process の再走査で生成 CSS へ反映                                      | source snapshot 全体の変更を検出する                       |
| Tailwind 4.3.3 / 4.2.1             | 各プロジェクトで選択した依存が使われる                                       | ホスト同梱 Tailwind への fallback を設けない               |
| 別 temp root / caller CWD          | CSS と path field 正規化後の map が一致                                      | 安定した worker path と論理パスを使う                      |
| import 先 CSS の相対画像 URL       | `src/input.css` から `theme/part.css` を読み、`../theme/icon.svg` に再配置   | 出力 URL の基準を entry のディレクトリに固定する           |
| parser / syntax / stringifier      | project-local 実装が動作                                                     | PostCSS の設定オプションを保持する                         |
| `from` / `to` / `map`              | worker が上書き。`map: false` の plain PostCSS とは異なる                    | 本体では所有フィールドとの競合を診断し、黙って上書きしない |

最適化有効時の map は `sources` に入力 CSS 名を持つ一方、`sourcesContent` に生成済みルールが含まれ、元入力は含まれなかった。最適化無効時は元入力を含む。map が返ることや再現することを、作者の元 CSS への正確な位置対応と同一視しない。

## 現行 Unframe への依存取込み

既存の `snapshotInstalledPackages` にこの実験の依存を渡す確認は、リポジトリ root から再実行できる。

```bash
bun -e 'import { snapshotInstalledPackages } from "./packages/unframe/cli/src/filesystem/package-snapshot.ts"; await snapshotInstalledPackages(process.cwd() + "/scripts/experiments/tailwind-config")'
```

現行実装では次のエラーで停止する。

```text
Package enhanced-resolve@5.26.0: Browser mapping source must name a locked package file.
```

`enhanced-resolve` の `browser` map は `process` / `path` などの bare module key を持つ。現行 snapshot の検証はその key に `./` を要求する。この段階で停止するため、後続の native optional dependency の snapshot 成否までは確認できない。設定変換の成功と Unframe lock への取込み成功は別である。

## 検証の境界

- fixture は検証用の信頼済み JS を実行する。OS sandbox、filesystem / network 制限、timeout / 資源制限は未実装。
- 一時プロジェクトの依存は、この実験で install した package graph への symlink。独立した snapshot へ依存を再配置した実行や、ホスト依存への fallback が不可能であることは検証していない。
- ESM / CJS / TS は代表例。全設定ファイル名、全 module mode、YAML、任意 plugin、他 OS の互換性を保証しない。
- fresh process による変更反映を確認した。watcher、キャッシュ無効化、本体の check / lock / build / Preview への接続は未実装。
- Browser capture は未検証。SVG は CSS URL の再配置だけに使用した。
