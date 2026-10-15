# unframe-tailwind

プレゼンプロジェクト所有の PostCSS 設定を読み、描画用 CSS を生成する Node API。PostCSS 8 と、公式 plugin を使用する場合の Tailwind 4 を対象とする。標準の ESM / CJS / TS・関数 config、CSS-first 設定、公式 `@config` / `@plugin` を使用できる。

プロジェクト側で `postcss`、`tailwindcss`、`@tailwindcss/postcss` と追加 plugin を pnpm lockfile に固定する。

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

React component から CSS を import し、依存追加後は `unframe-cli lock update <absolute-project-directory>`、ソースや設定変更後は `unframe-cli lock refresh <absolute-project-directory>` を実行する。`check` / `build` / Preview は固定した依存を使い、ホストの `node_modules` を再解決しない。

CLI は Linux の bubblewrap と委任済み cgroup v2 で、ビルドごとに新しい Node 24 worker を起動する。リポジトリでは `nix develop` 内から `scripts/dev/opaque-capture-scope.sh <command> [arguments...]` を使用する。変換失敗時は既存 Dist を公開済みのまま維持する。

`compileStyles({ projectRoot, entries })` の `entries` は project root 相対パス。API 自体は隔離を提供しない。CLI が固定した source / Node graph の配置先で呼び出す。返却値は CSS、source map、診断、観測した依存。依存通知は完全な読み取り一覧ではないため、CLI は config/helper/JSON/候補ファイルを含む全ソースの変更・追加・削除を identity に含める。ソース bytes は一時的な変換用配置に使い、`unframe.lock` の style snapshot には依存と入力 identity を保存する。ソース bytes は lock に埋め込まない。`.git`、`node_modules`、`.unframe`、Dist、CLI の制御ファイルは変換対象外。

設定探索は project root で止める。Tailwind の自動注入やホスト同梱版への fallback は行わない。`from` / `to` / `map` は CLI が所有し、config での指定は診断になる。相対 asset URL の基準は CSS entry のディレクトリ。Renderer は既存の閉じた image/font graph に接続し、外部 URL と file URL を拒否する。

source map は保持するが、作者の元 CSS へのエラー位置変換は保証しない。最適化した Tailwind の map は生成 CSS を `sourcesContent` に持つ場合がある。時計・乱数などに依存する任意 plugin の決定性は保証対象外。

lock の最大サイズは、native binary を含む依存のため128 MiB。

`compileStylesResultSchema` と API の型は同じ Zod スキーマから公開する。Node worker が読み込む JavaScript は `pnpm --filter @unframe/unframe-tailwind build` で `dist/` に生成する。通常の依存インストールでは `prepare` がビルドする。

パッケージの設定互換性テストは `pnpm --filter @unframe/unframe-tailwind test`。隔離・実描画テストは CLI の `styles-worker.integration.test.ts` と `tailwind-project.integration.test.ts` を使う。CSS Modules、SVGR、WOFF2、import alias は対象外。

実 Browser を使う統合テストでは、導入済みの固定 Chromium に `PLAYWRIGHT_BROWSERS_PATH` を合わせる。CI はリポジトリの `.cache/playwright` を使用する。
