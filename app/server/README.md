# Unframe Backend

`app/server/` は、異なる実行環境を持つ二つの backend component を置く親ディレクトリです。Component 間の境界は [ARCHITECTURE.md](./ARCHITECTURE.md)、内部設計は [Control Plane](./control-plane/ARCHITECTURE.md) と [Realtime Backend](./realtime/ARCHITECTURE.md) の各文書を参照してください。

```text
app/server/
├── ARCHITECTURE.md
├── README.md
├── control-plane/
│   └── ARCHITECTURE.md  # Cloudflare Workers / TypeScript / Hono / D1 / R2
├── realtime/
│   ├── ARCHITECTURE.md  # Go / gRPC / Cloud / Venue Edge Runtime
│   └── e2e/            # 実サービスの同期・復旧検証
```

- `control-plane/` の目標責務は認証・認可、durable resource、D1/R2、session bootstrap のauthorityです。
- `realtime/` の目標責務はgRPC接続、session中の一時状態、fan-out、backpressureです。
- 共有境界は `packages/contracts/` の contract です。TypeScript と Go の実装コードは直接共有しません。

旧 Go/Huma/Turso/R2 HTTP API は削除済みです。Control Plane は認証、匿名 Viewer 資格、Presentation / Asset / Session API、Venue Edge の provisioning / registration / assignment と assignment-bound bootstrap を実装しています。Realtime は独立した Go module、Runtime process、lint 設定、Docker build context、品質 task を所有します。v3 Control / State を native gRPC とブラウザ WebSocket で提供し、JWT / JWKS、assignment fencing、Snapshot、replay / resume を共用します。Runtime と永続化の状況は [Realtime Architecture](realtime/ARCHITECTURE.md)、Audience の配信設定は [接続境界](../web/audience/docs/connection-boundaries.md) を参照してください。

## Control Plane

`control-plane/` は独立した pnpm package として Worker entrypoint、Hono application、Better Auth、Presentation / Asset / Session API、D1 migration、R2 adapter、OpenAPI、Workers runtime test を所有します。

Google アカウントを同じメールの既存パスワードアカウントへ自動連携するには、既存アカウントのメール確認を先に完了する必要があります。

```sh
nix run .#control-plane
pnpm --filter @unframe/control-plane run dev
```

`nix run .#control-plane` は binding 型、TypeScript、lint、Workers runtime test、OpenAPI / TypeScript client drift、deploy dry-runを検証します。実環境の resource ID と secret を設定する手順は [`control-plane/README.md`](./control-plane/README.md) を参照してください。

Publication の `buildId` と AssetSet の asset ID は、英数字で始まり、以降は英数字・`.`・`_`・`:`・`-` からなる1〜128文字の単一 storage segment です。`/` は使用できません。R2 署名ではキーを segment ごとに encode し、URL pathname の decode 結果が元のキーと一致しない dot segment などを拒否します。

`PUBLICATION_ASSET_ORIGIN` は任意の HTTPS origin（path・query・credentials なし）です。設定すると、Delivery の素材 URL は同じ Control Plane の `ASSETS` binding を読む `/publication-assets/{presentationId}/{buildId}/{assetId}` へ向き、対象素材と最大5分の期限を `SERVICE_IDENTITY_SECRET` の用途別 HMAC で拘束します。返送前に公開済み build の media type・size・checksum を照合します。未設定時は既存 R2 backend の署名 URL を使用します。ローカル検証では Worker と同じストレージへ接続する HTTPS 入口をこの origin に指定してください。

## Cloud Runtime の起動と準備

運用者は `nix run .#runtime-host` で Cloud Host supervisor を起動します。Host が割り当てに従って Runtime を起動・監視し、稼働確認後に ready を報告します。設定・リース・停止と復旧の挙動は [Realtime の起動手順](realtime/README.md#cloud-host-supervisor) を参照してください。

Console と Quest は `POST /sessions/{id}/runtime-preparation` で準備を要求し、同じ URL の GET が `ready` になるまで待ちます。対象 Session の Presenter または admin が操作でき、準備の再要求は既存割り当てを返します。空いている Host がなければ `409 runtime_unavailable` です。Host を起動してから同じ Session を再試行できます。GET は割り当てを作りません。Cloud VM の作成・TLS 入口の構築は運用者が行います。
