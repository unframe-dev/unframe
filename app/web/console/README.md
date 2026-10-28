# Unframe Console

`app/web/console` は認証・アカウント設定、device 承認、公開済み Dist の確認とルーム作成を担当する Workers 向け React SPA です。Source 編集・build・Unity Preview・公開操作は [Local Editor](../local-editor/README.md) と CLI が担当します。

## 起動と接続先

```bash
nix run .#setup
nix develop
pnpm --filter @unframe/console dev
```

`VITE_CONTROL_PLANE_URL` は Control Plane API の origin で、未設定時は `https://api.un-fra.me` を使います。ブラウザー認証は Better Auth client、製品 API は `@unframe/api-client-typescript` の Hono RPC client と TanStack Query を使い、cookie を送信します。

## 管理画面

- `/home`: 閲覧可能な Presentation と最新公開 Dist を確認します。公開情報のない Presentation と取得エラーを区別します。
- `/rooms`: 公開済み Presentation からルーム（Session）を作成します。作成時点の最新公開版が固定され、結果の publication fence を表示します。Join Code は作成直後だけ表示し、再読み込み後に再取得できません。
- `/rooms/{id}`: 発表環境を準備し、準備完了後に発表を開始します。準備失敗は同じルームで再試行でき、発表終了後は準備・開始できません。
- `/login`・`/signup`・`/recover`・`/recover/reset`・`/device`: 認証と device 承認。
- `/settings/profile`・`/settings/security`: アカウント設定。`/devices` は準備画面です。

発表環境の準備には、運用者が Cloud Host を登録・起動しておく必要があります。ルームへの参加は Audience と Unity が担当します。作成応答が不明な場合は自動再送しません。未終了の Session がある Presentation の再公開は Control Plane が拒否します。

## 検証

```bash
nix run .#console
pnpm --filter @unframe/console test:e2e
pnpm --filter @unframe/console cf:deploy:dry-run
```

Console の E2E と、Local Editor・実 Control Plane・Unity の統合検証は別です。後者は [scripts README](../../../scripts/README.md#local-editor-と-unity) を参照してください。

## Cloudflare 配信

`wrangler.toml` は root-based path contract を持ちます。

```text
/assets/... -> static asset
/foo        -> SPA index fallback
```

Vite の `base` は `/` で、Router に `basepath` は設定しません。本番では LP が `/`、`/news/*`、`/docs/*` を所有し、Console Worker は Application route を配信する構成を sibling infra repository と合わせて設定します。Worker 設定変更後は binding 型を再生成してください。

```bash
pnpm --filter @unframe/console run cf:types
```

production build 後、Vite plugin が `dist/unframe_web_editor/wrangler.json` と `dist/client` を生成します。ローカルの Cloudflare preview は生成済み設定を使います。

```bash
pnpm --filter @unframe/console run build
pnpm --dir app/web/console exec wrangler dev --config dist/unframe_web_editor/wrangler.json
```

NixOS で配布版 `workerd` を実行するには、host 側で `programs.nix-ld.enable` が必要です。このリポジトリにはデプロイ workflow がないため、公開操作は品質ゲートに含めていません。

Worker 名 `unframe-web-editor` は sibling infra の `editor_worker_name` に合わせて維持しています。dry-run は実配信・OAuth callback・cookie/CORS の本番検証を代替しません。
