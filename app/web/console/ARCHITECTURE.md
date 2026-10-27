# Unframe Web Architecture

`app/web/console` は Control Plane の公開情報を確認し、ルームを作成する React SPA です。Source の編集と公開操作は [Local Editor](../local-editor/README.md) と CLI が所有します。

## 責務と通信

```text
React feature → TanStack Query → @unframe/api-client-typescript → Hono RPC → Control Plane
```

- Better Auth client による認証・アカウント設定と device 承認。
- Presentation 一覧と最新 publication の取得。公開情報のない状態と認証・権限・通信エラーを区別する。
- 公開済み Presentation の Session 作成と結果表示。Session は「ルーム」と表示するが、既存の Session を永続化し、別の Room リソースは作らない。

Worker は `ASSETS.fetch` で SPA を配信します。ブラウザーから localhost の filesystem API を操作せず、CLI、Compiler、Unity player を通常 Web に組み込みません。

## 状態と公開版

サーバーの Presentation、publication、Session は TanStack Query で取得し、画面選択とフォーム入力は component が保持します。publication の参照は表示範囲に限定します。

Session 作成は `{ presentationId }` を送り、Control Plane が作成時の最新公開版を原子的に固定します。結果には保存された `publicationFence` を表示し、選択時の値で代替しません。公開版のない新規 Session は `409 conflict` になります。旧 Session に公開固定値がない場合は `null` です。

Join Code は作成応答だけで受け取り、メモリだけに保持します。URL、ログ、ブラウザー永続ストレージには保存しません。応答不明の作成は自動再送しません。

## 配信と UI

`/home`、`/rooms`、`/devices`、`/settings/*` は認証必須、`/device` は公開承認 route です。本番の `/` は LP が所有します。未認証の application route は LP の `/` へ外部遷移します。

UI は Tailwind CSS v4、Base UI と `@phosphor-icons/react` を使います。`@base-ui/react` の import は `src/shared/ui/` に限定し、`src/app/` は composition、`src/features/` は機能、`src/shared/` は共通 primitives を所有します。

ルーム参加、Runtime 配置、発表開始・停止、ブラウザーでの Source 編集やアップロードは対象外です。
