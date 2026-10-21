# Web と Local Editor の責務分離

実装済み。現行の責務・コマンドは [Architecture](../../ARCHITECTURE.md)、[Web](../../app/web/README.md)、[Local Editor](../../app/local-editor/README.md)、[CLI](../../packages/unframe-cli/ARCHITECTURE.md) を参照する。

Web は認証・公開済み Dist 確認・ルーム作成、Local Editor は Source 編集・Unity Preview・CLI 経由の公開を担当する。Session は作成時の公開版を原子的に固定し、保存された `publicationFence` を返す。新しい Room 永続リソースや Web から localhost を操作する経路は追加しない。

## 残る検証

- 対象の配信環境で認証・公開済み Dist 確認・ルーム作成をブラウザー検証し、cookie／CORS、実 Google OAuth・メール確認と callback を確認する。配信先とアカウントを定めて実施する。Workers dry-run と seed 済みローカル試験をこの成功の証拠にしない。

ローカル統合試験の credential を含む実行 directory は共有しない。Quest 実機・クラウド配信の成功はローカル検証に含めない。
