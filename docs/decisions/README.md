# 設計判断（ADR）

このディレクトリ直下には有効な ADR、[archived/](./archived/README.md) には現在の契約と衝突する旧 ADR を置く。アーカイブ理由と、継続する規則の参照先はアーカイブ一覧で確認する。実装の未完了や後続スライスでの機能追加だけでは、元の決定を失効させない。

現行の契約を確認する入口:

- 全体の責務と進行モデル: [Presentation Architecture](../packages/ARCHITECTURE.md)
- Definition・描画成果物・素材集合: [Data model](../packages/DATA_MODEL.md)
- 配信・Runtime・wire version: [Delivery / Runtime contract](../packages/CONTRACT_RUNTIME.md)
- 静的 TypeScript / JSX: [Structured Authoring Contract](../packages/AUTHORING_CONTRACT.md)
- 生成 consumer の命名と責務: [ADR-0024](./0024-canonical-presentation-contract-names.md)
- Publication HTTP と Unity transport: [ADR-0025](./0025-m6-application-transport-boundaries.md)

ADR-0009〜0011 は、ADR-0021 による Hit Region 境界の更新を本文へ反映済みのため保持する。Semantic Tree、座標、partition の残る規則は引き続き有効である。ADR-0017 の M3A 範囲も履歴上のスライス範囲として保持し、現行 Structured graph の拡張は ADR-0022 と Authoring Contract に従う。

同じ番号を持っていた二つの ADR-0024 は、契約命名を ADR-0024、Publication HTTP / Unity transport を ADR-0025 として区別する。
