# MR / WebXR の複数端末接続テストとログ

MR（Quest / Unity）とWebXR（Audience）の同じSessionで、入室・資料取得・Realtime接続・操作送信・受信状態を照合します。ログは各端末のメモリに直近512イベントを保持し、利用者が保存操作をしたときにJSONへ出力します。サーバーへの自動送信は行いません。

## テストの準備

1. 全端末の時計を自動設定にし、同じ公開済みPresentation・ルームを使います。
2. QuestのAPI / Web接続先、WebXRのビルド時API設定とCORS、Realtimeのブラウザーorigin許可を確認します。
3. Runtime Hostの稼働とSessionのRuntime準備完了を確認します。
4. テスト担当者は各JSONファイルと物理端末・役割の対応を別途控えます。`recordingId`はこのアプリ起動中の記録を識別し、恒久的な端末IDではありません。

## 保存

- MR：`QuestPresentationSession.ExportDiagnostics()` で接続テストログを保存できます。製品メニューには保存ボタンを表示しません。JSONはUnityの `Application.persistentDataPath/SessionDiagnostics` に書き出されます。Questからの回収は接続した開発PCのファイル取得機能を使います。
- WebXR：入室画面または視聴画面の接続テストログ保存を使い、ブラウザーからJSONをダウンロードします。既存の状態JSONは、その時点の描画・追跡の状態確認にも使えます。
- ログは入室失敗・切断・退出後もアプリが生きている間保持します。再読込・アプリ再起動でメモリ上の未保存ログは失われます。障害を再現した直後に保存してください。
- 保存ファイルはリポジトリへ追加せず、テスト参加者に必要な範囲だけで共有します。

## 記録形式

共通の外枠は `schemaVersion: 1`、`mode: "unframe-session-diagnostic"`、`client: "mr" | "webxr"`、`recordingId`、`startedAtUtc`、`exportedAtUtc`、`droppedEvents`、`events` です。

イベントには `index`、`atUtc`、`elapsedMs`、固定の `event` 名と、該当する場合だけ次の項目を含みます。

| 項目                                 | 用途                                       |
| ------------------------------------ | ------------------------------------------ |
| `sessionId`                          | 同じルームの記録をまとめる                 |
| `runtimeId` / `assignmentEpoch`      | Runtimeの再割り当て前後を区別する          |
| `publicationEpoch`                   | 配信された公開版を照合する                 |
| `stage` / `code`                     | 接続・取得・再同期の段階と安全な結果コード |
| `direction` / `kind`                 | 送受信方向とメッセージ種別                 |
| `commandId`                          | MRの操作送信と受理・拒否結果を対応付ける   |
| `reliableSequence` / `stateSequence` | 受信の到達点・欠落・復旧を照合する         |
| `runtimeTimeMs`                      | 同じRuntime内の再生時刻を比較する          |
| `groupId` / `stepId`                 | 適用された進行状態を比較する               |
| `count`                              | 対象数などの数値                           |

Epochと連番は、JavaScriptの整数精度を超える値を壊さないよう10進文字列で保存します。ID・種別・結果コードは許可した項目だけを取り出します。token、credential、署名付きURL、APIの送受信本文、素材名、IPアドレス、カメラ画像・画素、任意の例外メッセージは記録しません。

高頻度のState・Pose等はサンプリングし、全フレームを保存しません。`droppedEvents`が0より大きい場合、古いイベントが512件の上限で失われています。欠落した先頭部分を「その処理は起きなかった」と判断しないでください。

## 照合する順序

1. 同じ `sessionId` を選び、`runtimeId` と `assignmentEpoch` が一致する区間を比較します。公開版も確認します。
2. 各端末のHTTP要求・応答、Deliveryとbootstrapの取得、素材準備、Control / State接続の順序を確認します。API成功だけで表示成功とは判断しません。
3. MRの操作送信・Outcomeと、各端末の連番・Group / Step・Runtime時刻の変化を照合します。Viewerは発表者の操作を送る必要はありません。
4. 一時停止・再開、途中参加、Wi-Fi切断と復帰、Runtime再起動、Session終了を別々に試し、各試行直後に全端末で保存します。
5. 再接続では新しいbootstrap取得とassignment、受信連番の復帰を確認します。終了後に古い接続が進行しないことも確認します。

`atUtc`は端末の壁時計、`elapsedMs`はその記録の端末内経過時間です。端末ごとの時計差や通信遅延は自動補償されません。UTCの差だけから片道通信遅延や厳密な同期誤差を算出しないでください。`runtimeTimeMs`と連番は、同じRuntime世代・時計状態の区間で比較します。

このログは接続やデータ適用の診断用です。MR / WebXRの物理的な原点一致、マーカー精度、映像の実際の表示時刻、音声の端末出力遅延は、別途実機測定が必要です。
