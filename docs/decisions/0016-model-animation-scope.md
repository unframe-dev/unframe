# ADR-0016: モデル内蔵アニメーションの範囲を定める

- **Status**: Accepted（機能範囲と責務。詳細 schema / wire は Presentation v2）
- **Date**: 2026-09-15
- **Related**: [Presentation Architecture](../presentation/ARCHITECTURE.md), [ADR-0015](./0015-presentation-definition-artifact-boundaries.md), [ADR-0007](./0007-timeline-runtime-run-wire-contract.md)

## Context

既存 Timeline は Spatial Node 全体の transform / opacity を制御する。人物や機械など、モデル内部の動きを再生するクリップは別の契約を必要とする。

## Decision

- モデル素材に含まれるアニメーションクリップの再生を対象に含める。再生・停止・一時停止・再開、ループ、速度指定、即時切り替え、クロスフェードを扱う。
- 再生状態は ModelNode ごとに独立する。同じ素材を参照する別 ModelNode も、異なるクリップや時刻で同時に再生できる。
- 通常は一つの ModelNode で一つのクリップを評価する。クロスフェード中だけ移行元・移行先の二つを評価する。
- 自然終了時はクリップの最終姿勢を保持する。明示停止時は停止要求を適用した時点の姿勢を保持する。
- クロスフェード中に別クリップの再生・切り替えを要求した場合は拒否し、自動 queue しない。
- 部位マスク、アニメーションレイヤー、加算合成による同一モデル内の重ね合わせはプロジェクトの対象外とし、予約 field や拡張口を設けない。
- クリップはモデル内部の姿勢を更新する。build 時に root motion を除去または無効化し、ModelNode の位置・回転へ適用しない。安全に変換・検証できない素材は build で拒否する。ModelNode 全体の transform は既存の Node 操作 / Timeline が所有し、内蔵クリップと並行して実行できる。具体的な変換手法と対象素材形式は後続で決める。

### Definition と Runtime の分離

Definition は対象 ModelNode と使用するクリップ・再生条件を意味的に参照する。素材とクリップの対応は公開物に固定し、Unity の実行時 object ID を使用しない。

Runtime Core が再生・切り替え等を確定し、Unity は配信済みクリップと canonical な再生状態・pause-aware logical time から内部姿勢を評価する。通常の同期は骨格の各関節値を毎 frame 配信する方式にしない。途中参加・再接続・Session pause / resume でも同じ再生状態から表示を復元できる契約とする。

再生状態には対象、クリップ、再生位置の基準、速度、ループを、クロスフェード中には移行元・移行先と遷移の基準を含める。自然終了または明示停止で Run を除去した後も保持姿勢を途中参加・再接続で復元できる情報を canonical state に残す。具体的な field、Action、Run、Event、Snapshot の追加は後続の契約で定義し、既存 Timeline / Video の wire がそのままモデルクリップを扱うとはみなさない。

## Consequences

空間配置と内部姿勢の書き込み先が分かれ、歩行クリップと移動 Timeline を組み合わせられる。足滑りなどの見た目は、クリップ速度と移動量を合わせて検証する必要がある。root motion を位置移動の正本とする素材を、そのまま配置制御へ使用することはできない。

通常時の一クリップと遷移時の二クリップに制限するため、歩行と上半身の動きを独立したレイヤーで重ねる表現は扱わない。

## Adoption and Follow-ups

現行 Model loader、Presentation schema、Runtime protocol にこの機能が実装済みとは扱わない。実装時に再生・pause / resume・自然終了 / 明示停止の姿勢保持・切り替え・crossfade 中の要求拒否・途中参加の fixture と、ModelNode transform をクリップが変更しないことを検証する。

配布形式、クリップ ID の対応、ループ・完了通知、保持姿勢と crossfade 停止後の切り替えは [Presentation Data Model](../presentation/DATA_MODEL.md) に従う。形式別 profile / resource budget と Action / Run / Event / Snapshot の schema / wire も同契約に定義する。後続の実装は importer、root motion 変換・検証、Runtime と consumer の接続である。対象外のレイヤーや合成機能でこれらを回避しない。
