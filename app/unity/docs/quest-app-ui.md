# QuestアプリのUIとモーション案内

現在はサーバー経由で資料を読み込むQuest単体利用を対象とします。複数端末の同期の製品化とiPhoneは後続です。
発表者と観客の表示は既存のSession roleを使って分離し、将来の同時参加でも同じ役割境界を使います。

## 起動から入場まで

`Unframe > Presentation > Open Quest Presentation` でシーンを開き、Playすると役割選択から始まります。
既存シーンはSession.Startで入口を構成するため、シーンの再生成は不要です。

- 発表者：役割選択 → 必要ならスマホ/PCで端末コードを承認 → 所有ルーム一覧 → 既存ルームを選択、または資料を選んで新規作成 → 発表環境の準備・接続 → 位置合わせ → 発表開始。
- 観客：役割選択 → ルームコード入力 → 匿名で参加確認 → 位置合わせ → 鑑賞。アカウント登録・端末承認は不要です。

発表者は作成者アカウント、観客はRoomに紐づく匿名Viewer資格を使います。保存済みのアカウントがあっても観客参加では利用しません。
権限は接続後にサーバーが返すPresenter/Viewerと照合します。
端末認証コードはスマホ側の `/device` に入力し、ルームコードはQuest側へ入力します。
認証トークンを利用者が手入力する必要はありません。

画面はMaterial 3の色の役割と角丸形状を参考にしたラベンダー/紫のテーマです。
役割選択から、発表する操作と共有コードで鑑賞する操作を選びます。
各階層はひとつの判断に絞り、資料と所有ルームの一覧は3件ずつ表示します。所有ルームは続きのページも取得できます。
Questではコントローラーの照準＋トリガー、EditorではGameビューのマウスで操作します。
ルームコードは画面内キーボードで入力できます。
位置合わせ画面では、マーカーの確認中か位置合わせ済みかを表示します。
位置合わせと役割に必要な接続準備が整うまで「次へ」と「開始」は無効にし、準備を失った場合も再確認を待ちます。
発表者の共有コードはハイフンなしの8文字で表示し、参加準備画面と発表開始後の操作メニューで確認できます。

### 接続先とサーバーの準備

配布時は `Quest Presentation Session` の `QuestPresentationSession` に
`Control Plane Endpoint`、`Web Endpoint`、`Device Client Id` を設定します。
両endpointはHTTPSのorigin、client IDは接続先の `DEVICE_CLIENT_ID` と同じ値です
（開発設定の例は `unframe-unity`）。接続設定はアプリに組み込み、利用者向けUIには表示しません。
Androidでは承認後のアカウントtokenと応答の `expires_in` から算出した期限をAndroid KeystoreのAES/GCM鍵で暗号化し、アプリ内部のバックアップ対象外ファイルへ保存します。API origin・client IDごとに分離し、再起動時に復元します。期限切れ・401では破棄して再承認し、利用時に保存期限を延長しません。Editorでは永続保存しません。匿名Viewer資格はメモリだけに置き、期限前に更新し、退出・取消・破棄時に失効を要求します。ネットワーク断で応答を得られない場合の即時失効は保証できません。

追跡済みQuestPresentationSceneは `https://api.un-fra.me`、`https://un-fra.me`、`unframe-unity` を設定しています。別環境へ配布する場合は3項目をその環境に揃えてください。

資料一覧・ルーム作成/参加/開始は実際のControl Plane APIを使います。
ただし、現行サーバーの新規ルーム作成はRuntimeの自動割り当てを行いません。
発表者は選択したRoomの発表環境を準備し、稼働確認後に接続します。利用可能なRuntime Hostがない場合は同じRoomで準備を再試行します。
再試行時に同じ資料のルームを重複作成しません。

### マーカーサイズの切替

「空間に位置を合わせる」画面で500・400・250・150mmを選択します。既定は150mmです。
寸法はAprilTag ID 0の黒い正方形の一辺で、白い余白や用紙全体は含みません。
Audience WebXR側でも同じ寸法を選び、印刷物の黒枠を定規で実測してください。
切り替えると旧寸法の校正と処理中の観測を破棄し、位置合わせをやり直します。

### 開発用ビルド

実機へは `Unframe > Presentation > Build And Run Quest Development` を使います。
APKだけ作る場合は `Build Quest Development APK` です。出力は `Builds/QuestPresentation-Development.apk`。
これらはローカルMeta DevAgent設定をビルド時だけ除外して復元します。
標準のBuild And Runは、ローカル設定が存在すると混入防止チェックで停止します。
入口UIの描画は `QuestOnboardingVisualTests` で各階層を確認します。

## 操作

