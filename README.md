# Unframe

Unframe は、MR（Mixed Reality）空間で利用するプレゼンテーションを Web で作成し、Unity アプリケーションで表示するためのプラットフォームです。

## プロダクト概要

3D モデルや画像、テキストをプレゼンテーションの要素として MR 空間へ配置し、発表者の位置移動、身体動作、コントローラー入力に応じて表示・移動・変形させます。一つの MR 空間の中で発表内容を段階的に展開することを目指します。

```text
Web Editor
    │ プレゼンテーションを作成・編集
    ▼
Control Plane
    │ durable data、asset、session bootstrap
    ▼
Unity MR Application
    │ asset を取得し、Realtime session へ参加
    ▼
MR デバイス上でプレゼンテーションを表示
```

## 構成要素

| コンポーネント | 役割 | 技術 |
| --- | --- | --- |
| Web Editor（WIP） | プレゼンテーションの作成・編集 | React 19 |
| Control Plane（WIP） | 認証・認可、durable resource、asset、session bootstrap | Cloudflare Workers / TypeScript / Hono / D1 / R2 |
| Realtime Backend（WIP） | session 中の低遅延状態同期 | Go / gRPC / container |
| Unity MR Application（WIP） | MR 表示と realtime session 参加 | Unity / C# |
| Landing Page（WIP） | プロダクト紹介とドキュメント | SvelteKit |

`app/server/` は Control Plane と Realtime Backend の親ディレクトリです。旧 Go/Huma/Turso/R2 HTTP API は削除済みで、各 component の実装は独立して追加されます。設計の正本は [app/server/ARCHITECTURE.md](./app/server/ARCHITECTURE.md) を参照してください。

旧 OpenAPI contract と TypeScript client は削除済みです。新しい Control Plane と Realtime の contract は、それぞれの実装と同時に定義します。

## 現在のステータス

`app/` 配下のアプリケーションと `lp/` は WIP です。Control Plane は Workers / Hono の HTTP 境界と `GET /health`、Web Editor は編集機能の scaffold、Unity はローカル JSON importer と presentation element loader の scaffold を実装しています。認証、認可、resource API、realtime 同期、変換 pipeline、background job は未実装です。

## リポジトリ

```text
app/
├── web/       React ベースの Web Editor
├── server/    Control Plane / Realtime Backend
└── unity/     Unity ベースの MR Application

lp/            Landing Page
packages/      契約境界、C# client placeholder、共有設定
docs/          アーキテクチャ、設計判断、ドキュメント
```

## ドキュメント

- [アーキテクチャ](./ARCHITECTURE.md)
- [Backend アーキテクチャ](./app/server/ARCHITECTURE.md)
- [開発・コントリビューションガイド](./CONTRIBUTING.md)
- [設計判断（ADR）](./docs/decisions/)
- [空間プレゼンテーションのドメインモデル（ADR-0005）](./docs/decisions/0005-spatial-presentation-domain-model.md)
