# Venue Edge 素材配信の会場検証

対象は Issue #183。2026-10-27 時点ではローカル自動テストによる実装検証のみで、Quest 2 台・iPhone Safari・Android Chrome の実機結果は未取得。実機の完了条件が満たされるまで Issue を閉じない。

## 接続済みの経路

VenueEdge 割当の DeliveryManifest は登録済み Runtime endpoint と同じ origin の `/sessions/{sessionId}/assets/{assetId}` を返す。Cloud 割当は既存の Cloud 配信を使う。

Venue Edge は Runtime JWT の `assets:read`、session、runtime、epoch、revision を検証する。Control Plane の service 認証付き `GET /internal/runtime/assets` が現在の assignment、Edge 登録状態・heartbeat、participant、選択済み capability、PublicationFence を確認して、掲載済み素材だけの短命 R2 URL と checksum / size / mediaType を返す。Edge は起動時の publication pin と照合する。R2 URL と service credential は端末へ渡さない。

4 GiB の content hash cache は 512 MiB の空き領域を残し、この process の Session で取得した素材を pin する。過去 process の未 pin 素材は LRU で削除し、取得途中のファイルは次回 cache miss で掃除する。checksum とサイズを検証した後に atomic rename で保存する。cache hit も再認可し、Cloud ダウンロード後は再度 fence を確認する。Control Plane に到達できない場合は cache からの配信も拒否する。

HTTPS と gRPC HTTP/2 は同じ listener を使う。素材は GET / HEAD、Range / If-Range / ETag に対応し、認可付き応答は `private, no-store`。同時処理を 8 request に制限し、cache 更新・Cloud 取得は直列化する。`X-Unframe-Asset-Source: venue-edge`、`X-Unframe-Cache: hit|miss` と、token を含まない checksum / Session / Asset の access log で取得元を確認する。

Unity は認証済み bootstrap の endpoint / certificate fingerprint を素材取得にも適用し、その Session の Edge URL だけに Runtime Bearer を付ける。redirect は無効。main のこのリポジトリには既存 WebXR consumer は含まれておらず、別管理の WebXR 側では Runtime Bearer と Delivery URL の接続が別途必要。

## 会場構成と証明書

#180 の運用担当と次を固定して記録する。

| 項目          | 固定する値                                                                    |
| ------------- | ----------------------------------------------------------------------------- |
| LAN           | SSID、subnet、AP client isolation 無効、端末間接続を許可する firewall         |
| Edge          | OS / host / LAN IP、DHCP reservation、公開 endpoint とポート                  |
| Control Plane | HTTPS origin、JWKS、Runtime issuer / audience、build revision                 |
| 割当          | Edge ID / Runtime ID / Session ID / assignmentEpoch / publicationManifestHash |
| 端末          | Quest 2 台と phone の機種・OS・browser / app build                            |
| 証明書        | SAN、issuer、fingerprint、有効期限、全端末の trust 設定                       |

ブラウザには SAN が公開 endpoint に一致し、各端末で信頼済みの証明書 chain を使う。LAN DNS でその名前を Edge の LAN IP に解決する。ブラウザの TLS 検証を無効にしない。Unity の明示的 pin は認証済み bootstrap から得たものだけを使い、有効期間と host も確認する。

証明書と private key はリポジトリ外へ保存し、private key は Edge process のユーザーだけが読めるようにする。Runtime 起動時に SAN と有効期間を検証し、読み込んだ leaf の fingerprint と期限を出力する。登録時の fingerprint と一致することを確認する。証明書は起動時に読み込み、hot reload は行わない。期限前に Session を終了・assignment を release、process を停止、証明書を更新、fingerprint を再登録し、新しい assignment / bootstrap で再起動する。旧 Session の pin を書き換えない。

Realtime の既存必須環境変数に以下を加える。

| 変数                       | 値                                                           |
| -------------------------- | ------------------------------------------------------------ |
| `REALTIME_RUNTIME_KIND`    | `VenueEdge`                                                  |
| `REALTIME_LISTEN_ADDR`     | LAN から到達可能な address / port（例 `:9443`）              |
| `VENUE_EDGE_TLS_CERT_FILE` | leaf と chain を含む PEM の絶対パス                          |
| `VENUE_EDGE_TLS_KEY_FILE`  | PEM private key の絶対パス                                   |
| `VENUE_EDGE_CACHE_DIR`     | 専用 writable directory の絶対パス                           |
| `VENUE_EDGE_WEB_ORIGIN`    | WebXR の HTTPS origin（browser 使用時に必須、末尾 `/` なし） |

`REALTIME_RUNTIME_ENDPOINT` と登録した `localEndpoint` は TLS listener の origin と一致させる。既存の `SSL_CERT_FILE` は Edge から Control Plane / R2 への追加 trust 用であり、端末の trust 設定ではない。`VENUE_EDGE_WEB_ORIGIN` に一致する origin だけ CORS / Authorization・Range preflight と Private Network Access を許可する。端末 browser の LAN permission も記録する。

起動は repository root から `nix develop --command go -C app/server/realtime run ./cmd/server`。登録・heartbeat・assignment renew は既存の Control Plane API を使う。これらを自動実行する Edge Agent は未実装であり、会場では #180 の手動手順で heartbeat / lease を維持する。

## 実機試験と証跡

1. 上表の値、Git SHA、端末 build、証明書期限、登録レスポンスの非秘密情報を記録する。Edge の電源・有線接続、LAN DNS、Control Plane 接続、60 秒以内の heartbeat と有効 lease を確認する。
2. 各端末で Session に参加し、Delivery 内の Asset URL が Edge origin になっていることを確認する。browser では許可された origin の preflight 成功と TLS trust を確認する。
3. 初回取得の `miss`、別端末で同じ checksum を取得した `hit`、Edge access log と LAN IP の remote address を対応付ける。画像 / font / model / video の表示と video Range を確認する。HAR やログを保存する際は Authorization / cookie / R2 query を除く。
4. Quest 2 台と phone で進行を同期し、Wi-Fi 切断・復帰、Edge restart、assignment 再発行後の Delivery / bootstrap 再取得、証明書更新後の再接続を試す。Control Plane 切断時は cached Asset も拒否すること、他 Session・期限切れ token・revoked Edge が拒否されることを確認する。
5. 不具合は再現条件と修正 SHA を残し、同じ端末・構成で再試験する。

証跡は次の列で追記する。現時点では全実機項目が未実施。

| 日時 (JST) | 端末 / build   | 構成 / Session / epoch | 試験                                             | 結果   | 非秘密の証跡 | 不具合 / 再試験                 |
| ---------- | -------------- | ---------------------- | ------------------------------------------------ | ------ | ------------ | ------------------------------- |
| 未実施     | Quest 2 台     | 未固定                 | 到達性 / TLS / 表示 / 同期 / 復旧                | 未実施 | なし         | 実機と会場 LAN が必要           |
| 未実施     | iPhone Safari  | 未固定                 | CORS / LAN permission / TLS / 表示 / 同期 / 復旧 | 未実施 | なし         | WebXR consumer 接続と実機が必要 |
| 未実施     | Android Chrome | 未固定                 | CORS / LAN permission / TLS / 表示 / 同期 / 復旧 | 未実施 | なし         | WebXR consumer 接続と実機が必要 |