- Xでメニューを開閉。開くたびに頭の前方の水平な位置へ配置し、開いている間は頭へ追従させません。
- 発表者は「再生 / 再開」「次へ」「一時停止」を使います。「次へ」と右コントローラーのAボタンは、現在のRuntime Viewで公開された `presenter.next` 論理入力を送信します。明示的なlogical event接続設定がある場合はその名前を使い、現在公開されていない入力は送信しません。Presenter権限・位置合わせ・同期が整い、再生中で操作可能な状態のときだけ有効です。
- 「設定」の「接続を解除」はこの端末だけの接続解除です。役割選択へ戻ります。
- 「設定」の「発表を終了」はルーム全体の再生終了です。確認画面で確定します。
- 「設定」の「到達済みの Step」から直近の開始状態へ戻せます。復元後は一時停止し、明示的な再開を待ちます。
- B/Yまたは「位置合わせ」でマーカー校正をやり直します。カメラ権限が不足するときは「カメラを許可」を表示します。
- 技術的な状態・安全なエラーコード・再接続は「設定」にまとめます。credentialは画面・診断ログ・Sceneに含めません。
- 観客のViewer roleでは発表者用ボタンと技術詳細を隠し、鑑賞メニューには位置合わせ・必要な再接続・自身の接続解除だけを残します。準備完了時は資料のみ表示します。
- 操作メニューを閉じると、背景の資料へのray入力を遮りません。Runtimeの権限・校正・同期の条件は変えません。

資料の配布データには、送信名に対応する論理入力Cueが必要です。現行のAuthoringのCue宣言は `logicalInput` を受け付けないため、その資料をソースから作成するための対応は制作基盤側の作業です。アプリの送信処理だけでページ遷移を追加することはできません。

位置合わせ後も「発表を開始」または「資料を見る」が完了するまでは資料を隠します。校正用の立方体と軸は入場後に隠し、再校正が必要になった場合に表示します。

Quest向けMobile URPの描画倍率は1.0、World Space Canvasの文字描画密度は2倍です。UIの実寸と配置を変えずに文字を細かく描画します。

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

Presenter 用の `PresenterRecognitionCatalog` から Gesture 候補を読み、左右独立の腕モデルのアニメーションと日本語の説明で案内します。複数候補は6秒ごとに切り替えます。腕は操作の見本で、実際の手の追跡表示ではありません。説明パネルは透明な腕モデルより後に描画し、動作中も文字を読めるようにします。案内の位置は頭の移動と視線の左右の回転に滑らかに追従し、上下の回転や首の傾きでは移動しません。腕の基準位置は頭から50cm、水平な視界の右下へ配置します。画角と縦横比から周辺位置と表示倍率を決め、狭い画角では小さくして画面内に収めます。腕は元の10%を基準にし、説明は腕より少し上へ置きます。説明パネルは位置の追従と独立して実際のカメラ位置に正対するため、斜め下でも文字が斜視で潰れません。「左へ薙ぎ払う」「振りかぶる」などの短い一言で動作を示します。

提供モデル `LowPolyArms10.fbx` を左右に分離した `Resources/PresentationUi/MotionArms/LowPolyArmLeft.fbx` と `LowPolyArmRight.fbx` を使用します。各モデルは Root と片腕18本のボーン、元のウェイトを保持しています。実行時は `Resources/PresentationUi/MotionArms/Editable/LeftMotionArm.prefab` と `RightMotionArm.prefab` の Animator で、左右8種類ずつの標準Animationクリップを再生します。片手動作は追跡できる手を1本、両手動作は2本を表示します。

腕の肩側が発表者を向くよう、モデルをY軸で180度回転します。説明文字や左右・前後の移動方向は反転させません。

腕のアニメーションは保存済みの16個の `.anim` と左右のController・Prefabを使用します。実行時にBezierやIKで骨を上書きしないため、Animationウィンドウの調整がそのまま再生に反映されます。前方向はローカルZ+です。

腕の動きを手で調整する手順：

1. Playモードを停止します。
2. `Unframe > Presentation > Open Arm Animation Editor` で左腕、`Open Right Arm Animation Editor` で右腕のPrefabを開きます。Animationウィンドウも表示されます。
3. Animationウィンドウで調整したいクリップを選び、再生位置を合わせます。Recordを有効にして、Prefab内の肩・肘・手首や指のボーンを回転させ、キーを記録します。
4. Curvesでキーと接線を調整して緩急を付けます。フェードはPrefabルートの `QuestMotionArmAppearance.Opacity` のカーブで変更します。
5. Recordを解除してクリップとPrefabを保存し、Animationウィンドウで再生を確認します。

校正・入力同期が未完了、停止中、必要な頭・手の追跡不足、メニュー表示中、Viewer の場合は案内を隠します。Step の入場世代が変わると案内を再設定します。

Presenter client が Gesture を認識し、Runtime が入力 context と Guard を検証して Cue を確定します。ガイドは操作候補の説明であり、候補が必ず採用されることを保証しません。指の pinch 認識は追加していません。

### トリガーでモーションを開始する

片手の操作は、その手のコントローラーのトリガーを押した瞬間の位置と頭の水平な向きを開始点にします。静止待ちは不要です。トリガーを保持したまま0.8秒以内に18cm以上動かすと、開始位置からの変位の最大軸で左右・上下・前後を判定します。操作していない手の動きや追跡切れは片手操作に影響しません。動作中に頭を回しても開始時の基準方向を保ちます。

