# ADR-0028: Audience の匿名 Viewer とブラウザ接続

## Status

Proposed — 実装・自動検証済み。公開環境とスマートフォンでの受入は未実施。

## Context

Audience は登録・ログイン操作なしでルームコードから参加する。既存のログイン資格と gRPC 双方向通信だけでは、このブラウザ経路を提供できない。

## Decision

- Control Plane はルームコードで匿名 Viewer を登録し、Session に限定した bearer 資格を発行する。未検証の backing user と専用資格テーブルで既存 participant の参照整合性を保つ。通常のログイン identity へ昇格させない。
- API 資格は1時間、更新可能期間は初回発行から24時間とする。更新は旧 token を無効化し、ブラウザはメモリだけに保持する。これは運用上の初期方針であり、端末性能の保証ではない。
- Audience profile は実装済みの PNG・opaque H.264・自己完結 GLB を選ぶ。対応機能・資源予算・通信契約versionを含む共有定義の内容ハッシュをIDとし、AudienceとControl Planeで同じ定義を使う。予算は受理上限であり端末性能の測定値ではない。native-ui、Local Overlay、Anchor 表示は拒否する。
- Realtime は同じポートで native gRPC と WebSocket を受け、同じ認証・assignment・Runtime サービスを使う。詳細は [Browser Realtime transport](../../packages/contracts/browser-realtime.md) を正本とする。ブラウザの Cookie 認証や URL token は採用しない。
- Audience は新規 Control 接続で Snapshot を取得する。素材適用後かつ State 接続後に Ready を送る。State 欠落は nonce 再発行による State 再接続、Control 欠落・資格交換は新 Snapshot で復帰する。

## Consequences

通常の管理認証を緩和せず、既存の配信と進行の意味論を共用できる。ブラウザには gRPC を直接使う経路を設けず、別の JSON ページ同期 API も作らない。

公開時は migration と origin allowlist、HTTPS ingress の WebSocket upgrade、素材 CORS の設定が必要になる。API 資格の失効は新しい HTTP 要求を止める。発行済み Runtime JWT の即時取り消しは行わず、その JWT の期限または assignment 終了までを上限とする。Audience の退出は自身の socket を閉じる。

## Adoption and Exceptions

匿名資格の HTTP 結合テスト、実 socket の認証・Ready・nonce・期限テスト、Audience の Runtime 結合テストで境界を確認する。TLS・素材配信・実機負荷は公開環境で別途受入する。方式や権限を変更する場合は本 ADR と共有契約を更新してレビューする。
