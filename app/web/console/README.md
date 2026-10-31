# Unframe Console

`app/web/console` は認証・アカウント設定、device 承認、公開済みプレゼンテーションの確認とルーム作成を担当する Workers 向け React SPA です。Source 編集・build・Unity Preview・公開操作は [Local Editor](../local-editor/README.md) と CLI が担当します。

## 起動と接続先

```bash
nix run .#setup
nix develop
pnpm --filter @unframe/console dev
```

`VITE_AUDIENCE_URL` は参加先の HTTPS origin（path・query・ユーザー情報なし）で、未設定時は `https://app.un-fra.me` を使います。参加 URL は `/#join=ルームコード` 形式で、QR は同じ URL をブラウザー内で生成します。

`VITE_CONTROL_PLANE_URL` は Control Plane API の origin で、未設定時は `https://api.un-fra.me` を使います。ブラウザー認証は Better Auth client、製品 API は `@unframe/api-client-typescript` の Hono RPC client と TanStack Query を使い、cookie を送信します。

## 管理画面

- `/home`: 閲覧可能な Presentation と最新公開 Dist を確認します。公開情報のない Presentation と取得エラーを区別します。
- `/rooms`: 自分が作成したルーム（Session）の一覧・再取得・ページ送りと、公開済み Presentation からの新規作成を扱います。作成後は詳細へ進みます。
- `/rooms/{id}`: 現在のルームコードを取得・更新し、匿名 Viewer の参加 URL と QR を共有します。更新結果が不明な場合は共有を止め、現在のコードを再取得します。終了後は共有できません。発表環境を準備し、準備完了後に発表を開始します。準備失敗は同じルームで再試行でき、発表終了後は準備・開始できません。
- `/login`・`/signup`・`/recover`・`/recover/reset`・`/device`: 認証と device 承認。
- `/devices`: Device Authorization で承認した有効な認証セッションの一覧・再取得と、`/device` の承認画面への入口です。端末の User-Agent と承認日時・有効期限を表示します。
- `/settings/profile`・`/settings/security`: アカウント設定。他の認証セッションの一括失効はセキュリティー画面から行います。

サイドバーのアカウントメニューにはアカウント画像を表示し、プロフィールで画像を変更・解除すると保存後に反映します。

二要素認証は任意です。アカウントメニューの「セキュリティー」または「設定 → セキュリティー」から設定できます。現在のパスワードを入力し、認証アプリで QR コードを読み取ってコードを確認すると有効になります。表示されたバックアップコードを保管してください。有効化後はパスワードログイン時に認証アプリまたはバックアップコードで確認し、不要になった場合は同じ設定画面で無効化できます。

Googleのみで登録したアカウントにはUnframe用のパスワードがないため、設定画面から登録メールアドレスに設定メールを送信できます。メール内のリンクでパスワードを設定すると、パスワードログインとUnframeの二要素認証を利用できます。Googleログインの二段階認証は、同画面から進めるGoogle側のセキュリティー設定で管理します。

発表環境の準備には、運用者が Cloud Host を登録・起動しておく必要があります。ルームへの参加は Audience と Unity が担当します。作成応答が不明な場合は自動再送しません。未終了の Session がある Presentation の再公開は Control Plane が拒否します。

LP の `/signup`・`/login` リンクから同じ origin の Console に進みます。メール登録後は確認メールの送信先・再送を表示し、メール内のリンクで確認後は `/login` に戻ります。ログイン成功後と Google 認証成功後は `/home` に進みます。未ログインで管理画面を開いた場合も `/login` に進みます。パスワード再設定に成功すると、すぐに `/login` に戻ります。メールと OAuth の戻り先には Console の絶対 URL を渡すため、開発時は Control Plane の `WEB_ORIGIN` に Console の origin を設定してください。

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
