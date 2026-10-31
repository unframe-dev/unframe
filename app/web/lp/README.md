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

Wrangler の設定は `app/web/lp/wrangler.toml` が正とします。初回のみCloudflareへログインします。

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

LP は `un-fra.me` の `/`、`/news`・`/news/*`、`/docs`・`/docs/*` と静的アセット用の
`/_app/*`・`/brand/*`・`/favicon/*` を配信します。その他のパスは Console Worker が配信し、
Header の「試してみる」は同じ origin の `/signup`、「ログイン」は `/login` に進みます。
LP の開発サーバー単独では Console の画面は配信されません。
DNS レコードと Worker route の正本はリポジトリ外の [`infra`](../../../../infra/README.md) Terraform です。

本番のデプロイには、対象ゾーンへのアクセス権を持つCloudflare APIトークン、またはWranglerの
ログインセッションが必要です。

## DNS

このWorkerはCustom DomainではなくRoute方式を使うため、DNSレコードは自動作成されません。
`infra` Terraform の `cloudflare_dns_record.apex_worker` で次のレコードを管理し、Proxy statusを
Proxied（オレンジクラウド）にします。

| Type | Name | IPv6 address | Proxy status | TTL  |
| ---- | ---- | ------------ | ------------ | ---- |
| AAAA | `@`  | `100::`      | Proxied      | Auto |

`100::` はWorkerをオリジンとして使うための予約済みアドレスです。DNSレコード作成後に
`un-fra.me` が解決できることを確認し、必要なら `cf:deploy` を再実行します。
