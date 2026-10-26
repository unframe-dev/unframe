# Browser Realtime transport

ブラウザ Audience の Viewer は、bootstrap の `endpoint` の origin から scheme を
`wss:` に変換し、`/browser/control` と `/browser/state` に接続する。
endpoint のパスは引き継がない。TLS は既存の HTTPS ingress で終端し、native gRPC
と WebSocket は同じ advertised endpoint と Runtime を使用する。

- WebSocket subprotocol は `unframe.realtime.v3` のみ。
- 接続ごとに最初の message は text JSON `{"credential":"<Runtime JWT>"}`。
  上限は UTF-8 16 KiB、受信と認証の期限は接続後 5 秒。追加フィールドは拒否する。
  URL、query、subprotocol、Authorization header に資格を入れない。
- 認証の追加 ack はない。続けて binary の ControlHandshake または StateHandshake を送る。
- 以後は 1 binary message に既存 v3 Protobuf item を 1 個格納する。
  Control は `ControlClientItem` / `ControlServerItem`、State は
  `StateClientItem` / `StateServerItem` を使用する。gRPC の長さ prefix は付けない。
  Control 上限は 1 MiB、State 上限は 256 KiB。
- `REALTIME_BROWSER_ORIGINS` はカンマ区切りの HTTPS origin allowlist。
  空ならブラウザ接続を無効にする。要求の Origin は必須で完全一致する必要がある。
- JWT の検証、Viewer role、assignment fencing は接続時に検査する。
  ブラウザ接続は検証済み JWT の `exp` でも終了する。期限後は新しい bootstrap 資格で再接続する。
  接続後は JWT の有効期限で socket を閉じる。lease 期限、snapshot、State nonce、StateReady、Replay、resume は
  native gRPC と同じサービスが処理する。Viewer は Presenter 入力を送れない。
- 共有サービスは既存の resume cursor を受理する。Audience adapter は cursor を保存せず、Control の切断後は新しい Snapshot を取得する。State の再接続は
  Control で受け取った新しい nonce を使い、Ready を再送する。
  Control の切断は関連する State も閉じる。

サービスエラーの close code は 1008、正常終了は 1000、reason は
`realtime connection closed`。資格や内部エラーは送らない。フレームのサイズ違反や
接続タイムアウトは WebSocket ライブラリまたはネットワーク切断として通知される場合がある。
close code だけで復帰を判断せず、`ResyncRequired` では新 Snapshot を要求する。resume を使うクライアントは既存の cursor 契約に従う。
