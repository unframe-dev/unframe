# Unframe Web Editor

`app/web` は、空間プレゼンテーションを管理・編集する React SPA です。Home の一覧と新規作成は現在、画面確認用の mock repository を使用しており、Control Plane の Presentation API には接続しません。現在の Editor は `demo` fixture を使う移行前の POC であり、永続モデルの正本ではありません。Device Authorization のブラウザ承認画面は Control Plane の Better Auth に接続しますが、Presentation の取得・保存、アップロードはまだ Editor に接続していません。目標境界は [`ARCHITECTURE.md`](./ARCHITECTURE.md) を参照してください。

## 現在の実装

- React 19.2、Tailwind CSS v4、shadcn/ui（Base UI）、TanStack Router、Zustand、Zod、React Hook Form
- React Three Fiber / Drei による GLB 表示、選択、移動、回転、拡縮
- serializable command と revision に基づく Undo / Redo
- TanStack Query と mock repository による Presentation 一覧・作成（Editor への遷移は未接続）
- `/login`、`/signup`、`/recover` と `/recover/reset?token=` の Better Auth browser flow
- `/settings/profile` の名前更新と、`/settings/security` の password / TOTP / session 操作
- `/home`、`/devices`、`/rooms` の折り畳み可能なアプリケーションナビゲーションと、設定内ナビゲーション
- root-based routing と Cloudflare Workers Static Assets の SPA fallback
- `/device` の Device Authorization 検証・承認・拒否と Google ログインへの復帰 URL 保持
- Vitest、Testing Library、Playwright Chromium による unit / component / E2E test

次の機能は未実装です。

- Presentation の取得・更新・削除と Editor のサーバー永続化
- editor の認証、認可、共同編集、競合解決
- asset upload、変換、R2 配信 URL の解決
- 複数ブラウザや複数端末へのリアルタイム配信
- Cloudflare への自動デプロイ workflow

## セットアップと起動

リポジトリ root で次を実行します。

```bash
nix run .#setup
pnpm --filter @unframe/web run dev
```

開発 URL は `http://localhost:5173/` です。Web Editor は package の `dev` script から起動します。

利用できる fixture route は次のとおりです。

| URL                                         | 用途                                |
| ------------------------------------------- | ----------------------------------- |
| `/home/`                                    | 認証必須の Presentation 一覧        |
| `/devices/`、`/rooms/`                      | デバイス・ルーム管理の準備画面      |
| `/editor/demo/?panel=properties`            | 認証必須の POC Editor               |
| `/device/?user_code=ABCD-EFGH`              | Device Authorization のブラウザ承認 |
| `/login/`、`/signup/`、`/recover/`          | public authentication routes        |
| `/settings/profile/`、`/settings/security/` | account settings                    |

認証 guard はローカル session setup の調整中のため一時的に無効化しています。復帰時は application route の `beforeLoad` で、未認証を LP 所有の `/` へ外部遷移させます。

## 構成

| 領域                       | 責務                                                      |
| -------------------------- | --------------------------------------------------------- |
| `src/document/`            | versioned document schema、migration、serializer、fixture |
| `src/editor/commands/`     | serializable command の検証と適用                         |
| `src/editor/history/`      | inverse command による Undo / Redo                        |
| `src/editor/session/`      | 選択、tool、panel、grid、snap などの一時 UI state         |
| `src/viewer/presentation/` | POC Editor が利用する 3D scene と error fallback          |
| `src/viewer/stream/`       | 移行前 POC の revision event と browser snapshot          |
| `src/routes/`              | Home、Editor、Device Authorization の画面 shell           |
| `worker/`                  | root-based request を Static Assets へ渡す Worker         |

保存対象は `PresentationDocument` だけです。選択状態や gizmo の drag 中 state は保存しません。GLB の runtime URL も document へ保存せず、`AssetResolver` が asset ID から解決します。

## 検証

狭い検証から実行し、完了時は root の品質ゲートも実行します。

```bash
pnpm --filter @unframe/web run check
pnpm --filter @unframe/web run test
pnpm --filter @unframe/web run build
pnpm --filter @unframe/web run test:e2e
nix run .#web
nix run .#check
```

`nix run .#web` は typecheck、unit/component test、production build を担当します。Playwright E2E は別コマンドで実行し、Web CI では Chromium を準備した後に必須 gate として実行します。E2E は software WebGL を明示して GLB と gizmo を検証し、WebGL 無効 project では fallback を検証します。NixOS ではシステムの Google Chrome を自動利用し、それ以外では Playwright が管理する Chromium を利用します。必要なら `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` で実行ファイルを指定できます。

## Cloudflare 配信

`wrangler.toml` は root-based path contract を持ちます。

```text
/assets/... -> static asset
/foo        -> SPA index fallback
```

Vite の `base` は `/` で、Router に `basepath` は設定しません。本番では LP が `/`、`/news/*`、`/docs/*` を所有し、Web Worker は Application route を配信する構成を sibling infra repository と合わせて設定します。Worker 設定変更後は binding 型を再生成してください。

```bash
pnpm --filter @unframe/web run cf:types
```

production build 後、Vite plugin が `dist/unframe_web_editor/wrangler.json` と `dist/client` を生成します。ローカルの Cloudflare preview は生成済み設定を使います。

```bash
pnpm --filter @unframe/web run build
pnpm --dir app/web exec wrangler dev --config dist/unframe_web_editor/wrangler.json
```

NixOS で配布版 `workerd` を実行するには、host 側で `programs.nix-ld.enable` が必要です。このリポジトリにはデプロイ workflow がないため、公開操作は品質ゲートに含めていません。

## Control Plane の接続先

Device Authorization 画面は `VITE_CONTROL_PLANE_URL` を Control Plane API の origin として使い、未設定時は production の `https://api.un-fra.me` を使います。cookie session を送るため、認証 request は `credentials: "include"` です。Home の Presentation 一覧と新規作成は mock repository 内で完結します。
