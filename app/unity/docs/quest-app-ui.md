# QuestアプリのUIとモーション案内

現在はサーバー経由で資料を読み込むQuest単体利用を対象とします。複数端末の同期の製品化とiPhoneは後続です。
発表者と観客の表示は既存のSession roleを使って分離し、将来の同時参加でも同じ役割境界を使います。

## 起動から入場まで

`Unframe > Presentation > Open Quest Presentation` でシーンを開き、Playすると役割選択から始まります。
既存シーンはSession.Startで入口を構成するため、シーンの再生成は不要です。

- 発表者：役割選択 → スマホ/PCで端末コードを承認 → 資料選択 → ルーム作成・接続待ち → 位置合わせ → 発表開始。
- 観客：役割選択 → ルームコード入力 → 未認証なら端末コードを承認 → 参加確認 → 位置合わせ → 鑑賞。

観客にも既存Control Planeの認証が必要です。役割選択は希望する導線を選ぶもので、
権限は接続後にサーバーが返すPresenter/Viewerと照合します。
端末認証コードはスマホ側の `/device` に入力し、ルームコードはQuest側へ入力します。
認証トークンを利用者が手入力する必要はありません。

画面は濃紺の面・白い文字・ミントの主操作で統一し、主操作の文字には濃紺を使います。
役割選択は、資料を選んでルームを作る発表者と、共有コードで参加する観客の操作を説明付きで表示します。
各階層はひとつの判断に絞り、資料一覧は3件ずつ表示します。
Questではコントローラーの照準＋トリガー、EditorではGameビューのマウスで操作します。
ルームコードは画面内キーボードで入力できます。
位置合わせ画面では「マーカー待ち」「位置合わせ完了・接続待ち」「準備完了」を区別します。
位置合わせと役割に必要な接続準備が整うまで「次へ」と「開始」は無効にし、準備を失った場合も再確認を待ちます。

### 接続先とサーバーの準備

配布時は `Quest Presentation Session` の `QuestPresentationSession` に
`Control Plane Endpoint`、`Web Endpoint`、`Device Client Id` を設定します。
両endpointはHTTPSのorigin、client IDは接続先の `DEVICE_CLIENT_ID` と同じ値です
（開発設定の例は `unframe-unity`）。接続設定はアプリに組み込み、利用者向けUIには表示しません。
認証情報はメモリだけに保持します。追跡済みQuestPresentationSceneは `https://api.un-fra.me`、`https://un-fra.me`、`unframe-unity` を設定しています。別環境へ配布する場合は3項目をその環境に揃えてください。

資料一覧・ルーム作成/参加/開始は実際のControl Plane APIを使います。
ただし、現行サーバーの新規ルーム作成はRuntimeの自動割り当てを行いません。
別途Runtime assignmentと稼働中のRealtimeが必要で、未準備時は接続待ちとして表示します。
再試行時に同じ資料のルームを重複作成しません。

### デバッグで画面だけ確認

Unity EditorまたはDevelopment Buildで発表者を選ぶと、通常の主操作とは別に
「デバッグ：次の画面」が表示されます。認証・資料取得・接続・校正をせずに次の階層を確認できます。
最後は「画面プレビュー」と明示し、再生せずに最初の画面へ戻ります。
実機へは `Unframe > Presentation > Build And Run Quest Development` を使います。
APKだけ作る場合は `Build Quest Development APK` です。出力は `Builds/QuestPresentation-Development.apk`。
これらはローカルMeta DevAgent設定をビルド時だけ除外して復元します。
標準のBuild And Runは、ローカル設定が存在すると混入防止チェックで停止します。
観客と通常リリースビルドにはこのボタンを表示しません。

## 操作

- Xでメニューを開閉。開くたびに頭の前方の水平な位置へ配置し、開いている間は頭へ追従させません。
- 発表者は「再生 / 再開」「一時停止」「位置合わせ」を使います。logical eventの接続設定がある場合だけ「次へ」を表示します。
- メニューの「ルームから退出」はこの端末だけの接続解除です。確認して退出すると役割選択へ戻ります。
- 「ガイドと設定」の「全員の発表を終了」はルーム全体の再生終了です。退出と異なる確認画面で確定します。
- メニューを開き直すと主操作へ戻ります。ガイド表示・説明量の選択は端末内で維持します。
- 「設定」の「到達済みの Step」から直近の開始状態へ戻せます。復元後は一時停止し、明示的な再開を待ちます。
- B/Yまたは「位置合わせ」でマーカー校正をやり直します。カメラ権限が不足するときは「カメラを許可」を表示します。
- 技術的な状態・安全なエラーコード・再接続は「ガイドと設定」にまとめます。credentialは表示・保存しません。
- 観客のViewer roleでは発表者用ボタンと技術詳細を隠し、鑑賞メニューには位置合わせ・必要な再接続・自身の接続解除だけを残します。準備完了時は資料のみ表示します。
- 操作メニューを閉じると、背景の資料へのray入力を遮りません。Runtimeの権限・校正・同期の条件は変えません。

