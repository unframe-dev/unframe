# Audienceの外部接続境界と担当範囲

更新日: 2026-10-25。状態: HTTP取得・期限前更新、通常視聴のDelivery/XR/Runtime接合、回復要求の受け口を実装済み。外部提供・実接続・Realtime接続は未完了。

## 基本方針

Audienceは既存Quest／Unity向けのSession、Delivery、Runtime、Realtime v2へ適合する。新しいプレゼン定義やページ同期プロトコルは作らない。担当範囲はAudienceの入力・取得・受信・適用・表示・復帰と、その接続口まで。サーバー、共有契約、インフラ、ネットワーク設定は変更しない。

既存APIは再利用する。匿名資格発行、Audience profile登録、ブラウザ通信経路の提供はBackend担当への依頼であり、Audience側の実装完了条件から区別する。未知のAPIパスやtransportを仮実装して製品に残さない。

## 既存APIで利用する流れ

HTTPの正本は[Control Plane OpenAPI生成元](../../../app/server/control-plane/src/openapi.ts)と実ハンドラ。以下は現行のルートであり、匿名参加用の追加APIを提案したものではない。

| 順序 | 既存の接続                                                            | Audience側の処理                                                            | 現在の条件                                                        |
| ---- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1    | `POST /sessions/join`、JSON `{ joinCode }`                            | ルームコードの検証・送信、返されたsessionのIDと状態を管理                   | 現在はidentity必須。join応答が匿名資格を発行するとは仮定しない    |
| 2    | `POST /sessions/{sessionId}/delivery`、JSON `{ capabilityProfileId }` | Protobuf DeliveryManifestを受理・検証し、素材取得へ進む                     | 参加資格と登録済profileが必要。選択は同じ参加者のまま変更できない |
| 3    | `POST /sessions/{id}/bootstrap`                                       | 接続先・credential・期限・publication／assignment／projection情報を受理する | 同じ参加者でDelivery選択済みであることが必要                      |
| 4    | 既存Realtime v2のControl／State                                       | handshake、Snapshot、Ready、更新、再同期を処理する                          | サーバーはgRPC双方向。ブラウザ用接続方式・公開先は未提供          |

join用のHTTP認証資格とbootstrapで得るRealtime credentialは用途を区別する。URLやログへ資格を埋め込まず、認証方式は担当者が提供する仕様に従う。

## Audienceが実装する接続口

次はアプリ内部の責務であり、Backendに新しいAPIを要求する型定義ではない。具体的な抽象化は利用箇所ができた時点で導入する。

- 参加・資格管理: ルーム入力、提供された認証方式の利用、join／Delivery／bootstrapの呼び出し、資格更新の要求、失効・終了・退出時の状態破棄。
- 配信能力: 実装済みの表現と測定した資源上限を提示し、登録されたprofile IDを指定する。Quest／Unityのprofile名を偽装してAudienceを対応済みと扱わない。
- 通信adapter: 決定された通信方式で既存Control／Stateメッセージを送受信し、切断・取消・再接続をアプリへ通知する。方式未確定の段階では接続実装を決めない。
- 状態適用: transportから分離し、既存schema／wire／fixtureでSnapshot、sequence、fence、origin、runtime clockを処理する。Cue実行や登壇者の進行判断を再実行しない。

## Backend担当への確認・依頼事項

| 項目                       | 必要な回答・提供物                                                                                                                          | Audienceでの利用                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 匿名viewer資格             | ログイン不要の発行経路、既存user／participantとの関係、join前後の取得順、HTTP認証の受渡し、期限・更新・終了／失効・再参加の意味、エラー契約 | 登録・ログイン画面を要求せず参加し、同じ参加者として復帰できる範囲を正しく扱う |
| Audience CapabilityProfile | Audienceから提示する対応表・測定値のレビュー、登録するprofile IDと内容、非対応時の応答、profile更新時の参加者の扱い                         | 既存Deliveryを利用する。profile登録をAudienceから動的に行うAPIは想定しない     |
| ブラウザ通信経路           | 接続方式と公開endpoint、資格の受渡し、Control／Stateの対応、protocol version、nonce、フレーム境界・上限、切断理由・再接続仕様               | wireと既存状態適用処理を維持したbrowser adapterを実装する                      |
| 接続環境                   | API／Realtime／素材のorigin、HTTPS、必要なCORS・Cookie条件、疎通用環境と公開済みテストデータ                                                | ブラウザからの実接続を検証する。サーバー側設定は担当者が行う                   |

TTL、保存方式、transport、endpoint名をAudience担当だけで確定しない。観客はviewer権限のみとし、進行・編集権限を得ない要件を伝える。資格や素材URLを診断ログへ含めない。

## Audience側で実装済みの受け口

- 通常参加で取得したDeliveryを視聴セッションへ渡し、明示的なカメラ開始後にRuntimeを生成する。fixtureも同じセッション制御を使う。
- `RuntimeInput` は既存Control/State wireを受理し、停止・assignment更新・再接続後の古い入力を拒否する。Snapshot/keyframeの回復要求を状態として公開する。これはネットワーク送信・handshake・Readyを代行しない。
- Delivery/bootstrapの期限前更新に既存APIを再利用する。同一配信ならassetAccessを更新し既存表示を保持、assignment変更ならRuntimeを再生成する。匿名資格の発行・延長は外部の決定待ち。
- 製品では設定済みマーカー実寸・board ID・revisionを検証用queryで上書きしない。現状はローカル暫定設定で、sessionごとの配布元は未確定。
- PNG/動画/GLB表示と操作進行はfixtureで検証する。未実装の必須表現を黙って欠落させない。

残るアプリ作業は、提供された通信仕様への実adapter接続、資格再認証・復帰・同期精度の実検証、端末測定に基づくCapability確定と追加表現の判断。アプリ内の受け口だけで匿名参加・実サーバー接続を完了扱いにしない。

## 完了判定

- 工程1のAudience側設計: 既存契約の共用範囲、接続順、責務、依頼事項、表現対応方針を記録する。接続口のコード実装は後続工程で行う。
- 外部契約の確定: Backend担当から3項目と接続環境の回答を得て、既存契約との差分を双方で確認する。現時点では未完了。
- Audienceのクライアント実装: HTTPのjoin → Delivery → bootstrap、整合検証、取消・期限・情報更新、失敗時UIを実装した。fixtureで受理・拒否を検証する。匿名資格発行、実HTTP接続、Realtime adapterは未完了。
- 製品の実接続: 提供された資格・profile・通信経路で匿名参加からライブ視聴まで検証する。外部待ちで省略した項目を合格扱いにしない。

会場タグ設定の受理・座標接合はAudience内の別作業とし、設定の配布元と共有原点の基準は外部との確認事項に残す。[適合確認](contract-compatibility.md)と[全体計画](../../../docs/plans/audience-web-app-plan.md)を参照。
