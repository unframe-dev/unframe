# Unframe

Unframe は、MR（Mixed Reality）空間で利用するプレゼンテーションをローカル Source から作成し、Unity アプリケーションで表示するためのプラットフォームです。

## プロダクト概要

3D モデルや画像、テキストをプレゼンテーションの要素として MR 空間へ配置し、発表者の位置移動、身体動作、コントローラー入力に応じて表示・移動・変形させます。一つの MR 空間の中で発表内容を段階的に展開することを目指します。

```text
Local Editor / CLI
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

| コンポーネント              | 役割                                                   | 技術                                             |
| --------------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| Web（WIP）                  | 認証、公開済み Dist の確認、ルーム作成                 | React 19                                         |
| Local Editor（WIP）         | Source 編集、build、Unity Preview、CLI 経由の公開      | React 19 / CLI                                   |
| Audience Web XR（PoC）      | 観客端末での画像認識・会場位置合わせの検証             | React / 8th Wall / Three.js                      |
| Control Plane（WIP）        | 認証・認可、durable resource、asset、session bootstrap | Cloudflare Workers / TypeScript / Hono / D1 / R2 |
| Realtime Backend（WIP）     | session 中の低遅延状態同期                             | Go / gRPC / container                            |
| Unity MR Application（WIP） | MR 表示と realtime session 参加                        | Unity / C#                                       |
| Landing Page（WIP）         | プロダクト紹介とドキュメント                           | SvelteKit                                        |

`app/server/` は Control Plane と Realtime Backend の親ディレクトリです。旧 Go/Huma/Turso/R2 HTTP API は削除済みで、各 component は独立した実行・依存・deployment 単位です。Component 間の境界は [app/server/ARCHITECTURE.md](./app/server/ARCHITECTURE.md)、内部設計は [Control Plane](./app/server/control-plane/ARCHITECTURE.md) と [Realtime Backend](./app/server/realtime/ARCHITECTURE.md) の各文書を参照してください。

旧 Go HTTP API の OpenAPI と client は削除済みです。現在は Control Plane の OpenAPI / Hono RPC client と Realtime の Protocol Buffers / Go 生成物を各 component の実装から生成し、Unity / C# consumer の生成・接続は未実装です。

## 現在のステータス

`app/` 配下のアプリケーションと `lp/` は WIP です。Control Plane は認証、Presentation / Asset API、Session lifecycle と Realtime bootstrap を実装しています。Realtime Backend は認証付き gRPC 接続と page-change の in-memory fan-out を実装していますが、replay / resume や完全な Runtime 同期は未実装です。Web は認証・公開済み Dist の確認・ルーム作成を担当し、Local Editor はローカル Source の編集・Unity Preview と CLI 経由の公開を担当します。Unity はローカル JSON importer と presentation element loader を実装しています。変換 pipeline と background job は未実装です。

## リポジトリ

```text
app/
├── web/       認証・公開済み Dist 確認・ルーム作成
├── local-editor/ ローカル Source 編集・Unity Preview
├── audience/  観客向け Web XR の位置合わせ PoC
├── server/    Control Plane / Realtime Backend
└── unity/     Unity ベースの MR Application

lp/            Landing Page
packages/      契約境界、C# client placeholder、共有設定
docs/          アーキテクチャ、設計判断、ドキュメント
```

Audience の検査は `nix run .#audience`、開発サーバーは `nix run .#audience -- dev` で実行します。SDK 配置と実機検証は [Audience README](./app/audience/README.md) を参照してください。2026-10-22にユーザー承認で位置保持PoCを完了し、[Webアプリ開発](./docs/plans/audience-web-app-plan.md)へ移行します。ライブ参加は今後実装する機能です。

## ドキュメント

- [アーキテクチャ](./ARCHITECTURE.md)
- [Backend アーキテクチャ](./app/server/ARCHITECTURE.md)
- [Control Plane アーキテクチャ](./app/server/control-plane/ARCHITECTURE.md)
- [Realtime Backend アーキテクチャ](./app/server/realtime/ARCHITECTURE.md)
- [開発・コントリビューションガイド](./CONTRIBUTING.md)
- [設計判断（ADR）](./docs/decisions/)
- [Presentation Architecture](docs/packages/ARCHITECTURE.md)
