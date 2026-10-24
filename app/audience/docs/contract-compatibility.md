# Audienceと既存Quest／Unity契約の適合確認

確認日: 2026-10-24。対象: 統合済みmain `5219fa91`を含む`webXR/audience`。これはコード・契約の静的な照合結果であり、Audienceの実接続や端末での契約適合を証明するものではない。追加案は未承認・未実装として区別する。

## 判定

既存のSession、Delivery、Runtime、Realtime v2を共用する。Audience専用のプレゼン定義・ページ同期プロトコルは新設しない。Audienceは位置保持PoCを完了し、既存contracts依存でPNG・H.264動画・GLB描画・座標接合・Snapshot／イベント／State適用・Group切替・Timeline／Surfaceクロスフェードをアプリ内で実装している。HTTP join／Delivery／bootstrapの取得・整合検証・期限管理と参加UIを実装済み。匿名資格・登録済Audience profile・接続環境の外部提供待ちで実HTTP接続は未検証。実Realtime接続は未実装で、ライブ視聴可能な状態にはまだ達していない。

## 契約の正本

- [Control Planeの説明](../../../packages/contracts/README.md): HTTPは`app/server/control-plane/src/openapi.ts`と実ハンドラに登録されたschemaが生成元。生成OpenAPI JSON／TypeScriptを手編集しない。
- [Presentation schema](../../../packages/contracts/src/presentation/index.ts): Zodの実行時検証・公開型を利用する。JSON schemaは生成物。
- [Delivery wire](../../../packages/contracts/proto/unframe/delivery/delivery.proto)と[Realtime wire](../../../packages/contracts/proto/unframe/realtime/realtime.proto): 既存Protobufを維持する。JSON表現とwire messageは明示的に変換し、別契約として複製しない。
- [空間座標契約](../../../docs/decisions/0010-spatial-surface-coordinate-contract.md): canonical座標とUnity固有の変換を区別する。文書内の過去の未実装記述は、現実装と照合して利用する。

## 適合表

| 領域             | 現在のBackend／共有契約                                                              | Audienceの判定・必要作業                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| ルーム解決       | Session joinは`joinCode`を使う。形式は`XXXX-XXXX`で、内部session IDとは別            | 共用。画面上のルームIDをjoinCodeとして入力させる                                                                                         |
| 参加者と権限     | presenter／viewer。join・bootstrapはidentity必須                                     | viewerを共用。匿名資格の発行・期限・更新・再参加の設計が必要                                                                             |
| 参加者の永続化   | `session_participants.user_id`はuserテーブル参照                                     | 認証チェックを外すだけでは匿名参加できない。guestと既存userの関係をBackend所有で決める                                                   |
| 配信選択         | Deliveryはcapabilityを正規化し、参加者ごとのprojectionを保存                         | 共用。Audience profileの追加登録が必要。クライアントが未対応機能を自己申告して通す方式にしない                                           |
| profile変更      | 同一参加者の異なるcapability／projection再選択はconflict                             | 開発中のPNG用と動画・GLB対応用は別profile案。切替時の参加者寿命を定義する                                                                |
| 接続準備         | bootstrapは保存済projection、publication fence、assignment、期限付きcredentialを返す | 共用。Delivery選択をbootstrapより先に行う                                                                                                |
| HTTP origin      | CORSとCookie付き更新のorigin検証は`WEB_ORIGIN`基準                                   | 同一origin配信か、Audience origin追加かを決める。Cookie／Bearerの選択と一組で設計する                                                    |
| 素材             | 公開物・素材識別とDeliveryのURL発行がある                                            | 共用。URLは最大5分とassignment leaseの短い方。署名素材APIの`private, no-store`を守り、期限更新を実装する                                 |
| 進行状態         | ParticipantRuntimeView、node／surface／media／model clip／clockが定義済み            | 共用。状態の適用器とThree.js描画が必要。ブラウザでCueや進行判定を再実行しない                                                            |
| 通信             | Realtime v2はgRPC双方向Control／State                                                | メッセージ意味論は共用。ブラウザ用transportは未実装・方式未選定。transport adapterの追加範囲を別途確定する                               |
| 初期化と復帰     | handshake、nonce、Snapshot、StateReady、sequence、fence、Replay／Resume              | 共用。異publication／assignment／projection／originの混在拒否、再同期を最初の接続から扱う                                                |
| 会場のタグ       | 現Audienceのみローカル`poc-config.json`とサイズqueryを利用                           | 共有会場設定として未定義。family、ID、黒外周実寸、設置pose、revisionと原点との関係が必要                                                 |
| 観客の自己位置   | PoCがタグ姿勢とSDK姿勢から`sdkFromVenue`を得る                                       | 端末内で保持。Presenter専用の頭・手のTrackingFrame送信へ置き換えない。Presenter anchor追従要素はStateのanchor bindingsを受信して表示する |
| 表示の小揺れ補正 | PoCは検証マーカー表示へのフィルターのみ                                              | 確定した空間対応と表示を分離して再利用。共有originやサーバー状態を平滑化しない                                                           |

