# Unframe Web Architecture

`app/web` は、Control Plane を通じて空間プレゼンテーションを管理・編集する React SPA です。この文書は Web の責務、ルート、通信、状態、UI 基盤を定義します。Editor 内部の Group / Step / Cue 操作モデルと画面構成は、別途設計してから追記します。

## Responsibilities

Web は次を担当します。

- Better Auth によるブラウザ認証とアカウント設定
- Presentation の一覧、作成、取得、編集、保存
- Asset の upload、状態確認、preview、download
- Presentation Definition のブラウザ内編集

Web は Unity 用 Session の作成・参加・開始・終了、Realtime Backend への接続、発表中の状態操作を担当しません。

## Routes

本番の `/` は LP が所有します。認証が必要な Web route で session を確認できない場合は、SPA 内の仮画面へ遷移せず `/` を外部 URL として読み直します。

```text
/login/
/signup/
/recover/*
/device/

/home/
/editor/:presentationId/
/settings/profile/
/settings/security/
```

`/device/` は Device Authorization の公開 route です。`/home/`、`/editor/:presentationId/`、`/settings/*` は認証必須です。

## API Boundaries

```text
React route / feature
  -> TanStack Query
  -> @unframe/api-client-typescript
  -> Hono RPC
  -> Control Plane
```

Presentation、Asset、delivery などの product API は Hono RPC を使用します。route component から product API へ直接 `fetch()` しません。Better Auth の endpoint は Better Auth client、R2 の署名付き upload / download は Control Plane が返す request 情報に従う直接 `fetch()` を使用します。

OpenAPI artifact は外部契約と Unity / C# のために維持しますが、Web の product API client として生成 OpenAPI client は使用しません。

## State Ownership

| State                                           | Owner                                |
| ----------------------------------------------- | ------------------------------------ |
| Presentation resource、revision、Asset metadata | TanStack Query                       |
| 編集中の Definition と Undo / Redo              | Editor draft state                   |
| selection、tool、panel、drag 中の値             | Zustand または component local state |
| 3D object、camera、pointer の一時状態           | React Three Fiber / Three.js         |
| form input と validation                        | React Hook Form / Zod                |

保存は Control Plane の revision 条件付き aggregate update に従います。POC の Slide schema と `localStorage` persistence は target contract ではなく、移行中の fixture adapter としてのみ扱います。これらとの後方互換性を理由に Group / Step / Cue の設計を制約しません。

## UI Foundation

- Tailwind CSS v4
- shadcn/ui の Base UI variant
- `@phosphor-icons/react`
- LP と同じ background、foreground、line、night、Blue / Purple / Red のブランド色

shadcn/ui component は必要なものだけ source として追加し、アプリ側で所有します。別の一般 icon library を混在させません。Editor は LP の色とタイポグラフィを共有しますが、巨大見出し、広い marketing spacing、常設の波形を制作画面へ持ち込みません。

`@base-ui/react` の import は `src/shared/ui/` に限定する。`src/app/` は起動と composition のみを持ち、route UI とそのロジックは `src/features/<feature>/` に置く。現行 Editor POC の model、browser persistence、3D canvas も `src/features/editor/` が所有する。

## Domain Boundary

Control Plane の `PresentationDefinition` が永続契約の正本です。Web 独自の Slide document を外部契約にしません。

```text
Presentation
└─ Group
   ├─ Element / Anchored Element Group
   └─ Step
      └─ Cue
         ├─ Trigger
         ├─ Actions / Transition
         └─ Next
```

Editor 内部では、永続 DTO と編集しやすい projection を分けても構いません。ただし変換境界と contract test を設け、URL、R2 object key、runtime session state を Definition へ混入させません。

## Deferred Editor Design

次は Editor 設計で決定します。

- Group / Step / Cue のユーザー向け名称
- 空間配置と進行設計を同一画面に置くか、mode を分けるか
- Web preview の範囲と URL
- command 粒度、autosave、revision conflict の回復
- Element / Asset / Anchor / Zone の navigation と inspector
