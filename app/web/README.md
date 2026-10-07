# Unframe Web Editor

`app/web` はローカル Source を編集する React UI と、認証・Device Authorization・account settings の Web application を持ちます。ローカル Editor は CLI Host から配信し、Source と lock を正本に保存します。Dev／Dist Preview は共通 Unity renderer の WebGL build を使います。設計と公開条件は [Local Editor の実装契約](../../docs/packages/LOCAL_EDITOR_DESIGN.md) を参照してください。

## Local Editor の起動

Linux、project 指定、固定 Browser の provision、利用可能な Unity Editor の WebGL module と license が必要です。`UNITY_EDITOR` は `ProjectVersion.txt` に対応する実行ファイルを指定できます。未指定時は Unity Hub の標準配置を探します。

リポジトリ root で UI と Preview player を生成し、絶対パスの project を開きます。

```bash
nix run .#setup
nix develop --command scripts/dev/install-presentation-browser.sh
nix run .#unity-preview
nix develop --command pnpm --filter @unframe/web build:editor
nix develop --command scripts/dev/opaque-capture-scope.sh pnpm --filter @unframe/unframe-cli presentation author /absolute/path/to/project
```

CLI が開く Editor はログインなしで利用できます。Inspector は対応する React scene の scalar Props と host Transform を保存し、同一 session の Undo／Redo を扱います。編集 metadata がない Source は外部 editor で保存し、診断と Preview を利用します。旧 demo／localStorage 文書と React 3D canvas は編集経路から撤去しました。

Dev Preview は保存済み revision を自動 build し、`.unframe/preview/` に生成します。「本番 build」は `dist` を更新し、Dist Preview は現在の固定 generation を再 build せず読み込みます。build／load 失敗時は前の正常 scene を保ち、保存済み Source は巻き戻しません。未保存の Inspector buffer は Preview 入力に含めません。

公開には `UNFRAME_CONTROL_PLANE_URL`、`UNFRAME_WEB_ORIGIN`、`UNFRAME_DEVICE_CLIENT_ID` を Host 起動時にすべて設定します。origin は HTTPS、または loopback HTTP を指定します。承認画面は設定済み Web origin の `/device` で開き、bearer と `device_code` は Host のメモリーだけに保持します。公開は Unity が commit を完了した Dist と現在の `dist` が一致する場合だけ開始し、受付後は upload 元を固定します。

## Web application

```bash
pnpm --filter @unframe/web run dev
```

開発 URL は `http://localhost:5173/` です。Home の一覧・作成は mock repository を使います。`/editor/$presentationId` は Local Host 起動の案内を表示します。Presentation のサーバー永続化や共同編集はこの Web application に接続していません。

`/login`、`/signup`、`/recover`、`/recover/reset?token=`、`/device` は Better Auth のブラウザー flow を扱います。`/settings/profile` と `/settings/security` は account settings、`/devices` と `/rooms` は管理の準備画面です。認証が必要な application route は未認証時に LP 所有の `/` へ遷移します。

| 領域                                         | 責務                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `src/app/`                                   | router、provider、application shell                                  |
| `src/features/editor/`                       | Source Inspector、保存・履歴、Local Host API、Unity Preview、公開 UI |
| `src/features/auth/`・`device/`・`settings/` | 認証、device 承認、account settings                                  |
| `src/features/presentations/`                | Home と mock repository                                              |
| `src/shared/`                                | brand、layout、Base UI に基づく共通 primitives                       |
| `worker/`                                    | root-based request を Static Assets へ渡す Worker                    |

`editor.html` を `build:editor` で `dist-editor` に生成し、CLI Host が配信します。Cloudflare 向け Web application は通常の `build` で生成します。

## 検証

```bash
pnpm --filter @unframe/web run check
pnpm --filter @unframe/web run test
pnpm --filter @unframe/web run build:editor
pnpm --filter @unframe/web run test:e2e
nix run .#local-editor-e2e
```

unit/component test は Source 保存、外部変更、最新 Preview 要求、commit 完了通知、公開認証を検査します。通常の Playwright E2E と Local Editor の実 WebGL／native Unity／実サービス E2E は別の検証です。後者の前提と生成物は [scripts README](../../scripts/README.md#local-editor-と-unity) を参照してください。2026-10-07 に実 WebGL の Structured／Opaque Dev・Dist 描画、contain／alpha と Transform 保存後の画素変化を確認しました。ローカル実 Control Plane／R2／Realtime と native Unity を通す公開 E2E も成功し、Snapshot／StateReady と実画素を確認しました。

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
