# Console からの Room 管理と参加導線

更新日: 2026-10-30。状態: 段階的に実装中。Control Plane の所有 Room 一覧と参加コード管理を実装。Console・Quest・Audience の参加導線と無人終了は後続。

Console・Quest・Audience・サーバーの実装担当者向けに、Room 作成から認証・参加・共有・終了までの到達点をまとめる。確定した要件と、後続の詳細計画で判断する事項を分ける。

## 前提と責務

- Room は API 上の Session を指す。状態は `Waiting / Presenting / Ended`。
- Room 作成者は Presenter に固定する。当初検討した、認証済み作成者が Viewer / Presenter を選ぶ機能や、そのための権限モデル変更は行わない。
- 作成者自身が匿名 Viewer として閲覧する場合も、共有された Audience 参加 URL を使える。
- Source 編集・build・Preview・公開は CLI / Local Editor、公開済み資料からの Room 作成・管理とデバイス承認は Console、発表・閲覧は Quest / Audience が担当する。
- 公開済み資料から Room を作り、作成時点の最新公開版を固定する既存の前提は維持する。デバイス認証はアカウントへのログインであり、それだけで特定 Room に参加したことにはならない。
- 全アプリケーションは WIP とし、旧 API・保存形式・発行済み資格との後方互換性や、それらを維持する移行・代替経路は要件にしない。コード更新後の旧資格の維持も検討対象に含めない。

## 確定した利用者導線

### Console: 作成から管理・共有まで

1. ログイン後、公開済み資料の一覧・詳細、または Room 画面から新規 Room を作成する。
2. 作成後は Room 詳細へ進み、参加コード、参加 URL、QR、発表操作に到達できるようにする。
3. サイドバーの「ルーム」からは、自分が作成した Room の一覧へ進む。新規作成だけの画面にせず、既存 Room の詳細へ後から戻れるようにする。
4. Room 詳細で、参加コードの表示・再取得・更新、発表環境の準備、発表の開始・終了を扱う。
5. 同じ詳細画面に「匿名 Viewer で開く」「参加 URL をコピー」「QR コードを生成」の操作を置く。URL と QR は同じ Room の匿名参加先を示す。

### Console と Quest: デバイス承認から既存 Room への参加

1. Quest で認証コードを発行し、スマホ / PC の Console で承認する既存の Device Authorization を使う。
2. Console の「デバイス」画面を一覧画面として整備し、コード入力・承認画面へもたどれるようにする。現在の `/devices` と `/device` の分断を解消する。
3. 一度承認した Quest の認証をアプリ再起動後も保持し、デバイス画面で認証済み端末を確認できるようにする。保持期間は3日を候補とし、固定期限か利用時更新かは未確定。
4. 有効な認証があれば、Quest から自分が作成した Room の一覧を取得し、既存 Room を選んで Presenter として接続する。Console で作成した Room も対象とする。
5. Room 選択後は既存の Runtime 準備・接続・校正を経て発表へ進む。Quest の「資料選択から新規 Room 作成」の既存経路も維持する。