根拠: [Session routes](../../../app/server/control-plane/src/modules/sessions/routes.ts)、[Session service](../../../app/server/control-plane/src/modules/sessions/service.ts)、[Session schema](../../../app/server/control-plane/src/modules/sessions/schema.ts)、[参加者migration](../../../app/server/control-plane/migrations/0006_sessions.sql)、[Delivery](../../../app/server/control-plane/src/modules/publications/delivery.ts)、[profile正規化](../../../app/server/control-plane/src/modules/publications/capability.ts)、[HTTP origin検証](../../../app/server/control-plane/src/app.ts)、[素材API](../../../app/server/control-plane/src/modules/publications/asset-routes.ts)、[Realtime実装](../../../app/server/realtime/internal/transport/grpc/v2_service.go)。

## 表現対応

以下は既存契約とAudienceの対応範囲。PNG・H.264 MP4・自己完結GLBは実装済みで、iPhoneのカメラ同時負荷と実サーバー接続は未検証。詳細な制約は[README](../README.md)の動画・GLB表示節を参照。

| 表現                | 既存profile                                   | Audienceへの適用方針                                                                                |
| ------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| PNG・sRGB・透過     | `quest-baked-web-v1`／`unity-media-v1`        | 実装済み。サイズ・crop・transform・visibility・opacity・遷移を反映する                              |
| H.264動画・音声     | `unity-media-v1`                              | 実装済み。runtime clock、途中参加、再生・停止・seek・heldを反映。音声とSafari再生許可は実機検証待ち |
| GLB                 | `unity-media-v1`                              | 実装済み。PBR／unlit・skin・morph・clip・crossfade・held。外部URI・圧縮拡張等は拒否                 |
| native-ui           | schemaあり。上記2profileではunsupported       | 配信されるbaked表現で要件を満たせるか確認する。native-ui必須の公開物を黙って欠落させない            |
| VP9・AV1・動画alpha | enumに項目があっても現capability schemaは拒否 | 対応済みと宣言しない。必要なら共有契約の別変更として扱う                                            |
| local overlay       | 上記2profileではunsupported                   | 自動的に対応済みとせず、必要性と配信・描画の扱いを確認する                                          |

[Capability schema](../../../packages/contracts/src/presentation/capability.ts)と[Unity media profile](../../../packages/contracts/src/presentation/media-capability.ts)を基準にする。Quest／Unityの資源上限はスマートフォンで検証された上限ではないため転用しない。AudienceのGPU／CPU・texture・動画decoder・model予算は未確定。カメラ・検出Worker・SDKと同時に動かして測定し、対応表とprofileを一組で確定する。

## 空間の接合

`AFromB`はB座標の点をA座標へ移す変換とする。既存の右手系・Y-up・forward -Z・メートル・Quaternion `[x,y,z,w]`をAudienceの契約境界でも使う。Unity固有のZ反転はThree.js側に移植しない。SDK／タグ座標の変換は現在の検出adapterに閉じる。

初回監査時点では[設定](../src/fiducials/config.ts)の`presentationToVenue`は未使用だった。工程2では[座標接合](../src/rendering/presentation-space.ts)を追加し、[タグ表示](../src/rendering/live-tag-anchor.ts)の表示用マーカー行列から`inverse(venueFromMarker)`で会場基準を復元して設定を適用した。共有原点用Groupと`setPresentationOrigin(Matrix4)`を分離し、Runtime受け口でversion／fenceを検証して反映する。既存fixtureで確認済みだが、実サーバーからのSnapshot取得と実機での適合確認は未実施。

製品側では次の連鎖を明示する。

```text
SDK local ← 会場基準 ← presentation origin ← nodeの親子transform
```

