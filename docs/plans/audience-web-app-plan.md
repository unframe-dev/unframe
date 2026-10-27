# Audience Webアプリ: 接続・配信・実機受入計画

更新日: 2026-10-27。位置保持PoCは完了し、PNG・動画・GLB描画、匿名参加とブラウザRealtime接続は実装済み。公開環境とスマートフォンでの総合受入、Session別会場設定配布、通信遅延を補償する時計同期が残る。本書はAudience・Backend・配信環境の担当者向けに、完成範囲と残作業をまとめる。

現在の操作は [Audience README](../../app/web/audience/README.md)、契約・接続順は [契約適合](../../app/web/audience/docs/contract-compatibility.md) と [接続境界](../../app/web/audience/docs/connection-boundaries.md)、環境設定は [接続引き継ぎ](../../app/web/audience/docs/handoff-report.md) を参照する。

## 実装済みの範囲

- 観客がログイン・登録なしでルームIDを入力し、匿名Viewer資格でjoin→Delivery→bootstrap→WebSocket Control／State→Snapshot／素材適用→StateReadyへ進む。資格の更新・失効、再接続・再同期、退出を扱う。
- 共有定義から算出するAudience profileによるPNG、opaque H.264 MP4、自己完結GLBの選択、取得検証・資源予算検査とThree.js描画を実装した。
- Snapshot、sequence／fence、Group／Step、変数、Timeline、Surface／media／model、Step restoreの置換Viewを反映する。ViewerはCue／Flowの進行判断を再実行しない。
- ルーム参加、カメラ開始、位置合わせ、視聴、再接続・終了のUIを分離した。カメラ・Worker・描画資源の所有と停止・破棄、診断を分離した。
- AprilTag `tag36h11` の単一ID 0を即時採用し、次の観測までは8th Wall SDK／SLAMで位置を保持する。追跡低下時は非表示にして再認識を要求し、表示専用の距離別小揺れ補正を使う。

方式選定は [採用記録](../../app/web/audience/docs/experiments/audience-apriltag-adopted.md) で終了している。旧目標の7m・誤差10cm・不可視5〜10分保持の定量実証や追跡方式の再選定を、Webアプリ開発開始の条件として復活させない。

## 表現対応と完成範囲

現在の配信能力の正本は [Audience capability profile](../../packages/contracts/src/presentation/audience-capability.ts) とする。

| 表現・状態     | 現在の対応                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| PNG／baked-web | sRGB・透過、配置・TRS、visibility／opacity、Surface合成・crossfade                                                                          |
| 動画           | opaque H.264 MP4、Runtime時計による再生・停止・seek・途中参加                                                                               |
| GLB            | 自己完結GLB、PBR／unlit、skin／morph、clip／crossfade／held                                                                                 |
| Runtime        | Snapshot、Control／State、変数、Group／Step、Timeline、Surface／media／model                                                                |
| 非対応         | native-uiと動的binding、Presenter Anchor／Frozen Anchor、Local Overlay、VP9／AV1／動画alpha、外部URI・Draco／Meshopt／KTX2等を必要とするGLB |

必須の非対応表現は黙って省略せず拒否する。元の製品計画にはnative-uiのWeb描画も含まれていたため、現行profileを製品の完成範囲とするか、native-uiを追加対象にするかは未確定として残す。対応拡張が必要な場合は契約・renderer・予算・Backendのprofile選択を一組で検証する。同じ参加者のprofileをクライアントだけで切り替えない。

## 残る仕様・実装

- [ ] native-uiを含む製品の完成範囲を確定し、実装・profile・受入条件を揃える。
- [ ] Session別の会場設定配布元、取得権限、revision更新時の扱い、設置poseと共有原点の対応を確定し接続する。現在はローカル `/poc-config.json` を使う。
- [ ] 通信遅延と端末間時計差を測定し、必要な時計補償を実装・検証する。既存のRuntime時計からローカル単調時計への対応・補間とは区別する。
- [ ] Galaxy ChromeのNORMAL待機停滞を起動診断ログで調査し、原因と必要な修正を確認する。

会場タグの再認識は端末内の対応変換だけを更新し、共有 `presentationOrigin` を書き換えない。会場設定revision、共有原点version、SDK座標の寿命を混同しない。

## SDK・検出器の配信条件