認証保持は、承認後に受け取るアカウントの access token と有効期限を Quest に永続保存し、起動時に復元することで実現できる。一時的な承認用 device code を保存して使い回す方式ではない。期限切れ・失効が判明した資格は破棄して再承認へ進む。保存手段には、[Android Keystore](https://developer.android.com/privacy-and-security/keystore) の鍵による暗号化と [アプリ専用の内部ストレージ](https://developer.android.com/training/data-storage/app-specific) を利用できる。具体的な保存 API と保持期間は詳細計画で決める。

### Quest: Room コードで匿名 Viewer として参加

1. Quest で閲覧を選び、共有された Room コードを入力する。
2. アカウント登録・ログイン・デバイス承認を要求せず、匿名 Viewer 資格を発行する。保存済みの作成者アカウントがあっても、この経路では匿名資格を使う。
3. 匿名資格で資料取得・Realtime 接続・校正を行い、Viewer として閲覧する。Presenter の発表操作権限は与えない。
4. 匿名資格の更新と退出時の失効を参加導線に接続する。アカウントの認証保持とは別に扱う。

### Audience: 共有 URL / QR から匿名参加

1. Room 詳細のリンク、共有された URL、または QR から `app/web/audience` を開く。
2. Audience が URL の参加情報を受け取り、Room コードを再入力せず匿名 Viewer として参加へ進める。Console のアカウント認証や Quest のデバイス承認は要求しない。
3. 既存の資料取得・Realtime 接続・カメラ許可・位置合わせを経て視聴する。Room コードを手入力する既存経路も維持する。

## Room の識別・コード・権限

- 参加コードは Room に紐づけ、権限のある作成者が後から再取得できるようにする。詳細画面を開き直しても、参加 URL と QR を再生成できること。
- コードを更新しても Room 自体は維持する。更新後の詳細画面から新しいコード・URL・QR を取得でき、以前のコード・URL・QR は新規参加に使えなくする。
- Presenter としての参加・発表操作は作成者の認証に基づける。参加コードや共有 URL を知っているだけで Presenter 権限を与えない。
- Room の終了後は参加できない。明示終了・コンテンツ終端による既存の終了経路は維持する。

## 無人時の終了と Runtime の収容数

- Room 作成時刻から一定時間経過したことを理由には自動終了しない。作成後まだ誰も接続していない Room に、作成時刻起点のタイマーは設けない。
- 実際に接続している参加者がゼロになった時点から、誰も再入室しない状態が10分続いたら Room を `Ended` にし、Runtime の割り当て・実行資源を解放する。登録済み参加者数では判定しない。
- 10分以内に誰かが再入室したら無人タイマーを解除する。再びゼロになった時点から新たに10分を計測する。
- Presenter の切断や一時停止だけでは、Viewer が接続している Room を終了しない。
- Cloud Runtime Host は同一プロセス・接続先で複数 Room を扱い、Room ごとの状態を分離する。Room 作成と割り当ては別で、発表環境の準備から Host の枠を使う既存方式を維持する。
- 配備設定例の `REALTIME_HOST_CAPACITY` は5に変更済み。稼働環境への反映・5 Room の収容負荷確認は未実施。Venue Edge の複数 Room 管理は今回の対象に含めない。

## 現行実装との差分

以下は調査時点の現行動作であり、上記の導線が既に完成していることを意味しない。

| 対象                 | 現行動作と不足                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Console の Room 画面 | `/rooms` は公開資料からの新規作成画面。所有 Room 一覧はない。詳細には準備・開始・終了があるが、コード再取得・更新や参加 URL / QR はない。                                                     |
| デバイス管理         | `/device` の承認は実装済み。`/devices` は仮画面で承認画面への入口もない。`/settings/security` に認証セッション一覧・他セッション一括失効はあるが、端末管理ではない。                          |
| Quest                | Device Authorization、新規 Room 作成、認証済み Viewer のコード参加はある。認証はメモリ保持で、永続保存・所有 Room 一覧・既存 Room への Presenter 参加・匿名資格を発行して参加する UI はない。 |
| Audience             | 匿名 Viewer のコード入力参加はある。参加 URL の情報を読み取る入口はない。                                                                                                                     |
| Control Plane        | 作成・コード参加・取得・開始・終了に加え、作成者の Room 一覧と現在コードの取得・更新を提供する。コードは通常の Session 応答には含めず、更新後の旧コードは新規参加に使えない。                 |
| Realtime             | Presenter 切断時は実行を一時停止する。実接続者がゼロになってから10分後に Room を終了する機能はない。                                                                                          |

確認先: [Console](../../app/web/console/README.md)、[Quest onboarding](../../app/unity/Assets/Scripts/MR/Session/QuestOnboardingView.cs)、[Audience 入口](../../app/web/audience/src/connection/AudienceApplication.tsx)、[Session API](../../app/server/control-plane/src/modules/sessions/routes.ts)、[Runtime presence](../../app/server/realtime/internal/runtimecore/v2_presence.go)。

## 未確定事項と後続の詳細計画

次は会話中の候補・実装案であり、確定要件として扱わない。

- デバイス認証の保持期間を3日にするか、固定期限・利用時更新のどちらにするか。端末の識別・表示項目、個別失効 UI、資格保存の具体的な API と更新方式。
- 参加 URL の形式、開いた直後に自動参加するか確認画面を出すか、QR の表示・保存方法。
- 無人判定の信頼境界、切断検知、再入室と終了の競合、Host 再起動・障害時の計時と終了確定。

後続は契約・保存、Control Plane、Realtime、Console、Quest、Audience、運用に分けて計画する。API の形、DB schema、レイヤーごとの実装・検証手順はその際に決める。実装経緯は [複数 Session 管理](realtime-runtime-redesign.md) と [Presenter 認識の残作業](presenter-recognition-runtime-authority-refactor.md) を参照する。
