# Unframe

Unframe は、MR（Mixed Reality）空間で利用するプレゼンテーションを Web で作成し、Unity アプリケーションで表示するためのプラットフォームです。

## プロダクト概要

従来のスライド資料では表現しにくい 3D モデルや画像、テキストをプレゼンテーションの要素として配置し、MR デバイス上の空間で表示します。

Unframe は次の流れで利用します。

```text
Web Editor
    │ プレゼンテーションを作成・編集
    ▼
Backend API
    │ プレゼンテーションとアセットを保存し、MR 用 manifest を提供
    ▼
Unity MR Application
    │ manifest とアセットを取得して MR 空間に描画
    ▼
MR デバイス上でプレゼンテーションを表示
```

## 構成要素

| コンポーネント              | 役割                                                           | 技術            |
| --------------------------- | -------------------------------------------------------------- | --------------- |
| Web Editor（WIP）           | プレゼンテーションの作成・編集                                 | React 19        |
| Backend API（WIP）          | プレゼンテーション、スライド、アセットの保存と manifest の提供 | Go / Huma / Chi |
| Unity MR Application（WIP） | manifest をもとにしたプレゼンテーションの MR 表示              | Unity / C#      |
| Landing Page（WIP）         | プロダクト紹介とドキュメント                                   | SvelteKit       |

## 現在のステータス

`app/` 配下のすべてのアプリケーションと `lp/` は WIP です。現在は MVP の基盤を
構築している段階です。

- Backend API はプレゼンテーション、アセット、MR 用 manifest の基本処理を提供します。
- Web Editor は編集機能の scaffold を実装しています。
- Unity アプリケーションは manifest の取得とプレゼンテーション要素の描画を実装しています。
- 認証、リアルタイム同期、変換パイプライン、バックグラウンド処理は未実装です。
- Landing Page は開発中です。

## リポジトリ

```text
app/
├── web/       React ベースの Web Editor
├── server/    Go ベースの Backend API
└── unity/     Unity ベースの MR Application

lp/            Landing Page
packages/      API 契約、生成クライアント、共有設定
docs/          アーキテクチャ、API、設計判断、ドキュメント
```

## ドキュメント

- [アーキテクチャ](./ARCHITECTURE.md)
- [開発・コントリビューションガイド](./CONTRIBUTING.md)
- [API 契約](./packages/contracts/openapi.yaml)
- [設計判断（ADR）](./docs/decisions/)