- `@8thwall/engine-binary@1.0.0` を固定し、SDK一式を同一originへ配置する。元のディレクトリ構造・ファイル内容・LICENSE・著作権表示を維持し、旧App Key付きloaderを併用しない。SDKとchunkの読み込み完了後に起動する。
- AprilTagのvendorハッシュ・取得元・ライセンスは `app/web/audience/vendor/apriltag/provenance.json` と同梱LICENSEで管理する。SDKと検出器のJS／WASM／Workerは別の配布物として条件を確認する。ArUco比較モードは現行構成に含めない。
- `prepare-engine.mjs` と `prepare-detectors.mjs` による配布準備を使い、SDK一式のhash・検出器・権利表記を成果物に含める。SDKバイナリの改変や逆解析を行わない。配布条件は採用した同梱LICENSEを確認する。
- SDKの同一origin配信と、別originのAPI・PNG／MP4／GLBのCORSは別に確認する。署名付きURLにもCORS条件は適用される。WebSocketはサーバーでOriginと資格を検証する。
- WASMは `application/wasm`、JSは適切なMIMEで配信する。未知の静的ファイル要求にSPAのHTMLを返さず、更新時にSDKの版を混在させない。
- CSPは実際のscript／connect／worker／img等の要求から設定し、Report-Onlyだけでなく強制適用で確認する。SharedArrayBufferを使わない現構成を理由なくCOOP／COEPへ切り替えない。
- カメラ利用には信頼されたHTTPSを用いる。カメラ・描画ループは8th Wallが所有し、検出のための別カメラ取得や画像の自動外部送信を追加しない。第三者ライセンスは画面から閲覧可能にする。

配布物の条件の確認先: [Engine導入手順](https://8thwall.org/docs/engine/overview)、[Binary LICENSE](https://github.com/8thwall/engine/blob/main/LICENSE)、[表記ガイド](https://8thwall.org/docs/open-source)。外部の最新版と同梱版が同一だと推測しない。

## 残る配信環境の受入

- [ ] DB migration、HTTP／WebSocketのorigin allowlist、HTTPS、WebSocket upgrade、素材CORSを設定する。
- [ ] 別のHTTPSホストでも同じ成果物を起動し、ドメイン登録に依存しないことを確認する。
- [ ] コールドキャッシュで全要求のURL・status・MIME・CORSを確認し、追加ファイル欠落・SPA fallback・意図しない外部依存がないことを確認する。
- [ ] CSP強制適用下でJS／WASM／Worker・素材を読み込めることを確認する。
- [ ] 別originの素材・APIを実ブラウザから取得し、必要なpreflightを含めて確認する。curlのHTTP成功だけで合格にしない。
- [ ] SDK・検出器のLICENSE・著作権・provenanceを公開成果物から閲覧でき、配布物とhashが一致することを確認する。

## 残る総合・実機受入

- [ ] 有効な公開済みPresentationとRuntime assignmentを用意し、新規ブラウザからログインなしで参加して、Snapshot・素材適用・StateReady・実表示まで通す。
- [ ] PNG／動画／GLBが混在するプレゼンで、途中参加、登壇側の進行・停止・seek、Timeline・crossfade・held状態を確認する。
- [ ] 切断復帰、欠落後の再同期、資格更新・期限切れ、素材URL更新、assignment変更で古い世代を適用しないことを確認する。
- [ ] 登壇側と会場タグの実寸・設置pose・presentationToVenueを揃え、iPhone Safari／Android Chromeで権限許可、認識・追跡低下・再認識、再読込・背景復帰を確認する。
- [ ] カメラと動画・音声・GLBの同時負荷、長時間視聴、繰り返し入退室・終了・ルーム変更後のCPU／GPU・メモリと資源解放を測定する。
- [ ] 実測を基にprofileの上限を確認する。ブラウザdecoder／GPU driver内部の全確保量まで保証したと扱わない。

端末・OS／ブラウザ・配信環境・対象成果物・手順・診断・測定値・残不具合を記録し、資格・署名付きURL・カメラ画像をログへ含めない。

## 検証済み範囲と実施方法

SDK全13ファイルとAprilTag配布物のhash、ローカル開発／previewでの配信、権利表記、合成入力によるWorker処理は確認済み。旧Image TargetsのiPhone起動記録を、現行AprilTag構成の公開環境受入へ流用しない。

Audienceの対象自動テスト・型検査・lint・buildと、Chrome／SwiftShaderでのPNG合成・動画／GLBの通常表示と途中参加の記録がある。HTTP・socket境界のテストを含め、公開環境の設定や実機性能の成功を意味しない。詳細な過去の検証結果は [実装履歴](../../app/web/audience/docs/implementation-history.md) に残す。

追加修正は変更範囲の失敗テストから進め、Audienceと変更したBackend／契約の対象検証を行う。全体test／buildはremote CIに任せる。fixtureは開発・テスト専用とし、製品参加経路へ模擬Backendや未確定APIの代替を追加しない。