両手を広げる・寄せる操作は両方のトリガーを押します。2つ目を押した瞬間に両手の開始位置を記録し、両方を保持したまま手同士の距離を25cm以上変えて判定します。トリガーを離す、必要な手や頭の追跡を失う、制限時間を超えると中止します。1回の押下では1回だけ送信し、続ける場合は離して押し直します。資料の候補にない準備動作だけでは認識を消費しません。

メニュー表示中・一時停止中・同期未完了では認識を停止します。その間に押したトリガーや、メニューの操作に使ったトリガーは、離して押し直すまでモーションを開始しません。現在のStepにジェスチャー候補がある間は、トリガーを資料内のクリックと兼用しません。Aボタン／メニューの「次へ」は独立した論理入力です。Zoneの出入りの判定は従来どおり腰位置を使います。

認識は端末の毎フレームで実行し、姿勢送信の10Hzとは別です。遅い動作や斜めの動作は時間・距離条件や方向分類で取りこぼす可能性があります。診断の `control.sent` に `GestureInput` がなければ端末側の押下・認識・追跡条件を、送信後の `control.outcome` が拒否ならStep・同期・Runtime条件を調べます。

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

`QuestRoomParticipationTests` は承認後の保存・復元、期限切れ・失効、所有Room選択、匿名資格の更新と退出・取消・破棄の競合を検証します。関連する入口・開始・復旧はUnity Test RunnerのEditModeで確認します。
`QuestPresentationUiVisualTests` は日本語フォントと実URPでメニューを描画し、見切れを検証してPNGを出力します。
Android Keystore／JNIとQuestからの実接続は実機受入が必要です。Linuxのheadless Editorでは、`QuestOnboardingExperienceTests` の `AlignmentCannotAdvanceBeforeCalibrationAndConnectionAreReady` と `StartCannotBePressedBeforeReadiness` がPlay Mode移行後の `OVRPlugin` 不在で失敗します。これらのEditor試験はQuest実機の快適性や認識精度の代替ではありません。

デザイン参考：[Material 3 Color roles](https://m3.material.io/styles/color/the-color-system)、[Material 3のテーマ設計](https://developer.android.com/codelabs/m3-design-theming)。

## 複数端末テストの接続ログ

接続・取得・送受信・同期の履歴を端末内で記録します。MRは `QuestPresentationSession.ExportDiagnostics()` でJSONを保存でき、製品メニューには保存ボタンを表示しません。WebXRは「接続テストログを保存」から保存します。保存先と端末間の比較手順は[複数端末の検証手順](../../../docs/validation/multi-device-session-diagnostics.md)を参照してください。認証情報・素材URL・カメラ画像は含みません。

## 開始の再試行と外部接続

開始前にSessionの状態を確認し、既にPresentingなら開始POSTを重ねません。開始POSTが競合した場合も状態を再確認し、Presentingへの遷移が確認できた場合だけ継続します。終了済みSessionや不正な応答では開始しません。通信が切れて開始応答だけを失った場合は、再試行で現在状態を確認できます。

外部から認証済み接続を設定した場合は入場UIを完了させ、進行メニューへ移ります。入場UI自身が管理する接続では校正と開始確認を継続します。入口を無効化した場合は途中の入場状態を破棄し、再表示時に選択からやり直します。

回帰条件は `QuestOnboardingStartApiTests`、`QuestOnboardingFlowTests`、`QuestPresentationSessionTests` で検証します。

発表者の認証期限切れまたはサーバーの認証拒否時は、元のルームと役割を保持して再承認画面へ戻ります。再承認後は同じSessionへ再接続し、校正と準備状態を確認します。再承認画面から「戻る」を選ぶとルームの保持を解除し、役割選択へ戻ります。匿名Viewerの資格を失った場合は端末承認を要求せず、入力済みコードの参加確認へ戻ります。`QuestOnboardingRecoveryTests` がこの回帰条件です。

### 発表者のページ・経過時間表示

発表中は頭から50cm、水平な視界の左下に現在ページと経過時間を表示します。モーション補助UIと同じ距離と画角基準を使い、頭の移動と左右の回転に追従します。上下の回転や首の傾きでは位置を変えず、パネルの向きだけをカメラへ正対させます。メニュー表示中は隠します。

発表者用パネルは既存の角丸Spriteを共有し、約78%不透明の暗い半透明面を使います。ページは大きい白文字、経過時間は小さい青灰色の文字で区別し、文字の影で明るい背景でも輪郭を保ちます。実空間をぼかす処理は使いません。パネルや文字はレイキャストを受けず、発表の操作を妨げません。

現在ページは、現在のSurface状態のSemanticTreeにある明示的なページ番号ノードから読み、「1ページ目」の形式で表示します。資料側のSemanticノードのローカルIDは `presentation.pageNumber`、テキストは正の整数です。コンポーネント名で修飾されたIDも扱います。未取得・不正・複数Surface間で不一致の場合は「—」を表示します。Step名やStep訪問回数からページ番号を推測しません。

経過時間は、この端末でそのSessionの最初の再生中状態を受信した時点からの実時間です。一時停止中や同じSessionへの再接続中も進み、別のSessionに接続するとリセットします。アプリ再起動前や接続前の時間は含みません。
