# 検出処理の最大頻度化

> 履歴（2026-10-22）：現在の実装は[AprilTag採用方式](./audience-apriltag-adopted.md)のみ。以下は当時の方式・スキーマ・実証の記録であり、削除済みの比較モードやコマンドを現行仕様として使用しない。

2026-10-21。比較モードanchorの固定2Hzを撤廃。解像度・タグ姿勢の受入条件・AprilTagのquad_decimate=1とrefine_edges=1は維持する。実機の実効Hzは次のログで測定する。

## 変更

- SDKが連続5秒NORMALになった後に検出開始。前回の検出と結果処理が終わり次第、SDKの次の取得可能な画像を使用する。待ち行列・複数同時投入は作らない。SDKのrepeatFrameは従来通り除外する。
- anchorは選択したAprilTagまたはArUcoのみ初期化・実行する。未実行側は`executed:false`、0件・0msで記録し、未検出と区別する。SDK負荷比較・タグ単独・合成ラボは従来の両検出器条件を維持する。
- anchorのグレー画素bufferをWorkerへTransferableで移譲し、結果と一緒に返却する。元のFiducialFrame.pixelsを復元してから姿勢計算・同一画像描画へ渡す。移譲中は画素を参照しない。送信内容はwidth/height/pixelsに限定し、metadataをコピーしない。SDK画像のreadback・WASMヒープへのコピーは残る。
- 比較画像の更新のみ最大5Hz。画像背景と両推定の重畳は同じフレームで一括更新する。位置推定・差の計算・JSON記録はすべての配信結果で実行する。表示画像に対応する時刻と数値を表示する。
- 描画用ImageDataをcanvas毎に再利用し、サイズが変わった場合だけcanvas解像度とバッファを再確保する。全画素を上書きするため古い重畳は残さない。

直近ログの中央値はGPU読み出しまで約7ms、グレー化約9ms、AprilTag約83ms、ArUco約30ms、結果まで約145ms。選択検出器化は不要なArUco約30msを除く見込みだが、端末の実効Hz・発熱・SDKへの影響は未測定。画素数を下げたり精度設定を緩めて得た高速化ではない。最大速度でも入力映像FPS・処理時間・メインスレッド負荷が上限となる。

## 記録

anchorはschema16。`experiment.detectionHz`は`maximum`、`detectorExecution`はselected-only、`pixelTransport`はtransfer-and-return、`previewMaximumHz`は5。adapterのexperimentへ実際のselection/transfer状態も保存する。

`measurementSnapshot.performance`に直近2秒の投入・完了時刻から計算したcaptureHz/completionHzと、取得callbackから完了までの総時間・最大時間、結果利用処理の総時間・最大時間を保存する。Hzは2件未満ならnull。停止後に時間窓を外れた値もnullになり得る。タイミング集計はadapter通算。`experiment.worker-completed`に実効Hzと検出器選択を記録。frameごとのpreviewUpdatedで表示更新の有無を判定する。画像画素はJSONへ保存しない。

全件記録のため高頻度ではリング上限へ早く到達する。droppedSamples/droppedTransitionsを確認し、短い静止→回転→横移動の試行を保存する。

## 検証

ユーザー指定に従い回帰テストは追加・実行しない。モックWorkerで選択初期化、clone経路、転送中のdetachと返却後の復元、subarray offset保持、metadata非転送、送信例外後の再実行を軽く確認した。モックSDKで開始前readbackゼロ、選択/転送設定、768×1024維持、busy中の新規取得抑制、完了後に固定500ms待ちなしで次を取得、Hz集計を確認した。実カメラ・GPU性能は実証していない。型検査・lint・本番ビルドを実施する。全体品質ゲートは軽いデバッグ指定に従い実施しない。

型検査・lint・本番ビルドは成功。公開HTTPSのentry JavaScriptとローカル最終ビルドの一致を確認。実効Hzの実機測定・回帰テスト・全体品質ゲートは未実施。未コミット。
