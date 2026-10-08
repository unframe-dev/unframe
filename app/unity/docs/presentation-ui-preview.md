# QuestのプレゼンUIプレビュー

`QuestPresentationUiPreview` は、サーバー未接続で開始から退出までの操作を確認する専用シーンです。既存のDelivery / Snapshot / Reliable Event fixtureとマーカー校正を使用します。認証・ルーム参加・作成は画面のプレビューであり、アカウントやオンラインルームを作成しません。端末間の進行は同期しません。

## 開く・ビルドする

Unityの `Unframe > UI > Open Presentation UI Preview` で開きます。`Build Presentation UI Preview APK` または `Build and Run UI Preview on Quest` でQuest 3 / 3Sへビルドします。出力は `Builds/PCA/unframe-presentation-ui-preview.apk`、アプリIDは `dev.unframe.ui.preview` です。マーカー認識には既存のOpenCV for UnityとAndroidの `UNFRAME_OPENCV_FOR_UNITY` が必要です。

標準BuildのScene一覧も `QuestPresentationUiPreview` のみです。シーンを削除した場合は、上記のOpenメニューから専用のMRリグ・校正・UI配線を再生成できます。旧ArUco検証シーンのコピーは使用しません。

`Unframe > Diagnostics > ArUco` はカメラ・校正の診断、`Unframe > Diagnostics > Network` はサーバー接続の検証に残しています。印刷マーカー生成とOpenCVサンプル管理は `Unframe > Tools` にまとめています。

既存の検証シーンから独立しているため、カメラ診断や座標の補助表示は通常UIに出ません。認識中・マーカー発見・静止待ち・校正完了を中央UIで確認できます。カメラ権限が不足する場合はRetryから再要求します。

## 操作を確認する

右コントローラーのポインターをボタンへ向け、トリガーで選択します。EditorではGameビューをクリックできますが、カメラ校正はQuest実機で行います。画面の英語表示は既存の組み込みフォントを使用しています。

1. Audienceを選択するとルームコード入力に進みます。任意の6桁の数字を入力してJoin previewを選びます。コードは接続先の検索には使用しません。
2. Presenterを選択すると認証のプレビューに進みます。Continue in previewでプレゼン選択へ進み、Sample presentationを選択してCreate preview roomを押します。認証情報は入力・保存しません。
3. ID 0、黒枠20cmのArUcoマーカーを正面から映します。認識の進捗が表示され、完了後にStart presentationを押すと表示を開始します。
4. PresenterではUIに表示された腕モーション、NextまたはAで進行し、Xで先頭へ戻せます。アニメーション中はNextが無効になります。Audienceには進行操作権限がありません。
5. Realignで表示を隠して再測定します。プレゼンの進行位置は保持され、校正完了後にStart presentationで復帰します。追跡喪失やスリープ復帰も再測定へ戻ります。
6. Leaveを選択し、Stayで取消、Leave presentationで退出します。退出するとfixtureと校正を解除し、役割選択へ戻ります。

開始前・退出確認中は進行入力を受け付けません。従来のSpace/Enterによる検証入力もこのシーンでは無効です。

## 実装の境界

`PresentationUiFlow` はUnity非依存の画面状態と遷移、`QuestPresentationFlowView` は表示と操作イベント、`QuestPresentationUiController` は既存のローカルRuntime・校正との接続を担当します。表示に独自のPNG配信経路や通信プロトコルは追加していません。

サーバー接続は未実装です。接続時には認証・ルーム操作の結果から既存の `QuestPresentationSession` へ接続し、読み込み・接続状態をUIへ渡す実装が必要です。このプレビューだけで本番の認証や同期が完了したことにはなりません。

## 検証状況

2026-10-08にOpenCV有効構成のUnity EditModeテスト516件が成功しました。役割別の入力制御、校正完了と開始の分離、開始前の退出確認で表示しないこと、退出後のfixture解放、診断表示抑制を含みます。各画面をUnityから描画し、配置と文字切れも確認しています。Quest向けARM64 IL2CPP APKのビルドも成功しています。

新UIのQuest実機操作は未確認です。右トリガーによる選択、カメラ権限、再測定からの復帰、退出後の再参加を実機で確認してください。リポジトリ全体の `nix run .#check` はUnity以外のCLIテスト23件で失敗しており、全体ゲートの成功は未確認です。

腕の動作と場面別設定は [腕モーションの手順](arm-motion-presets.md) を参照してください。
