# Unframe LP

SvelteKit と `adapter-static` で生成する Unframe のランディングページです。
生成した `build/` を Cloudflare Workers Static Assets として `un-fra.me` へ配信します。

## News / Docs

`src/content/news/` と `src/content/docs/` に `.mdx` ファイルを追加すると、対応する一覧ページと詳細ページが静的に生成されます。
各ファイルには次のfrontmatterを記述してください。

```mdx
---
title: "ページのタイトル"
description: "一覧に表示する説明"
order: 1
publishedAt: "2026-07-18"
---

本文をMarkdownで記述します。
```

`publishedAt` は任意で、Newsでは日付表示に使われます。URLはファイル名から拡張子を除いた `/news/<slug>/` または `/docs/<slug>/` になります。

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

## DNS

このWorkerはCustom DomainではなくRoute方式を使うため、DNSレコードは自動作成されません。
Cloudflare DNSに次のレコードを作成し、Proxy statusをProxied（オレンジクラウド）にします。

| Type | Name | IPv6 address | Proxy status | TTL  |
| ---- | ---- | ------------ | ------------ | ---- |
| AAAA | `@`  | `100::`      | Proxied      | Auto |

`100::` はWorkerをオリジンとして使うための予約済みアドレスです。DNSレコード作成後に
`un-fra.me` が解決できることを確認し、必要なら `cf:deploy` を再実行します。
