# Audience の接続境界

更新日: 2026-10-27。Backend・共有契約・Audience adapter を実装済み。公開環境と実機での総合受入は未実施。

## 接続順

1. `POST /viewer-credentials` に `{joinCode}` を送り、Viewer 登録と匿名 API 資格を取得する。
2. 同資格で `POST /sessions/join`、`POST /sessions/{id}/delivery`、`POST /sessions/{id}/bootstrap` を呼ぶ。Delivery の profile ID は共有のAudience定義から算出する。
3. bootstrap の endpoint origin から `/browser/control` へ接続し、既存 v3 ControlHandshake と Snapshot を受ける。
4. Control の nonce で `/browser/state` を接続する。Snapshot の素材適用と StateConnected を確認後、Snapshot の cut に対する StateReady を送る。
5. 既存 Control／State の更新を Runtime に適用する。Cue／Flow を観客端末で再実行しない。

HTTP の生成元は [openapi.ts](../../../server/control-plane/src/openapi.ts)、通信の正本は [Browser Realtime transport](../../../../packages/contracts/browser-realtime.md)。API 資格と Runtime JWT を混同しない。

## 資格・復帰

- API bearer はメモリのみで保持する。期限の5分前以降の HTTP 取得では更新し、旧 token を破棄する。期限は1時間、更新可能期間は初回から24時間。
- Delivery／bootstrap は従来の最短期限前更新を使う。素材 URL だけなら表示を保持する。Runtime JWT が変わった場合はカメラを維持して新 Snapshot を取得し、素材を再適用する。
- Control 切断では両 socket を閉じ、画面の切断状態から2秒後に Delivery／bootstrap を再取得する。手動再接続も同じ取得を行い、現在の assignment と endpoint に新しい入力世代で接続する。再接続は新 Snapshot を使い、ブラウザ adapter は resume cursor を保持しない。
- Control Plane が有効な Viewer 資格に対して `410` と `error.code=session_ended` を返した場合は、接続を破棄して配信終了を表示する。それ以外の `401`／`403`／`404`／`410` は接続情報を破棄して再参加画面へ戻り、配信終了とは判定しない。一時的な通信失敗では期限内の接続情報を維持して再試行する。
- State の欠落では現在の表示を保持して State socket を閉じ、新 nonce で keyframe を取得する。古い socket と古い入力世代からの通知は受理しない。
- 退出・取消・破棄ではローカル資格を直ちに破棄し、API 資格の失効を要求する。オフライン時の失効要求は保証しない。発行済み Runtime JWT は即時失効せず、JWT の期限または assignment 終了で停止する。
- 初期通信・素材準備が30秒以内に完了しなければ切断扱いにする。再同期・再接続中も資格は診断や URL に含めない。

## 配信環境

| 所有          | 必要な設定                                                                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audience      | `VITE_AUDIENCE_API_ORIGIN` に HTTPS API origin。profile ID は共有定義から自動算出                                                                                                      |
| Control Plane | `AUDIENCE_ORIGIN` に Audience の HTTPS origin、既存 DB に `0013_anonymous_viewers.sql` を適用                                                                                          |
| Realtime      | `REALTIME_BROWSER_ORIGINS` に Audience の HTTPS origin。bootstrap endpoint と同じ host で `/browser/control`、`/browser/state` を同じ Runtime ポートへ転送し、WebSocket upgrade を許可 |
| 素材配信      | Audience origin から PNG／MP4／GLB の CORS 取得を許可。MIME・サイズ・checksum・期限が Delivery と一致すること                                                                          |

Venue Edge では `VENUE_EDGE_WEB_ORIGIN` に Audience の HTTPS origin を指定する。素材取得には現在の Runtime JWT を使い、bootstrap endpoint と同一 origin の Session 素材 URL にだけ付与する。

会場タグは引き続き `/poc-config.json`。session ごとの会場設定配布、時計の通信遅延補償、スマートフォンの負荷・長時間視聴は未検証。profile の資源予算はクライアントが拒否に使う上限であり、端末の動作保証値ではない。
