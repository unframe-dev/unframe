# Unframe アーキテクチャ

このドキュメントは Unframe モノレポの目標構成を示す一次資料です。Backend component 間の境界は [`app/server/ARCHITECTURE.md`](./app/server/ARCHITECTURE.md)、Control Plane と Realtime Backend の内部設計はそれぞれ [`app/server/control-plane/ARCHITECTURE.md`](./app/server/control-plane/ARCHITECTURE.md) と [`app/server/realtime/ARCHITECTURE.md`](./app/server/realtime/ARCHITECTURE.md)、開発フローは [`CONTRIBUTING.md`](./CONTRIBUTING.md)、個別の判断背景は [`docs/decisions/`](./docs/decisions/) を参照してください。

## 全体像

Unframe は、MR プレゼンテーションをローカル Source から作成し、Unity クライアントで表示するプロダクトです。Backend は durable state を扱う Control Plane と、低遅延の session state を扱う Realtime Backend に分離します。

```mermaid
flowchart LR
  Web["管理 Web"] -->|HTTPS| CP["Control Plane\nWorkers / TypeScript / Hono"]
  Unity["Unity MR Application"] -->|HTTPS| CP
  Unity <-->|gRPC bidi| RT["Realtime Backend\nGo / gRPC"]
  CP --> D1[(D1)]
  CP --> R2[(R2)]
  Editor["Local Editor"] <-->|localhost HTTP| CLI["CLI Host"]
  CLI -->|HTTPS publish| CP
  CLI <-->|signed HTTPS| R2
  Unity <-->|signed HTTPS| R2
  RT -->|checkpoint / completion| CP
```

## ディレクトリ構成

```text
unframe/
├── app/
│   ├── web/
│   │   ├── console/              # React 19 management SPA
│   │   ├── local-editor/         # Local Source editor / Unity Preview
│   │   └── audience/             # React / 8th Wall / Three.js audience viewer
│   ├── server/
│   │   ├── control-plane/        # Workers / TypeScript / Hono / D1 / R2
│   │   ├── realtime/             # Go / gRPC / container
│   │   └── integration/          # Backend component 間 E2E
│   └── unity/                    # Unity MR Application
├── lp/                           # SvelteKit Landing Page
├── packages/
│   ├── contracts/                # 将来の API / protocol contract 境界
│   ├── api-client-csharp/        # C# client 成果物の配置予定地
│   └── config/                   # 共有 TypeScript / Git hook 設定
├── scripts/                      # 開発・CI・ドキュメント同期の実処理
└── docs/                         # ADR・計画・同期ドキュメント
```

## 各コンポーネントの責務

`app/web/` はブラウザー向けアプリの親ディレクトリです。Console、Local Editor、Audience はそれぞれ独立した package・依存関係・ビルド・起動設定を持ちます。

### `app/server/control-plane`

- Cloudflare Workers / TypeScript / Hono を使用する。
- 認証・認可、durable resource、D1/R2、asset lifecycle、session bootstrap の authority を持つ。
- HTTP handler から D1/R2 binding を直接操作せず、application service と adapter を分離する。

### `app/server/realtime`

- Go / gRPC の独立した container application とする。
- Unity との bidirectional stream、session 中の canonical state、fan-out、backpressure を担当する。
- Presenter が認識した入力の有効性、Cue / Action、Timeline / Timer、Step 遷移を確定する。入力世代、共有演出全体の pause、到達済み Step の開始状態への復元は [ADR-0027](./docs/decisions/0027-presenter-recognition-and-runtime-authority.md) の採用仕様であり、[v3 契約](./docs/packages/CONTRACT_PRESENTER_AUTHORITY.md) に反映し、実行側 consumer は移行前である。
- hot path は Control Plane、D1、R2 に依存せず、checkpoint と completion のみを Control Plane へ永続化する。

### `app/web/console`

- React 19 SPA として認証・device 承認、公開済み Dist 確認とルーム作成を担当する。
- Hono RPC client と TanStack Query を通して Control Plane を利用する。

### `app/web/local-editor`

- ローカル Source の編集・保存・履歴、build 要求、Unity Preview と CLI を通す公開操作を担当する。
- 静的成果物は CLI Host が配信し、filesystem・credential・build generation は CLI が所有する。

### `app/web/audience`

