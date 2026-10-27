# Audience の契約適合

更新日: 2026-10-27。共有 Runtime v3、Delivery v3、progression／projection v2 を使用する。

| 境界            | 実装                                                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP            | OpenAPI 生成元の匿名資格と既存 Session／Delivery／bootstrap を使用。Session・Viewer role・publication／assignment／projection fence を照合                                               |
| 配信能力        | [`createAudienceWebCapabilityProfile()`](../../../../packages/contracts/src/presentation/audience-capability.ts) が正本。Backend の profile 選択と Audience の PNG／動画／GLB 検証を併用 |
| Control／State  | 既存 Protobuf を [WebSocket](../../../../packages/contracts/browser-realtime.md) で配送。Runtime service は gRPC と共用                                                                  |
| Snapshot／Ready | Snapshot を検証し素材を適用。StateConnected と準備完了後に Snapshot cut の Ready を送信                                                                                                  |
| 進行            | sequence・fence・Group／Step・Timeline・Surface／media／model を適用。Step restore の置換 View は原子的に適用し、古い State を破棄                                                       |
| 権限            | Viewer のみ。論理入力を有効化せず、Cue／Flow を実行しない。Presenter 専用通知・入力を拒否                                                                                                |
| 未対応          | native-ui、Local Overlay、Presenter Anchor／Frozen Anchor 表示、VP9／AV1／動画 alpha、外部 URI・圧縮拡張が必要な GLB                                                                     |

ControlHandshake の supportedCapabilities は `[1,2,3,4,5,8,9,10]`。v3 の必須 authority 能力は Viewer の空 Anchor 状態と置換 View に適用し、Anchor 内容を含む View は拒否する。未対応の必須能力を黙って描画から落とさない。

`capabilityProfileId` は、ID自身を除く定義のcanonical JSONをSHA-256でハッシュした `audience-web_<64桁hex>`。対応機能・資源予算・通信契約versionの変更でIDも変わる。任意のprofileリビジョン番号は持たず、schemaVersionや各contractVersionは対応する通信契約との照合に使う。Control Planeは現在の共有定義のIDだけを受理するため、定義更新時はAudienceとControl Planeを揃えて更新し、参加し直す。

profile の資源上限は受理のための初期方針であり、実機で測定された保証値ではない。動画 decoder や GPU driver の全内部確保量は保証しない。公開環境、通信遅延の時計補償、実機の長時間負荷は別途受入する。

正本: [HTTP](../../../server/control-plane/src/openapi.ts)、[Presentation schema](../../../../packages/contracts/src/presentation/index.ts)、[Delivery](../../../../packages/contracts/proto/unframe/delivery/delivery.proto)、[Realtime](../../../../packages/contracts/proto/unframe/realtime/realtime.proto)。過去の実装時点の制約は [実装履歴](implementation-history.md) に残す。