既存Unityの校正rootと共有originの親子構造に合わせ、会場基準とプレゼン基準の固定対応の子へRealtimeの`presentationOrigin.pose`を適用する構造とする。会場設定に同じorigin offsetを重複保存しない。会場設定revision、共有origin version、端末SDKの寿命は独立して照合する。タグ再認識は端末内の空間対応を更新し、共有originを変更しない。nodeの親子合成はfull matrixで扱い、非一様scaleを含むworld matrixをTRSへ再分解して正本にしない。

PoCのposeはobject形式、共有JSONはtuple、wireはmessage形式である。境界adapterと契約fixtureで変換・有限値・Quaternionの意味的検証を確認する。ローカル設定の緩いQuaternion許容値を共有契約の検証として流用しない。

## 次に確定する差分と所有者

担当はAudience側の接続口まで。以下のBackend／contracts項目は担当者への確認・依頼事項であり、この担当による実装計画ではない。[接続境界と進め方](connection-boundaries.md)に従い、既存APIを利用する。

1. Control Plane: ログイン操作不要のguest資格と既存user／participantの関係、寿命・更新・退出、ルーム参加制限、HTTP origin。
2. Control Plane／contracts: Audience profileの登録と初期対応表。既存Quest／Unity profileは変更しない。
3. 会場設定の所有Backend／contracts: タグ実寸・配置・revision、共有原点の基準との対応、取得権限・設定更新時の扱い。
4. Realtime: 既存Control／State意味論を維持するブラウザtransport、credential受渡し、サイズ・流量制限、再接続。
5. Audience: 既存schema／wireの利用、素材取得、投影済状態の適用、空間adapter、RendererとLocalizationの分離。

この監査ではAPI名・guest保存方式・資格寿命・transport・予算値を新しい共有仕様として確定していない。工程1はAudience側の境界設計と、外部契約の確定を分けて管理する。前者の記録だけで外部提供・実接続まで完了扱いにしない。共有API／Backend／生成物／依存設定は変更しない。

## 検証範囲

実装、schema、Protobuf、既存fixture、Unity向けprofileとAudience PoCを静的に照合した。実行結果:

- `nix develop --command pnpm --filter @unframe/contracts test:presentation`: 39件成功。
- `nix develop --command pnpm --filter @unframe/contracts test:wire`: 12件成功。既存Go／C#バイナリfixtureとの一致も含む。
- 本文のローカル参照先の存在、`git diff --check`、最終変更範囲を確認。

初回の適合確認ではAudience内の本記録とREADMEの参照だけを変更した。その後の担当範囲の整理では接続境界文書とAudience全体計画も更新した。コード・生成物・依存・共有設定は変更していない。文書のみの監査のため全体ゲート`nix run .#check`は再実行していない。Audienceのブラウザ向けbuildと、Chrome／SwiftShaderでのPNG・動画・GLB fixture描画は確認済み。Audienceとサーバーの実接続、スマートフォンでのカメラ・音声同時負荷や長時間の資源測定は未実施。既存契約テストの成功をAudience実装の適合完了とは扱わない。

## PNG Runtimeの実装範囲

Timeline補間とSurfaceクロスフェードの表示更新は実装済み。Cue／Flowの実行、完了判定、次Stepの決定をAudienceへ複製せず、受信Runとruntime時計から表示を導出する。Surface内の重なるpartitionは旧／新状態ごとに合成してから混合する。Timeline中と累積opacityが1未満のSurfaceも合成後の透過を使用する。Surfaceのcomposite shaderはunique texture 8枚までで、超過は明示拒否する。

これは対応CapabilityProfileの登録や端末受入を完了したという意味ではない。実ネットワークでの時計遅延補償、Session readinessとしての素材先行準備、shaderの実GPU表示・資源測定は未検証／未接続。既存Quest／Unity profileをAudience対応済みと扱わない。

## Viewer入力と変数

Runtime受け口はDeliveryのSessionRole=Viewerを要求する。既存projectionがenabledLogicalInputsを導出するのはPresenterのみで、Viewerへは空配列が配信される。入力有効集合の差分イベントはなく、LogicalInputAcceptedを入力有効化として解釈しない。観客へPresenter入力UI・進行コマンド権限を追加しない。

変数はcatalogの型とownerへ照合してSnapshot／VariableChanged／Group初期化から保持する。共有のscalar値の意味や変数演算を変更せず、AudienceではguardやCueを再評価しない。PNG内容は固定であり、native-ui動的bindingは今回の実装範囲に含まない。
