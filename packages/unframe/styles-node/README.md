# @unframe-dev/styles-node

プレゼンプロジェクト所有の PostCSS 設定を読み、描画用 CSS を生成する Node API。PostCSS 8 と、公式 plugin を使用する場合の Tailwind 4 を対象とする。標準の ESM / CJS / TS・関数 config、CSS-first 設定、公式 `@config` / `@plugin` を使用できる。

プロジェクト側で `postcss`、`tailwindcss`、`@tailwindcss/postcss` と追加 plugin をプロジェクトのパッケージマネージャーで導入する。

```js
// postcss.config.mjs
export default { plugins: { "@tailwindcss/postcss": {} } };
```

```css
/* src/styles.css */
@import "tailwindcss" source("../");
@theme {
  --color-brand: #123456;
}
```

React component から CSS を import する。依存はプロジェクトが選ぶパッケージマネージャーで導入し、`unframe check` / `build` を実行する。Unframe は導入済み `node_modules` から現在の依存・native runtime・設定を取得し、style worker の入力を生成する。`unframe.lock` と lock 更新コマンドは使わない。PnP は未対応。

OS / CPU を切り替えた場合も、その環境へ必要な依存を導入してから実行する。一回の build 内では取得済み snapshot の runtime と bytes を照合し、隔離 worker の実行条件を検証する。

`compileStyles({ projectRoot, entries })` の `entries` は project root 相対パス。API 自体は隔離を提供しない。CLI が取得した source / Node graph の配置先で呼び出す。返却値は CSS、source map、診断、観測した依存。依存通知は完全な読み取り一覧ではないため、CLI は config/helper/JSON/候補ファイルを含む全ソースの変更・追加・削除を identity に含める。ソース bytes は一時的な変換用配置に使い、再利用する build 結果は `.unframe/cache/` に置く。キャッシュを削除しても入力から再生成できる。`.git`、`node_modules`、`.unframe`、Dist、CLI の制御ファイルは変換対象外。

設定探索は project root で止める。Tailwind の自動注入やホスト同梱版への fallback は行わない。`from` / `to` / `map` は CLI が所有し、config での指定は診断になる。相対 asset URL の基準は CSS entry のディレクトリ。Renderer は既存の閉じた image/font graph に接続し、外部 URL と file URL を拒否する。

source map は保持するが、作者の元 CSS へのエラー位置変換は保証しない。最適化した Tailwind の map は生成 CSS を `sourcesContent` に持つ場合がある。時計・乱数などに依存する任意 plugin の決定性は保証対象外。

同梱 adapter snapshot の展開出力は128 MiBを上限とする。

`compileStylesResultSchema` と API の型は同じ Zod スキーマから公開する。Node worker が読み込む JavaScript は `pnpm --filter @unframe-dev/styles-node run build` で `dist/` に生成する。

パッケージの設定互換性テストは `pnpm --filter @unframe-dev/styles-node run test`。隔離・実描画テストは `styles-worker.integration.test.ts` と CLI の `tailwind-project.integration.test.ts` を使う。CSS Modules、SVGR、WOFF2、import alias は対象外。

実 Browser を使う統合テストでは、導入済みの固定 Chromium に `PLAYWRIGHT_BROWSERS_PATH` を合わせる。CI はリポジトリの `.cache/playwright` を使用する。