- 観客向けWeb XRクライアント。AprilTag 3 `tag36h11`・単一ID 0と8th Wall absolute SLAMによる位置保持と PNG・H.264・GLB の視聴を担う。
- 有効なタグ姿勢を1回で即採用し、確定値には一致待ち・平滑化なし。表示層のみ距離別の上限付き閾値で小揺れを抑え、閾値を超える変化は即反映する。次の有効タグまでSDK座標内で表示を保持する。未検出・曖昧姿勢は前位置を保持し、SDK追跡低下・hidden・停止で非表示にして新しいタグを要求する。
- NORMAL連続5秒後に最大頻度で検出開始。既定は黒外周15cm／余白込み22.5cm。ArUco・各単独比較モード・比較描画・複数タグ用実装は撤去した。
- UI・SDK adapter・検出/姿勢計算・ライブ描画を分離し、ログと明示操作による検出画像保存を残す。ルームコードによる匿名 Viewer 参加と既存 Runtime v3 の Control／State 受信を実装済み。公開環境とスマートフォンでの総合受入は未実施。
- 2026-10-22、ユーザーが現構成を十分な精度と判断しPoCを完了。黒外周150mmで約3.3m、240mmで約5.8mの認識報告を得た。追跡構成を維持してWebアプリ開発へ移行する。定量的な誤差・長時間保持・7m初回認識の目標は未実証。[Audience README の採用方式](./app/web/audience/README.md#採用した方式)を参照する。

### `app/unity`

- Unity / C# で MR 表示と realtime session 参加を担当する。
- Presenter が Gesture / Zone を認識し、認識開始時の Step と入力世代に結び付けて送信する。描画用 Pose の送信と認識を分離し、共有状態の確定は Realtime に委ねる。この採用仕様の実装は未着手であり、現行の生成 client 接続・検証状況は [Unity README](./app/unity/README.md) を参照する。

### `lp`

- SvelteKit + `adapter-static` による静的 Landing Page とする。
- 管理 Web とは deployment と依存関係を分離する。

## 契約生成パイプライン

旧 Go/Huma HTTP API の OpenAPI、生成 TypeScript client、sqlc 生成物は削除済みです。`packages/contracts/` は次の Control Plane OpenAPI と Realtime Protocol Buffers の共有境界として残します。

新しい契約を導入する変更では、同時に次を定義します。

1. source of truth と versioning
2. TypeScript / Go / C# の生成先
3. 手書き adapter との境界
4. consumer の更新手順
5. CI の生成 drift 検査

生成物は手編集せず、実装コードは Backend component 間で共有しません。

## ツールチェインとタスク実行

ツールチェインは Nix flake で固定し、JavaScript workspace は pnpm で管理します。現在の repository-wide entrypoint は次のとおりです。

| 用途                               | コマンド                                                      |
| ---------------------------------- | ------------------------------------------------------------- |
| 開発環境                           | `nix develop`                                                 |
| 依存関係と Git hook のセットアップ | `nix run .#setup`                                             |
| 全体品質ゲート                     | `nix run .#check`                                             |
| Console の検査・修正               | `nix run .#console` / `nix run .#console -- fix`              |
| Local Editor の検査・修正          | `nix run .#local-editor` / `nix run .#local-editor -- fix`    |
| Audience 開発・build preview       | `nix run .#audience -- dev` / `nix run .#audience -- preview` |
| Audience の検査・修正              | `nix run .#audience` / `nix run .#audience -- fix`            |
| LP の検査・修正                    | `nix run .#lp` / `nix run .#lp -- fix`                        |
| flake の評価と formatter 検証      | `nix flake check`                                             |

Control Plane と Realtime の check entrypoint は実装済みです。開発・migration の手順は各 component の README を参照してください。自動 deployment workflow はありません。

### GitHub Actions

- `ci.yml`: 変更領域の検出と必須チェックの集約
- `control-plane.yml`: Control Plane の typecheck / test / deploy dry-run
- `realtime.yml`: Realtime の vet / lint / test / build / race
- `console.yml`: Console の check / test / build / E2E
- `local-editor.yml`: Local Editor の check / Node ロジックテスト / build
- `audience.yml`: Audience の check / test / build（カメラ・SLAM の実機検証は含まない）
- `lp.yml`: LP の test / check / build
- `unity.yml`: Unity の静的検査
- `autofix.yml`: Control Plane / Realtime / Presentation / Console / Local Editor / LP / Audience の format と lint fix

## 移行状況

- [x] 旧 Go/Huma/Turso/R2 HTTP Backend を削除
- [x] 旧 OpenAPI、生成 TypeScript client、sqlc、旧 API ドキュメントを削除
- [x] 旧 Backend 専用の CI・生成・migration・dev entrypoint を削除
- [x] `packages/contracts/` を次の contract を定義するための境界として保持
- [x] Control Plane の HTTP 基盤を `app/server/control-plane/` に実装
- [x] Control Plane の OpenAPI、認証、D1/R2 adapter、Presentation / Asset / Session API を実装
- [x] Realtime Backend の gRPC／ブラウザ WebSocket、JWT 認証、assignment fencing、Control／State、Snapshot／replay／resume を実装
- Runtime と永続化の詳細な実装状況は [Realtime Architecture](./app/server/realtime/ARCHITECTURE.md) を参照
- [ ] component 間 E2E を `app/server/integration/` に実装
