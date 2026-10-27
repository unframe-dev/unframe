# Audience 接続の引き継ぎ

更新日: 2026-10-27。PR #167 の Backend・共有契約・Audience adapter を接続した。

## 実装

- 匿名 Viewer の発行・更新・失効と Session 限定の認可。管理・進行操作には使用できない。
- `audience-web-v1` の登録。PNG・opaque H.264・自己完結 GLB の選択とクライアント予算検査。
- 既存 v3 Protobuf を使う WebSocket Control／State。認証・assignment・nonce・Ready・Runtime は native gRPC と共用。
- Audience の HTTP 資格管理、Snapshot／素材準備後の Ready、進行適用、期限更新、切断・再同期・退出。
- main の Runtime v3 と Step restore に追従。Anchor 表示や Presenter 操作は未対応として拒否する。

接続手順・設定・資格と復帰の寿命は [接続境界](connection-boundaries.md)、採用理由は [ADR-0028](../../../../docs/decisions/0028-audience-anonymous-browser-connection.md) を参照。

## 公開前の受入

1. migration・origin allowlist・HTTPS／WebSocket upgrade・素材 CORS を設定する。
2. 公開済み Presentation と有効な Runtime assignment を用意し、新規ブラウザからログインなしで参加する。
3. PNG／動画／GLB の途中参加、登壇側の進行・停止・seek、切断復帰、資格更新・期限切れを確認する。
4. 会場タグの実寸・設置 pose・presentationToVenue を登壇側と合わせる。
5. iPhone Safari／Android Chrome でカメラ・動画・音声・GLB、背景復帰、繰り返し入退出、長時間視聴を測定する。

自動テストは HTTP と実 socket の境界、Runtime の描画・状態適用を確認する。公開環境の配信設定や端末性能を証明するものではない。会場設定の session ごとの配布と通信遅延を補償する時計同期は残る。
