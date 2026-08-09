# Unframe Web Editor

`app/web` は、3D モデルとテキストをスライド上で編集し、同じブラウザの読み取り専用 Viewer へ確定操作を共有する React SPA です。現在は `demo` fixture の vertical slice であり、API、認証、アップロード、永続サーバー保存は接続していません。

## 現在の実装

- React 19.2、MUI v9、TanStack Router、Zustand、Zod、React Hook Form
- React Three Fiber / Drei による GLB 表示、選択、移動、回転、拡縮
- serializable command と revision に基づく Undo / Redo
- `BroadcastChannel` と `localStorage` snapshot による同一ブラウザ内の Editor / Viewer 同期
- `/editor` basepath と Cloudflare Workers Static Assets の SPA fallback
- Vitest、Testing Library、Playwright Chromium による unit / component / E2E test

次の機能は未実装です。

- Presentation API とサーバー永続化
- 認証、認可、共同編集、競合解決
- asset upload、変換、R2 配信 URL の解決
- 複数ブラウザや複数端末へのリアルタイム配信
- Cloudflare への自動デプロイ workflow

## セットアップと起動

リポジトリ root で次を実行します。

```bash
nix run .#setup
pnpm --filter @unframe/web run dev
```

開発 URL は `http://localhost:5173/editor/` です。root の `nix run .#dev` は server と LP だけを起動し、Web Editor は起動しません。

利用できる fixture route は次のとおりです。

| URL                                                | 用途                |
| -------------------------------------------------- | ------------------- |
| `/editor/`                                         | fixture の入口      |
| `/editor/presentations/demo/edit?panel=properties` | Editor              |
| `/editor/presentations/demo/view`                  | 読み取り専用 Viewer |

## 構成

| 領域                       | 責務                                                        |
| -------------------------- | ----------------------------------------------------------- |
| `src/document/`            | versioned document schema、migration、serializer、fixture   |
| `src/editor/commands/`     | serializable command の検証と適用                           |
| `src/editor/history/`      | inverse command による Undo / Redo                          |
| `src/editor/session/`      | 選択、tool、panel、grid、snap などの一時 UI state           |
| `src/viewer/presentation/` | Editor / Viewer 共通の 3D scene と error fallback           |
| `src/viewer/stream/`       | revision event、snapshot、同一ブラウザ内配信                |
| `src/routes/`              | Home、Editor、Viewer の画面 shell                           |
| `worker/`                  | `/editor` prefix を Static Assets 用 path へ変換する Worker |

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

`wrangler.toml` は次の path contract を持ちます。

```text
/editor/assets/...  -> /assets/...
/editor/foo         -> /foo -> SPA index fallback
```

`un-fra.me/editor` と `un-fra.me/editor/*` を LP より具体的な Worker route として設定し、Vite の `base` と Router の `basepath` も `/editor` に揃えています。設定変更後は binding 型を再生成してください。

```bash
pnpm --filter @unframe/web run cf:types
```

production build 後、Vite plugin が `dist/unframe_web_editor/wrangler.json` と `dist/client` を生成します。ローカルの Cloudflare preview は生成済み設定を使います。

```bash
pnpm --filter @unframe/web run build
pnpm --dir app/web exec wrangler dev --config dist/unframe_web_editor/wrangler.json
```

NixOS で配布版 `workerd` を実行するには、host 側で `programs.nix-ld.enable` が必要です。このリポジトリにはデプロイ workflow がないため、公開操作は品質ゲートに含めていません。
