# Audience Webアプリ: 接続・配信・実機受入計画

更新日: 2026-10-31。Audience・Backend・配信環境の担当者向けに、残る仕様判断・実装と公開環境・スマートフォンでの受入をまとめる。

現在の操作は [Audience README](../../app/web/audience/README.md)、契約・接続順は [契約適合](../../app/web/audience/docs/contract-compatibility.md) と [接続境界](../../app/web/audience/docs/connection-boundaries.md)、環境設定は [接続引き継ぎ](../../app/web/audience/docs/handoff-report.md) を参照する。

UI・操作導線の残る受入は [Audience リライト計画](audience-rewrite-plan.md) を参照する。

## 残る仕様・実装

- [ ] native-uiを含む製品の完成範囲を確定し、実装・profile・受入条件を揃える。現在の対応範囲は [Audience capability profile](../../packages/contracts/src/presentation/audience-capability.ts) を正本とし、追加対応を決めた場合は契約・renderer・予算・Backendのprofile選択を一組で検証する。
- [ ] Session別の会場設定配布元、取得権限、revision更新時の扱い、設置poseと共有原点の対応を確定し接続する。現在は `src/fiducials/default-board.json` を bundle から読み込む。
- [ ] 通信遅延と端末間時計差を測定し、必要な時計補償を実装・検証する。既存のRuntime時計からローカル単調時計への対応・補間とは区別する。
- [ ] Galaxy ChromeのNORMAL待機停滞を起動診断ログで調査し、原因と必要な修正を確認する。

会場タグの再認識は端末内の対応変換だけを更新し、共有 `presentationOrigin` を書き換えない。会場設定revision、共有原点version、SDK座標の寿命を混同しない。

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

## 受入の範囲

追跡方式の再選定と旧目標の7m・誤差10cm・不可視5〜10分保持の定量実証は、この残作業に含めない。[採用記録](../../app/web/audience/docs/experiments/audience-apriltag-adopted.md) に従う。
