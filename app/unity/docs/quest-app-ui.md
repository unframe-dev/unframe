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

画面はMaterial 3の色の役割と角丸形状を参考にしたラベンダー/紫のテーマです。
各階層はひとつの判断に絞り、資料一覧は3件ずつ表示します。
Questではコントローラーの照準＋トリガー、EditorではGameビューのマウスで操作します。
ルームコードは画面内キーボードで入力できます。

### 接続先とサーバーの準備

配布時は `Quest Presentation Session` の `QuestPresentationSession` に
`Control Plane Endpoint`、`Web Endpoint`、`Device Client Id` を設定します。
両endpointはHTTPSのorigin、client IDは接続先の `DEVICE_CLIENT_ID` と同じ値です
（開発設定の例は `unframe-unity`）。接続設定はアプリに組み込み、利用者向けUIには表示しません。
認証情報はメモリだけに保持します。既存シーンと新規Session componentの初期値は
Control Plane `https://api.un-fra.me`、Web `https://un-fra.me`、client ID `unframe-unity` です。

資料一覧・ルーム作成/参加/開始は実際のControl Plane APIを使います。
ルーム作成後は既存のRuntime準備APIで、登録済みRuntime Hostへの割当と起動完了を確認します。
Runtime Hostが利用できない場合は、ルームコードの発行後に準備待ちとなります。
コード発行とスマホの参加APIだけの確認には、Realtime接続の完了は不要です。
再試行時に同じ資料のルームを重複作成しません。

### 同梱の仮プレゼンで接続を確認

認証後の資料一覧には、サーバー登録済み資料に加えて「仮プレゼン（接続確認）」が表示されます。
これを選び「ルームを作成して接続」を押すと、同梱のコンパイル済み資料を発表者の権限で
登録・素材アップロード・公開し、その公開版からルームを作成します。PCでの資料作成や事前公開は不要です。
発表ごとに資料IDを生成し、別アカウントの仮資料と共有しません。
同じ作成操作の再試行では登録済みの同じbuildを再利用します。

位置合わせ後に「発表を開始」を押すと、通常のRealtime経路で資料を表示します。
ルームコードは作成後の準備・位置合わせ・開始画面と、開始後のXメニューで確認できます。
スマホで `https://app.un-fra.me` を開き、その8文字を入力して参加します。
スマホ側も会場マーカーによる位置合わせが必要です。
画面プレビュー用の「デバッグ：次の画面」は資料公開・ルーム作成・発表を実行しません。

同梱資料は `scripts/unity/quest-demo-source/` の2枚の資料を正式コンパイラーで生成したものです。
クリックで次のページ、次のページの「Back」で前のページへ戻り、端末間の同期を確認できます。
再生成はリポジトリrootで次を実行します。生成先は `Assets/Resources/QuestDemoPresentation/` です。

```sh
nix run .#quest-demo
```

同梱canonical JSONと素材のSHA-256を検証し、登録する資料IDへ定義・RenderBundle・BuildManifestのhashを付け直して公開します。

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
- 発表者は「再生 / 再開」「次へ」「一時停止」「発表を終了」を使います。「次へ」には資料のlogical event設定が必要です。
- 終了には確認が必要です。「接続を解除」は詳細を開いて操作します。
- 「設定」の「到達済みの Step」から直近の開始状態へ戻せます。復元後は一時停止し、明示的な再開を待ちます。
- B/Yまたは「位置合わせ」でマーカー校正をやり直します。カメラ権限が不足するときは「カメラを許可」を表示します。
- 技術的な状態・安全なエラーコード・再接続は「設定」にまとめます。credentialは表示・保存しません。
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

Presenter 用の `PresenterRecognitionCatalog` から Gesture 候補を読み、3D矢印と動く球、日本語の説明で案内します。複数候補は6秒ごとに切り替えます。球は動かす位置の例で、実際の手の追跡表示ではありません。案内の数値は現在の client 内部の認識条件です。

校正・入力同期が未完了、停止中、必要な頭・手の追跡不足、メニュー表示中、Viewer の場合は案内を隠します。Step の入場世代が変わると案内を再設定します。

Presenter client が Gesture を認識し、Runtime が入力 context と Guard を検証して Cue を確定します。ガイドは操作候補の説明であり、候補が必ず採用されることを保証しません。指の pinch 認識は追加していません。

## アプリ配布までの追加作業

今回のUI実装は、ストアへ提出可能になったことを意味しません。

1. 公開Realtime Hostの起動とDNS・TLS設定。既存のRuntime Host・supervisorによる割当と起動を確認し、native gRPCとbrowser WebSocketの両方を転送します。ソース変更だけでは公開サーバーやQuest上のインストール済みAPKは更新されません。
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
同梱資料と公開APIは `QuestDemoPresentationTests` と `QuestDemoPublicationTests` で検証します。
画面描画を除く対象をまとめて実行する場合は、ライセンスが有効なEditorで次を実行します。

```sh
nix run .#unity-editor -- -batchmode -nographics -projectPath "$PWD/app/unity" \
  -runTests -testPlatform EditMode \
  -testFilter 'QuestDemoPresentationTests|QuestDemoPublicationTests|QuestOnboardingApiTests|QuestOnboardingFlowTests' \
  -testResults /tmp/unframe-quest-demo-editmode.xml -logFile /tmp/unframe-quest-demo-editmode.log
```

`QuestPresentationUiVisualTests` は日本語フォントと実URPでメニューを描画し、見切れを検証してPNGを出力します。
これらのEditor試験はQuest実機の快適性や認識精度の代替ではありません。

デザイン参考：[Material 3 Color roles](https://m3.material.io/styles/color/the-color-system)、[Material 3のテーマ設計](https://developer.android.com/codelabs/m3-design-theming)。

## 開始の再試行と外部接続

開始前にSessionの状態を確認し、既にPresentingなら開始POSTを重ねません。開始POSTが競合した場合も状態を再確認し、Presentingへの遷移が確認できた場合だけ継続します。終了済みSessionや不正な応答では開始しません。通信が切れて開始応答だけを失った場合は、再試行で現在状態を確認できます。

外部から認証済み接続を設定した場合は入場UIを完了させ、進行メニューへ移ります。入場UI自身が管理する接続では校正と開始確認を継続します。入口を無効化した場合は途中の入場状態を破棄し、再表示時に選択からやり直します。

回帰条件は `QuestOnboardingStartApiTests`、`QuestOnboardingFlowTests`、`QuestPresentationSessionTests` で検証します。

認証期限切れまたはサーバーの認証拒否時は、元のルームと役割を保持して再承認画面へ戻ります。再承認後は同じSessionへ再接続し、校正と準備状態を確認します。再承認画面から「戻る」を選ぶとルームの保持を解除し、役割選択へ戻ります。`QuestOnboardingRecoveryTests` がこの回帰条件です。
