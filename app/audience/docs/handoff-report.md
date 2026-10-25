# Audience Web XR 他担当向け引き継ぎ報告書

- 作成日: 2026-10-25
- 対象: `app/audience/`、統合ブランチ `webXR/audience`
- 共有先: [Draft PR #167](https://github.com/unframe-dev/unframe/pull/167)
- 状態: アプリ内部の視聴基盤・描画・進行適用は実装済み。実Backend／ブラウザRealtimeへの接続と実機の総合受入は未完了。

## 1. 目的と利用体験

観客がスマートフォンのブラウザでサイトを開き、ログイン・登録操作なしで会場のルームコードを入力する。カメラ使用を許可し、SDKの準備と会場タグの認識後、登壇者と同じ空間・進行のプレゼンテーションを視聴する。観客はViewer権限のみとし、進行・編集操作は提供しない。Unframeは無償だが、無償利用と匿名identity発行は別の要件である。

今回の引き継ぎは、既存Session／Delivery／Runtime／Realtime v2への接続を完成させるための依頼である。Audience専用のプレゼン定義やページ同期APIを新設する依頼ではない。未確定のAPIパス、通信方式、資格寿命、資源上限をこの文書で共有仕様として確定しない。

## 2. 実装済みの範囲

| 領域           | 実装状況と制約                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 位置合わせ     | AprilTag `tag36h11` ID 0の有効な姿勢を単発即採用。次の観測まで8th Wall absolute SDK／SLAMで保持。追跡低下・hidden・停止では非表示にし、新しいタグ認識を要求する。表示だけに小揺れ補正を適用 |
| 座標           | タグ・会場・プレゼン固定配置・Runtime共有origin・Node親子transformを接合。メートル、右手系、Y-up、forward -Z                                                                                |
| 描画           | PNG、opaque H.264 MP4、自己完結GLB。Surface合成、Timeline、動画再生／停止／seek／途中参加、model clip／crossfade／heldに対応                                                                |
| 状態適用       | 既存Snapshot／Control／State、sequence・publication／assignment／projection／origin fence、Group／Step、変数、Surface／media／model状態を適用。Cue／Flowは再実行しない                      |
| HTTP           | 既存join → Delivery → bootstrap。応答とViewer権限・世代・期限を検証。期限前更新、失敗時の期限内継続、取消・退出・破棄に対応                                                                 |
| 視聴セッション | 通常入口とfixtureでXR／Delivery／Runtimeの寿命を共用。素材URLだけの更新は表示を維持。assignment等の変更では古い入力を無効化し、新しいSnapshotを待つ                                         |
| UI・診断       | ルーム入力、SDK準備、認識、視聴、素材待ち、再同期・切断・終了。製品JSONは資格・署名URL・画素・プレゼン変数や進行IDを含めない                                                                |
| 設定           | 製品ではマーカー実寸・board ID・revisionを検証queryで上書きしない。現在の配布元はローカル`/poc-config.json`の暫定設定                                                                       |

### 対応を宣言できない範囲

- native-ui、Presenter anchor、Local Overlay、VP9／AV1／動画alpha。
- 外部URI、Draco／Meshopt／KTX2等を必要とするGLB。現GLBは埋込PNG／JPEGと`KHR_materials_unlit`拡張に対応する。
- 実ネットワークでの同期精度、時計遅延補償、端末の確定資源上限。

必須の未対応表現は明示的に拒否する。Quest／Unity profileを名乗って、未対応表現や未測定の資源上限を通す運用にはしない。

## 3. 接続順と現在の停止点

```text
ログイン操作不要のHTTP identity取得     ← 発行方法・提供待ち
    ↓
POST /sessions/join                   ← クライアント実装済み
    ↓
POST /sessions/{sessionId}/delivery    ← クライアント実装済み／Audience profile登録待ち
    ↓
POST /sessions/{id}/bootstrap          ← クライアント実装済み
    ↓
ブラウザ向けControl／State通信          ← 方式・公開経路待ち／Audience adapter未実装
    ↓
handshake → Snapshot → 素材準備 → Ready → 更新・再同期
    ↓
XR表示                                ← 状態適用・描画はfixtureで検証済み
```

通常画面は取得したDeliveryをXR／Runtimeへ渡す。ただし受信adapterは未接続のため、会場タグを認識できても実プレゼン受信待ちになる。`prepared`はHTTP接続情報の取得完了であり、Realtime接続・Snapshot受信・素材readinessの完了ではない。

## 4. 他担当へ依頼する実装・提供物

| 優先 | 主担当                               | 実装・提供してほしい内容                                          | 合意・確認したい内容                                                                                                                                                        |
| ---- | ------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0   | Backend／認証                        | ログイン操作不要のViewer identity発行と、既存joinへ渡せるHTTP資格 | 既存user／participantとの関係、join前後の取得順、Cookie等の受渡し、期限・更新・失効・再参加、参加数・試行制限                                                               |
| P0   | Backend／contracts                   | Audience CapabilityProfileの登録と登録済みID                      | 対応表現・必須機能・非対応時の応答、端末測定した資源上限、profile変更時の参加者寿命。Audienceが対応表と測定結果を提示し共同確定する                                         |
| P0   | Realtime／ネットワーク               | ブラウザで利用できるControl／State経路と疎通例                    | endpoint、認証の受渡し・再認証、protocol version、フレーム境界・上限・流量、nonce、handshake／Ready、Replay／Resume／Snapshot再取得、keyframe要求、切断・再接続・エラー仕様 |
| P0   | インフラ／ネットワーク               | Audienceの信頼されたHTTPS originと疎通環境                        | API／Realtime／素材のorigin、CORS・preflight・trusted origin、Cookie domain／SameSite／Secure、証明書。別origin運用か同一origin配信かを確定する                             |
| P1   | 会場設定の所有者／Backend／contracts | sessionと対応する会場設定の配布元・受渡し仕様                     | family／ID、黒外周実寸、設置pose、プレゼン固定配置、revision、取得権限、変更時の再初期化、共有originとの基準。変換の適用はAudienceが担当する                                |
| P1   | Backend／ネットワーク                | 公開済みテストsession・Presentationと素材の疎通確認               | PNG／MP4／GLBのMIME、CORS、checksum・size整合、URL期限・assignment lease更新、期限切れ・権限拒否時の応答                                                                    |

### コードで確認した不足と、環境確認の区別

- Session処理はidentityなしを401にする。[Session routes](../../server/control-plane/src/modules/sessions/routes.ts)を参照。観客用の匿名identity発行経路はリポジトリ内に確認できない。認証チェックを外すだけでは、既存参加者のuser参照と整合しない。
- [profile選択](../../server/control-plane/src/modules/publications/capability.ts)の受付は`quest-baked-web-v1`／`unity-media-v1`のみで、Audience用IDは未登録。
- [Realtime server](../../server/realtime/internal/transport/grpc/server.go)は認証付きgRPC双方向通信。ブラウザ用adapter／gatewayはリポジトリ内に確認できない。WebSocket等の方式は担当者と決める。
- [HTTP origin制御](../../server/control-plane/src/app.ts)は単一`WEB_ORIGIN`を基準にCookie付き更新とCORSを制御する。別Audience originを使う場合は認証設定と合わせて調整が必要。
- 実運用環境に別途gatewayやorigin設定が存在しないと断定するものではない。担当者には既存環境の有無も確認したい。

## 5. 既存APIを再利用する項目

| 操作                           | 既存要求                                                              | Audience側の扱い                                                                                    |
| ------------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 参加                           | `POST /sessions/join`、JSON `{ joinCode }`                            | `XXXX-XXXX`のルームコードを送る。内部session IDと区別する                                           |
| 配信選択・URL再発行            | `POST /sessions/{sessionId}/delivery`、JSON `{ capabilityProfileId }` | 既存Delivery Protobufを受理し、登録済profileとViewerを照合。同一参加者のまま異profileへ切り替えない |
| Realtime接続情報の取得・再発行 | `POST /sessions/{id}/bootstrap`                                       | endpoint・credential・期限とDeliveryのpublication／assignment／projectionを照合する                 |

素材URL更新のために新しい専用APIを要求しない。[既存Delivery発行](../../server/control-plane/src/modules/publications/delivery.ts)は「発行から最大5分」とassignment leaseの短い方を期限にする。Audienceは最短期限前にDelivery／bootstrapを再取得する。匿名HTTP identityの延長とRealtime credentialの再発行は別の寿命として扱う。

更新に失敗しても元の情報が有効な間は視聴を維持し、1／2／4秒の最大3回再試行する。期限到達では破棄する。資格だけの更新を実際の通信へどう反映するかは、通信担当が提供する再認証仕様に従ってAudience adapterへ実装する。

## 6. Audience担当が接続時に実装する処理

### 既に利用できるアプリ内部の受け口

- [HTTP接続制御](../src/connection/join-controller.ts): `getPrepared()`、`refresh()`、`leave()`。資格を含む値はメモリだけで保持し、公開状態には更新revision・更新中・安全なエラーのみを出す。
- [視聴画面](../src/experience/ViewerExperience.tsx)の`onRuntimeInput(input, connection, getConnection)`: adapterが既存Control／State wireを入力する接続口。返したcleanupは交換・停止・退出時に呼ばれる。最新資格のgetterは現在有効な入力世代の間だけ利用できる。
- 同画面の`onRecoveryRequest(request, input, restartInput)`: Snapshot／keyframe要求を通知する。Snapshot再同期では世代限定の`restartInput()`で新しい入力口へ切り替える。keyframe回復では既存入力を維持する。古い入力・getter・回復callbackは再利用しない。
- [視聴セッション](../src/experience/viewing-session.ts): 切断を受けて表示を解除し、再接続時は新Snapshotを要求する。Control欠落とState keyframe待ちを区別する。

これらは端末内の関数であり、新しい共有通信契約ではない。callbackの存在を、要求の送信成功やサーバー側処理の完了とは扱わない。

### 外部仕様の提供後にAudience側で行うこと

1. 認可された資格・origin・profile設定で実HTTP接続を確認する。資格方式が現在のCookie方式と異なる場合は、合意した仕様に合わせてHTTP adapterを変更する。
2. 決定されたブラウザtransportを接続し、既存Control／State、handshake、Ready、再同期／復帰、更新資格の反映を実装する。
3. Readyは素材・適用状態のreadinessと既存protocolの条件を満たしてから送る。HTTPの`prepared`やタグ認識だけで送らない。
4. Runtime時計の受信時刻・遅延の扱いを共同確認し、必要な補償を実装・測定する。独自の時計APIを先に要求しない。
5. 実端末で総合受入し、Capabilityの資源上限を共同確定する。

現状の退出はローカルの取消・保持データ破棄であり、サーバー参加者削除の独自APIは呼ばない。退出・復帰のサーバー側意味論が必要なら接続仕様と合わせて確認する。

## 7. 受入条件

| 確認             | 合格とする結果                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 初回参加         | 新規ブラウザでログイン・登録操作なしにルームコードからViewer参加し、Delivery／bootstrapを取得できる                       |
| 初期化・途中参加 | 正しいfenceのSnapshotを受け、PNG・動画・GLBを現在の進行・再生位置で表示できる。Readyの順序がprotocolに適合する            |
| 進行同期         | 登壇者の進行、停止、seek、Group／Step／Surface／clip変更を反映する。観客がCue／Flowを再実行しない                         |
| 期限更新         | 素材URL・接続資格の更新中もカメラと表示を維持する。更新拒否・失効時は期限内継続と期限到達後の停止を区別する               |
| 切断・世代更新   | 再接続・assignment変更・Snapshot再同期で旧接続の遅延データを拒否し、新しい状態から復旧する。State欠落はkeyframeで復旧する |
| 空間設定         | 実寸・設置pose・revision・共有originが登壇側と整合する。SDK追跡低下では非表示、再認識後に復帰する                         |
| 権限・失敗       | Viewerのまま操作権限を増やさず、存在しないルーム、参加不可、非対応表現、資格失効、配信終了を適切に扱う                    |
| 端末             | 対象iPhone Safari／Android Chromeでカメラ＋動画・音声・GLB、背景復帰、繰り返し入退場、長時間視聴を測定する                |

実接続開始に必要な提供物は、匿名資格取得手順、登録済profile ID、API origin、ブラウザRealtime仕様と接続先、公開テストsession／Presentation、会場設定の受渡し方針。担当者間でこの一覧を照合してから実接続受入へ進む。

## 8. 検証実績と未確認事項

- Audience: `nix run .#audience`で59ファイル・529テスト、型検査・lint・本番build成功。実契約Delivery／Snapshotからの視聴セッション結合、期限更新、旧入力拒否、再同期・復旧を含む。
- Chrome／SwiftShaderでPNG合成、動画・GLBの通常／途中参加を確認。幅390pxの本番参加画面は横はみ出し・開発リンク・JavaScript例外なし。
- `nix run .#check`はControl Plane通過後、今回未変更の`packages/unframe-compiler/test/video-compilation.test.ts:245`が5000msタイムアウト（387成功・1失敗）して停止。後続集約チェックは未実行。全体ゲート成功とは扱わない。
- 500kB超bundle chunk警告は残る。実Backend／Realtime、音声を含むスマートフォン同時負荷、長時間の資源測定は未検証。Galaxy ChromeのSDK NORMAL待機原因は未確定。
- 位置保持PoCはユーザー承認済みだが、黒外周150mmで約3.3m、240mmで約5.8mという実機報告を、7m初回認識・10cm誤差・タグ不可視5〜10分保持の定量保証にはしない。

## 参照

- [現在の仕様・操作](../README.md)
- [外部接続境界](connection-boundaries.md)
- [契約適合の確認](contract-compatibility.md)
- [実装・検証履歴](implementation-history.md)
- [Control Planeの契約](../../../packages/contracts/README.md)
- [Realtime wire](../../../packages/contracts/proto/unframe/realtime/realtime.proto)
