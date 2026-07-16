# ADR-0003: Unframe モノレポを Go backend と分離フロントエンドへ全面刷新する

- **Status**: Accepted
- **Date**: 2026-07-13
- **Deciders**: Unframe 開発チーム
- **関連**: [ADR-0001](./0001-backend-mvp-design.md), [ADR-0002](./0002-supabase-storage-and-db.md)

## Context

既存の Unframe は Hono + Cloudflare Workers + Drizzle + Supabase の backend、React の Web アプリ、Zod ベースの共有契約で構成されている。MVP を短期間で成立させるには有効だった一方、API 定義・DB スキーマ・クライアント型が複数箇所に分散し、実行環境にも強く結合している。また、プロダクトサイトと編集アプリが同じアプリケーションに置かれており、それぞれに適した配信方式を選びにくい。

次の開発段階では、API 契約を生成パイプラインで一意に保ち、backend の状態・ロジック・外部サービス境界を明確に分離する必要がある。既存実装への段階的な互換層は二重管理を長期化させるため、Unity クライアント `apps/mr` を対象外として、その他を完全置換する。

## Decision

`apps/mr` を維持し、それ以外のアプリケーションと API 契約を次の構成へ全面刷新する。

- `apps/backend` は Go 1.25、Huma v2、Chi、sqlc で実装する。
- DB は Turso/libSQL とし、マイグレーションは goose、テストは modernc.org/sqlite を利用する。
- オブジェクトストレージは Cloudflare R2 とし、backend から S3 互換の署名 URL を発行する。
- Huma の API 定義を唯一の編集点とし、生成した `packages/contracts/openapi.yaml` をコミット済みの契約成果物とする。
- TypeScript クライアント型は OpenAPI から `openapi-typescript` で生成し、`openapi-fetch` の薄いラッパを提供する。
- 既存 `apps/web` は廃止し、React 19 SPA の `apps/app` と SvelteKit SSG の `apps/site` に分離する。
- 既存 API の機能仕様と `{error:{code,message,details?}}` のエラー包絡は引き継ぐが、旧実装との後方互換レイヤーは作らない。
- 旧 `apps/backend`、`apps/web`、`packages/contracts` は同一フェーズで削除し、生成元と利用側が混在する期間を作らない。
- CI では Go、TypeScript、各アプリの検査に加え、OpenAPI・生成型・sqlc 生成物の drift を検出する。

## Alternatives Considered

### Option A: 既存 TypeScript backend を段階的に移行する

却下した。新旧 runtime、DB アクセス、契約定義を並行維持する必要があり、互換層と二重テストのコストが増える。今回の刷新では main 上で一貫した新設計へ移行する方が、最終状態を単純に保てる。

### Option B: OpenAPI YAML を手書きの唯一の編集点にする

却下した。Huma は Go の型と操作定義から OpenAPI を生成するため、YAML も手編集すると Go のバリデーション定義との二重管理になる。Go の API 定義から決定的に生成し、コミットした YAML を他言語が消費する流れを採用する。

### Option C: Web サイトと編集アプリを単一フロントエンドに残す

却下した。静的配信を中心とする LP・ドキュメントと、状態量が多い 3D 編集 SPA では、ビルド・ルーティング・依存関係・テスト戦略が異なる。独立したアプリに分けることで、変更範囲とデプロイ単位を明確にする。

## Consequences

- **Positive**: API の編集点が Go に集約され、OpenAPI、TypeScript 型、クライアントの drift を CI で検出できる。
- **Positive**: service、DB、storage の境界が明確になり、in-memory SQLite と fake storage を用いた統合テストが可能になる。
- **Positive**: LP・ドキュメントとエディタを別々に最適化できる。
- **Negative**: 旧 TypeScript 実装は再利用せず、backend とフロントエンドを実装し直す初期コストが発生する。
- **Negative**: modernc SQLite と Turso/libSQL の差異、Huma の独自エラー包絡、OpenAPI 出力の決定性を継続して検証する必要がある。
- **Neutral**: `apps/mr` とその Unity CI は今回の刷新対象外である。
- **Neutral**: deploy workflow は追加せず、Cloud Run または Fly.io への配備方式は別途決定する。

## Follow-ups

- [ ] Huma + Chi の骨格と `/health` を TDD で実装する。
- [ ] OpenAPI と TypeScript 契約生成、および drift check を CI に追加する。
- [ ] goose/sqlc、Turso 接続、R2 presigner を実装する。
- [ ] presentations、slides、assets、manifest の機能等価性をテストで固定する。
- [ ] `apps/app` と `apps/site` をそれぞれ新規実装する。
- [ ] 配備先と本番 migration 手順を別の ADR で決定する。
