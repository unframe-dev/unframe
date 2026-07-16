# Unframe LP

SvelteKit と `adapter-static` で生成する Unframe のランディングページです。
生成した `build/` を Cloudflare Workers Static Assets として `un-fra.me` へ配信します。

## 開発

```bash
pnpm --filter @unframe/site run dev
```

## Cloudflare Workers

Wrangler の設定は `lp/wrangler.toml` が正とします。初回のみCloudflareへログインします。

```bash
pnpm --filter @unframe/site exec wrangler login
pnpm --filter @unframe/site exec wrangler whoami
```

デプロイ前の検証と本番デプロイは次のコマンドを使います。

```bash
pnpm --filter @unframe/site run cf:deploy:dry-run
pnpm --filter @unframe/site run cf:deploy
```

`cf:deploy` はWranglerのbuild hookから `pnpm run build` を実行し、`build/` をアップロードします。

## ルーティング

LPは `un-fra.me/*` をデフォルトルートとして使用します。同じゾーンに別Workerを追加する場合は、
`un-fra.me/api/*` のようにLPより具体的なパスを割り当ててください。Cloudflareではより具体的な
ルートが優先されます。Worker名もプロジェクトごとに重複しないようにします。

本番のデプロイには、対象ゾーンへのアクセス権を持つCloudflare APIトークン、またはWranglerの
ログインセッションが必要です。
