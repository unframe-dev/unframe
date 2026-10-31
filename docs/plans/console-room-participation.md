# Console からの Room 管理と参加導線: 残る受入

更新日: 2026-10-31。Console・Quest・Audience・サーバーの担当者向けに、公開環境・実機で残る受入をまとめる。Room は API 上の Session を指す。

現在の操作・実装は [Console README](../../app/web/console/README.md)、[Quest onboarding](../../app/unity/Assets/Scripts/MR/Session/QuestOnboardingView.cs)、[Audience README](../../app/web/audience/README.md)、[Realtime README](../../app/server/realtime/README.md) を参照する。

## 公開環境・Quest 実機の受入

- [ ] 公開環境で Room 作成・再表示から参加 URL の共有・QR 撮影を経て、Audience がコード再入力なしで匿名参加し、実表示まで進めることを確認する。コード更新後は旧コード・URL・QR で新規参加できず、終了後は参加できないことも確認する。
- [ ] Quest 実機で Device Authorization、Keystore／JNI による認証保存、アプリ再起動後の復元、期限切れ・401 時の資格破棄と再承認を確認する。
- [ ] Quest 実機で所有 Room の一覧・選択から Presenter として参加し、Runtime 準備・接続・校正を経て発表する。資料選択からの新規作成も確認する。
- [ ] Quest 実機でコードによる匿名 Viewer 参加、資料取得・Realtime 接続・校正、資格更新・退出時の失効を確認する。保存済みアカウントがあっても匿名資格を使い、Presenter 操作ができないことを確認する。
- [ ] 公開環境で実接続者ゼロから10分の終了・割り当て解放、期限前の再入室による解除、Host 再起動後の復旧を総合確認する。

対象端末、配信環境、対象成果物、手順、結果と残不具合を記録する。Presenter 認識・描画の実機受入は [Presenter 認識の受入](presenter-recognition-runtime-authority-refactor.md) と合わせて行う。

## 収容数の受入

- [ ] 稼働環境へ `REALTIME_HOST_CAPACITY=5` を反映し、5 Room の収容負荷を確認する。測定条件は [Realtime の公開経路・収容負荷の受入](realtime-runtime-redesign.md) に従う。

Venue Edge の複数 Room 管理は対象に含めない。

## 未確定の後続候補

端末固有の識別・名称を管理する台帳と、認証セッションの個別失効 UI は確定要件に含めない。
