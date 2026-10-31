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
| Console（WIP）              | 認証、Dist の検証・公開、ルーム作成                    | React 19                                         |
| Local Editor（WIP）         | Source 編集、build、Unity Preview、CLI 経由の公開      | React 19 / CLI                                   |
| Audience Web XR（WIP）      | 匿名ルーム参加、会場位置合わせ、プレゼン視聴           | React / 8th Wall / Three.js                      |
| Control Plane（WIP）        | 認証・認可、durable resource、asset、session bootstrap | Cloudflare Workers / TypeScript / Hono / D1 / R2 |
| Realtime Backend（WIP）     | session 中の低遅延状態同期                             | Go / gRPC / container                            |
| Unity MR Application（WIP） | MR 表示と realtime session 参加                        | Unity / C#                                       |
| Landing Page（WIP）         | プロダクト紹介とドキュメント                           | SvelteKit                                        |

`app/server/` は Control Plane と Realtime Backend の親ディレクトリです。旧 Go/Huma/Turso/R2 HTTP API は削除済みで、各 component は独立した実行・依存・deployment 単位です。Component 間の境界は [app/server/ARCHITECTURE.md](./app/server/ARCHITECTURE.md)、内部設計は [Control Plane](./app/server/control-plane/ARCHITECTURE.md) と [Realtime Backend](./app/server/realtime/ARCHITECTURE.md) の各文書を参照してください。

Control Plane の OpenAPI は `packages/contracts/` に出力し、Realtime の Protocol Buffers は同ディレクトリの `proto/` を正本とします。Go と C# の consumer は生成済みです。Unity は専用の生成 Realtime client を使用し、`packages/api-client-csharp/` の Control Plane client は Unity に未接続です。

## 現在のステータス

`app/` 配下のアプリケーションは WIP です。Control Plane は認証、Presentation / Asset API、Session lifecycle と Realtime bootstrap を実装しています。Realtime Backend は認証付き gRPC / WebSocket の Control・State 接続、Runtime snapshot、replay / resume、Control Plane への checkpoint・completion 通知を実装しています。Web は認証・Dist の検証・公開・ルーム作成を担当し、Local Editor はローカル Source の編集・Unity Preview と CLI 経由の公開を担当します。Unity は MR 描画と生成 Realtime client による session 参加・Runtime 受信を実装しています。変換 pipeline と background job は未実装です。

## リポジトリ

```text
app/
├── web/
│   ├── console/      認証・Dist 検証・公開・ルーム作成
│   ├── local-editor/ ローカル Source 編集・Unity Preview
│   ├── audience/     観客向け Web XR の参加・視聴
│   └── lp/           Landing Page
├── server/    Control Plane / Realtime Backend
└── unity/     Unity ベースの MR Application

packages/      契約境界、API client、共有設定
docs/          アーキテクチャ、設計判断、ドキュメント
```

`app/web/` 配下の4アプリは、それぞれ独立した package・ビルド・起動設定を持ちます。管理画面は [Console README](./app/web/console/README.md)、ローカル編集は [Local Editor README](./app/web/local-editor/README.md) を参照してください。

Audience の検査は `nix run .#audience`、開発サーバーは `nix run .#audience -- dev` で実行します。匿名 Viewer のルーム参加と Runtime 受信によるライブ視聴を実装済みで、公開環境とスマートフォンでの総合受入は未実施です。SDK 配置と実機検証は [Audience README](./app/web/audience/README.md) を参照してください。

## ドキュメント

- [アーキテクチャ](./ARCHITECTURE.md)
- [Backend アーキテクチャ](./app/server/ARCHITECTURE.md)
- [Control Plane アーキテクチャ](./app/server/control-plane/ARCHITECTURE.md)
- [Realtime Backend アーキテクチャ](./app/server/realtime/ARCHITECTURE.md)
- [開発・コントリビューションガイド](./CONTRIBUTING.md)
- [設計判断（ADR）](./docs/decisions/)
- [Presentation Architecture](docs/packages/ARCHITECTURE.md)