日本語UIは同梱Noto Sans CJK JPを使用します。ライセンスは `Assets/Resources/PresentationUi/OFL.txt` にあります。
本番の校正カメラの診断UI・診断ボタン入力は隠し、通常の操作メニューに統合します。

## 本番モーションの3D案内

Authoring の Cue trigger に Gesture の種類を指定し、正式コンパイラーでビルド・公開します。

```ts
trigger: {
  kind: "gesture",
  gesture: "swipeLeft",
}
```

Gesture は `swipeLeft` / `swipeRight` / `swipeDown` / `swipeUp` / `pushForward` / `pullBackward` / `spreadHands` / `closeHands` の8種類です。片手動作は左右どちらでも同じ種類として扱い、距離・時間窓・手の指定は Authoring に持たせません。`examples/presentation` はクリックまたは左スワイプで同じ次の状態へ進む例です。

Presenter 用の `PresenterRecognitionCatalog` から Gesture 候補を読み、低めの位置の状態カードと3D矢印・動く球で案内します。複数候補は6秒ごとに切り替え、候補数を表示します。球は動かす位置の例で、実際の手の追跡表示ではありません。

通常は短い操作説明を表示します。「ガイドと設定」でガイド全体を非表示にしたり、距離・時間条件を含む詳しい説明へ切り替えたりできます。数値は現在の client 内部の認識条件です。

校正・入力同期・頭や手の追跡待ち、一時停止、場面切り替え中は、矢印を隠して待機理由と必要な操作を説明します。候補が空でも完了とは判断しません。Zoneだけがある場合は立ち位置を使う候補があることを案内します。

メニュー表示中、Viewer、切断・終了時は動作ガイドを隠します。Stepの入場世代が変わると案内を再設定します。メニューを閉じた発表者には、状態と「X：操作・設定・退出」の小さな表示を残します。

Presenter client が Gesture を認識し、Runtime が入力 context と Guard を検証して Cue を確定します。ガイドは操作候補の説明であり、候補が必ず採用されることを保証しません。指の pinch 認識は追加していません。

## アプリ配布までの追加作業

今回のUI実装は、ストアへ提出可能になったことを意味しません。

1. 配布先の接続設定とRuntime割当運用。入口UIは実装済みですが、新規ルームへのRuntime自動割当はサーバー側の追加作業です。
2. 製品識別。正式なAndroid package ID、会社名・アプリ名、アイコン、version/codeを確定します。現在はテンプレートの設定が残っています。
3. 配布用署名とビルド。keystoreはrepository外で保管し、更新版にも同じ署名を使える運用を作ります。Android Build Supportはこの開発ホストに未導入です。
4. 対応機種。現在のマーカーカメラ校正はQuest 3/3S・Horizon OS v74以降を前提にし、Manifestの対応端末指定と揃える必要があります。
5. 実機受入。両眼の文字サイズ、コントローラー入力、15分の負荷・発熱・位置ずれ、権限拒否、休止復帰、再校正と再接続を確認します。
6. 配布方法。まず限定Release Channelで確認し、一般公開する場合はVRC・プライバシーポリシー等の提出準備を進めます。

Meta公式の[カメラ対応条件](https://developers.meta.com/vr/documentation/native/android/pca-native-overview/)、
[Release Channels](https://developers.meta.com/vr/resources/publish-release-channels/)、
[提出手順](https://developers.meta.com/vr/resources/publish-submit/)を参照してください。

## 検証

今回の入口変更はUnity Test RunnerのEditModeで `QuestOnboardingFlowTests`、`QuestOnboardingApiTests`、
`QuestOnboardingVisualTests` と既存の `QuestPresentationStatusViewTests` に絞って検証します。
`QuestPresentationUiVisualTests` は日本語フォントと実URPでメニューを描画し、見切れを検証してPNGを出力します。
これらのEditor試験はQuest実機の快適性や認識精度の代替ではありません。

デザイン参考：[Material 3 Color roles](https://m3.material.io/styles/color/the-color-system)、[Material 3のテーマ設計](https://developer.android.com/codelabs/m3-design-theming)。

## 複数端末テストの接続ログ

「テストログを保存」（MR）／「接続テストログを保存」（WebXR）から、接続・取得・送受信・同期の履歴をJSONで保存できます。保存先と端末間の比較手順は[複数端末の検証手順](../../../docs/validation/multi-device-session-diagnostics.md)を参照してください。認証情報・素材URL・カメラ画像は含みません。
