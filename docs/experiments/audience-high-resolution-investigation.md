# 7m距離推定：高解像度入力の確認と実験計画

> 履歴（2026-10-22）：現在の実装は[AprilTag採用方式](./audience-apriltag-adopted.md)のみ。以下は当時の方式・スキーマ・実証の記録であり、削除済みの比較モードやコマンドを現行仕様として使用しない。

- 更新日: 2026-10-20
- 状態: R0の寸法・出自計測を実装し、tagの実機ログ1本を確認。anchorの新ログは未取得。高解像度取得・ROI・5枚補正は未実装。
- 要求: 初回7m、表示ずれ約10cm、マーカー不可視5〜10分。5枚全体の設置外寸50×70cm。
- コード基準: `webXR/tracking-poc`の作業中ファイル。HEADは`73800e2c8ff8545e315edc4b1b7bfbbd597511da`だがAudienceは未コミットのため、このcommit単独では再現できない。

## 1. 採用する検証方針

実際の高解像度入力を確保し、元画素を保った対象領域の角検出、カメラ較正、既知配置5枚の共通姿勢推定、継続補正の順に評価する。距離の問題を、ID検出だけの改善と混同しない。

1. **入力を確認する**: カメラ取得条件、SDKの映像寸法、元テクスチャ、姿勢推定用テクスチャ、表示canvas、検出入力を区別する。
2. **縮小・切抜きの影響を確認する**: 元の情報が失われる場所を特定する。表示canvasのDPRやアップスケールを実解像度の増加と数えない。
3. **高解像度の角を使う**: 初回は高解像度全体またはタイル探索、捕捉後は元解像度のROIで角を精密化する。低解像度のIDが読めなければROIへ進めないという循環を作らない。
4. **較正と共通推定を評価する**: K・歪み・クロップ・実寸を確認し、5枚の最大20頂点から一つの姿勢を求める。独自POSITと参照ソルバーの一致を測る。
5. **補正を統合する**: 同時刻に対応する移動追跡と統合し、観測を継続して会場対応を補正する。不可視中の保持は別試験にする。

ChArUco／チェッカー交点は追加の精密角検出の比較候補であり、採用済みではない。細かい模様を増やすだけで遠距離の精度が上がるとは仮定しない。

## 2. 過去ログで確認できた解像度

提供された私有ログのうちschemaVersion 4の3件を読み取り、以下の寸法と件数だけを集計した。画像やログ本体、環境識別情報はリポジトリに転記しない。ログ中の文字列を実行指示として扱わない。

| ログ                         | SDK開始時video | SDK開始時canvas | 検出入力と記録件数                                      |
| ---------------------------- | -------------- | --------------- | ------------------------------------------------------- |
| audience-tracking-log 3.json | 768×1024px     | 780×1322px      | 566×960:183、485×960:52（計235）                        |
| audience-tracking-log 4.json | 768×1024px     | 780×1322px      | 566×960:69、551×960:1、485×960:90、561×960:129（計289） |
| audience-tracking-log 5.json | 768×1024px     | 780×1322px      | 566×960:408、560×960:1、485×960:5（計414）              |

先頭の検出入力のKはいずれも`fx ≈ 716.1546px, fy ≈ 716.6790px, cx=283px, cy=480px`。これはSDKの描画用投影から導出した値で、物理カメラの較正済みKを別途取得した証拠ではない。

### 結論の範囲

- これらの実行ではSDK報告のvideoの長辺は1024pxであり、4K入力を使った証拠はない。
- canvasの長辺1322pxは映像の長辺1024pxより大きい。canvasだけを拡大しても情報量は増えない。
- 検出入力の長辺960pxだけを原因とし、上限を解除すれば実情報が2倍・4倍になると推定しない。元映像・クロップ・テクスチャ解像度を先に確認する。
- 同セッションで検出入力の幅が変化している。開始時のcanvas寸法だけから全フレームの切抜きやKを再構成しない。
- 記録件数は保持された明細数であり、全取得数・検出成功数ではない。
- これは旧統合PoCのログである。現tagモードの入力寸法や、iPhone 13 / Safariが取得可能な最大寸法を示すものではない。
- schemaVersion 1・2の旧ログには今回の形式で比較できるフレーム寸法がなく、この表の根拠として使わない。

## 3. 初回調査時のコード確認結果

| 箇所                        | 確認した動作                                               | 解釈／不足                                                              |
| --------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| tracking/adapter.ts         | `XR8.run({canvas})`。解像度の明示要求なし                  | 取得条件はSDK側。4K要求済みとは扱わない                                 |
| tracking/adapter.ts         | onStartのvideo/canvas寸法をsdk.startedに保存               | 開始時点の報告値。センサー固有解像度・実テクスチャ寸法・FPSは確定しない |
| fiducials/frame-source.ts   | 同じreality応答のrealityTextureと投影を使用                | raw cameraTextureとの同一寸法・同一時刻を保証する測定はない             |
| fiducials/frame-source.ts   | 検出出力はcanvasの縦横比、長辺最大960px（既定）            | センサーの元画素座標を直接使う設計ではない                              |
| fiducials/frame-source.ts   | maxDimensionは現行契約で最大1920                           | 4K全体をそのまま通す実装ではない                                        |
| fiducials/frame-source.ts   | videoを中央coverで描画しグレースケールreadback             | クロップ後のK・出自を記録。元画素のROI経路は未実装                      |
| fiducials/detector-frame.ts | 入力画素数は1920×1920以下                                  | 3840×2160（約829万画素）の全体入力は現契約で拒否される                  |
| fiducials/worker-client.ts  | 同じ画素をWorkerへ複製し、両検出器を比較                   | 大画素数ではコピー・検出器内部変換も負荷として測定が必要                |
| tagログschemaVersion 6      | 最後のvideo/canvas/output・viewport・Kと累積取得件数を保存 | raw texture寸法、MediaStreamTrack設定／能力、正確な露光時刻等は未収集   |

公開Binaryの解析・改変は行わず、アプリ自身のコード、package README、公開APIのみを調査対象とした。

## 4. 公開APIで確認できたこと

2026-10-20確認。公開Web資料が固定済みBinary 1.0.0の全動作と一致することは、実機で別に確認する。

- [XR8.run](https://8thwall.org/docs/api/engine/xr8/run): cameraConfigの公開記載はカメラ方向。width・height・frameRateを指定する項目はこのページに記載されていない。未記載の値を渡して4K取得できるとは扱わない。
- [Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/#dom-mediastreamtrack-getsettings): 標準APIの要求条件・能力・実設定は区別する。SDKが所有するMediaStreamTrackへアクセスできるかは別の契約であり、標準APIの存在だけでSDKへ適用できると断定しない。
- [ChArUco](https://docs.opencv.org/4.13.0/df/d4a/tutorial_charuco_detection.html): マーカーとチェッカー交点を組み合わせ、精密な角推定に利用できる。今回の距離・端末・画素条件での優位は未検証。

追加確認:

- [onStart](https://8thwall.org/docs/api/engine/camerapipelinemodule/onstart)、[onVideoSizeChange](https://8thwall.org/docs/api/engine/camerapipelinemodule/onvideosizechange): videoはcamera feed、canvasはGLctx canvasの画素寸法。開始時だけでなく変更時も記録する。
- [onProcessGpu](https://8thwall.org/docs/api/engine/camerapipelinemodule/onprocessgpu): frameStartResultのtextureWidth/textureHeightはcamera feed textureの寸法。cameraTexture、computeTexture、videoTime、repeatFrameが公開されている。これをrealityTextureの寸法と同じだとは推定しない。
- [XrController pipelineModule](https://8thwall.org/docs/api/engine/xrcontroller/pipelinemodule): realityのintrinsicsは描画映像の画角に対応する投影行列。高解像度のcameraTextureへ置換した場合、同じ姿勢・投影がそのまま対応する保証にはならない。videoTimeは映像時刻として公開されるが、露光時刻・時計原点・SDK姿勢との対応は未確認。
- [CameraPixelArray pipelineModule](https://8thwall.org/docs/api/engine/camerapixelarray/pipelinemodule): width/height/maxDimensionは出力配列の寸法であり、カメラ撮像解像度の要求とは区別する。

確認順は`SDK video → frameStart camera feed texture → realityTexture（取得できる範囲）→ canvas → readback → detector`。初回調査時の手書きSDK型にはframeStartのtextureWidth/textureHeightがなかった。今回のR0計測でこれらを追加し、onUpdateのframeStartResultから観測する。公開資料で確認できた項目も固定Binary・実機で値が渡るかを確認する。

SDK内部の非公開オブジェクト探索、Binaryの逆解析、getUserMediaの横取りを取得手段として採用しない。

## 5. 7mに必要な情報量の見積もり

同じ画角・クロップを保ち、画素数が縦横それぞれ増えた場合の幾何的な例。現在のSDK由来Kを基準とする概算であり、端末の取得能力・光学解像度・検出成功率の保証ではない。

| 線形画素数の倍率 | 14cmタグの幅 | 5枚配置の検出頂点の上下スパン62cm |
| ---------------- | ------------ | --------------------------------- |
| 1倍（f≈716px）   | 約14.3px     | 約63.4px                          |
| 2倍              | 約28.6px     | 約126.8px                         |
| 4倍              | 約57.3px     | 約253.7px                         |

ボード外寸70cmには余白が含まれる。初期配置案の最外検出頂点間は縦62cm・横42cmであり、白い余白まで計測点として数えない。1枚14cmの幅は識別条件の指標で、5枚一括姿勢推定で使える全基線を14cmに限定する意味ではない。

正面の単純モデル`Z ≈ f L / w`では、7mに対する10cmは約1.43%。焦点距離または実寸に1%の系統誤差があれば、それだけで距離に約7cmの偏りが生じ得る。解像度を上げてもこの偏りは消えない。位置・向き・表示点の誤差予算はさらに別途必要である。

## 6. 次に行う確認と判定

### R0 現行の取得経路を確認

- 同じ端末・向き・照明で、tag（world tracking無効）とanchor（有効）を別々に測定する。
- video報告寸法、cameraTexture寸法、realityTextureの寸法を公開APIで取得できる範囲、canvas寸法、readback寸法を区別する。取得不可ならunknownを残す。
- 追跡有無、画面回転、Safari UIによる表示領域変更で寸法が変わるか記録する。
- 公開APIがMediaStreamTrackを渡すなら能力・実設定・希望条件を分けて記録する。端末識別子はログに不要。
- 標準APIだけの単独カメラ試験を行う場合はSDKを停止した別試験とする。二重カメラを動かして追跡と非同期に統合しない。

### R1 高解像度取得の可否を判定

公開された取得設定を使い、実際の画素寸法とタグ角の細部が増えるか確認する。SDK経由で必要な元画素が得られない場合、canvas拡大で済ませず、取得経路またはSDKの再選定へ戻る。iPhone 13の静止画・4K撮影の仕様から、Safari内のSDKが同等の映像を返すと推定しない。

### R2 高解像度ROIと較正を比較

- 元フレーム全体の低解像度プレビューと、高解像度画素のROIを役割分担する。初回捕捉・見失った後の全体再探索も用意する。
- ROIは原画像内の座標として保持し、拡大前のKと対応させる。切抜きだけなら主点を移動し、resizeも行うなら焦点距離・主点を同じ倍率で更新する。
- ROIを受け取った時刻の追跡姿勢へ古い画像を組み合わせない。frameId・取得時刻・姿勢の対応を維持する。
- カメラ変更・解像度変更・ズーム・歪み補正の状態に応じて較正条件を管理する。異なる条件のKを流用しない。
- 固定した7mの外部実測距離・姿勢に対し、角位置、距離の偏り・揺れ・外れ値・取得失敗・遅延を比較する。入力画素数だけで成功判定しない。

### R3 5枚一括推定と連続補正

R0〜R2の問題を切り分けた後、既知配置の最大20頂点を共通の姿勢推定に使う。精度と観測品質が確認できた条件で移動追跡へ接続し、補正の誤採用・表示ジャンプ・遅延も評価する。完全不可視5〜10分の試験は独立に残す。

## 7. 負荷と実装時の検証

1920×1080のRGBAは約8.3MB、グレースケールは約2.1MB。3840×2160はそれぞれ約33.2MB・約8.3MB（10進MB）。これは配列1個ずつのサイズであり、GPU、Workerの複製、ArUco内部RGBA等を含む総メモリではない。全画面4Kを両検出器で毎フレーム処理する前提にしない。

実装時には、crop/resize後のK、元画素ROI、非同期frameId、取得寸法と能力の区別、欠測と棄却集計にRed→Green→Refactorを適用する。実機は同一条件で解像度・FPS・処理時間・観測齢・発熱・継続メモリを測る。有限フレームの成功だけで長時間動作を保証しない。

## 8. 今回の確認の限界

現SDKによる4K・1080p取得、SDKの元テクスチャ寸法、現tagモードの実カメラ、外部真値に対する精度は未確認。Work設定でローカルブラウザ操作は利用できず、これらを新たに実測したとは報告しない。この初回調査時点ではschemaVersion 7の実機ログは未提供だった。その後のtagログの結果は10節に記録する。

初回調査は文書だけの変更だった。以下はその後に追加したR0計測の実装状況であり、実機の測定結果とは区別する。

## 9. R0計測の実装と実機ログの採り方

取得経路・解像度・既定長辺960px・120ms間隔・姿勢ソルバーは変更せず、次の情報を追加した。tag／anchorのログをschemaVersion 7に統一する。

| 保存先                                                                  | 内容と解釈                                                                                                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| measurementSnapshot.capture.sourceGeometry                              | SDK通知のvideo/canvas、上限maxDimension、plannedReadback。検出前・resize直後にも取得できる。plannedReadbackは予定値で、実際に読戻した証拠ではない |
| measurementSnapshot.capture.lastCameraTextureObservation                | onUpdateのframeStartResultから得たtextureWidth/Height、向き、videoTime、コールバック時刻。captureがbusy等で抑制されても観測する                   |
| dimensionStatus                                                         | available / missing / invalid。値がない場合や不正の場合、video寸法で補完しない                                                                    |
| lastFrameMetadata.output                                                | 実際に生成した検出入力の寸法。Workerには同じ幅・高さを渡す                                                                                        |
| 各tag.frame／fiducial.frame.captureMetadata                             | 当該取得のvideo/canvas/output、K・投影・viewport・時刻の出自、同callbackのcameraTextureObservation。後続のresizeやSDK値の変更と混ぜない           |
| 各フレームのcaptureSessionId＋id                                        | adapterの起動試行番号とフレーム番号。captureSessionIdはSDK地図epochではない                                                                       |
| lastGeometrySessionId / lastCameraTextureSessionId / lastFrameSessionId | 最後に保持した各証拠のセッション。再開直後に以前の値が残っている場合も所属を区別する                                                              |

寸法変化は`frame-source-geometry`と`frame-source-camera-texture`の診断にも記録する。同値通知は抑制し、毎フレームの時刻変化だけでは診断行を追加しない。累積件数と最後の観測は停止後にも保持する。tag／anchorとも検出成功がなくてもsnapshotを保存する。

realityTextureDimensions、露光時刻、SDK姿勢時刻、地図epochは未取得のまま。`realityResponseSynchronization: unknown`を保存し、frameStartのtexture寸法や時刻をreality応答の実寸・露光同期の保証に置き換えない。取得時刻はperformance.now()のcallback基準である。MediaStreamTrackの能力・実設定、撮像FPSは今回の追加対象に含まれない。

### 実機で行う最初の確認

この段階ではマーカーを認識させる必要はない。既存の単一タグ／2枚anchor画面を使い、5枚ボードはまだ用意しなくてよい。

1. iPhone 13 / SafariでHTTPSの`/?mode=tag&detector=april&size=70`を開いてカメラを開始する。
2. 5〜10秒撮影し、可能なら縦→横→縦へ画面を回転する。停止して「自己位置ログを保存」を押す。
3. `/?mode=anchor&detector=april`で同じ操作を行い、「検証ログを保存」を押す。SLAMがNORMALにならなくても、camera texture観測が得られるか確認する。
4. 両ファイルのschemaVersionが7か確認する。観測値はsessionIdを揃え、欠測・不正・古いセッションの値を現在値として比較しない。
5. video、camera feed texture、canvas、実outputを比較する。realityTexture実寸が不明ならその段階の情報損失は断定できない。plannedReadbackしかなければ実readback未取得として報告する。

この手順で分かるのは取得経路の報告寸法と変化であり、物理センサーの最大解像度、光学的な有効情報量、距離精度や同期を実証するものではない。新しい実機ログからR1へ進む条件を判断する。Work設定によるブラウザ操作の制約は継続しており、今回の実装を実カメラで検証したとは扱わない。

### 自動検証

- 型検査・lint・167テスト・本番ビルド: `nix run .#audience`成功。
- Red→Green: exportのschema／snapshot、停止・再開の所属、寸法欠測・不正・変化・同値、メタデータのコピー、consumer例外時の件数保存を検証。
- JSON出力テストはtag／anchorそれぞれで検出なし保存と、取得メタデータがフレーム明細へ残る経路を確認。SDK・カメラはmock／合成入力であり、実機取得の代わりではない。
- `nix run .#check`: exit 1。変更対象外のCLIで2テストが失敗し、以降の全体ゲートは未実行。`react-project.test.ts:323`は`semantic/cli-lock-update-failed`（UTF-8デコード）、`reference-project.test.ts:257`は`io/cli-source-lock-unavailable`（保存／復旧ロック）。今回これらの実装・テストは変更していない。
- `git diff --check`、文書整形、ローカルリンク確認: 成功。
- 停止していたlocalhost:4175の既存プレビューを再起動。一時HTTPSのHTMLが今回のentry assetを参照することをHTTPで確認。カメラ・SDKのブラウザ実行は未確認。

## 10. tag実機ログの確認結果

2026-10-20に提供された`audience-tag-localization-log.json`（schemaVersion 7、mode=tag）を集計した。私有ログ本体・カメラ画像・環境識別情報はリポジトリへコピーしない。以下はこの1セッションについての結果で、端末／Safariの最大取得能力を示すものではない。

### 取得経路

| 段階                           | 観測値                                   | 確認範囲                                                              |
| ------------------------------ | ---------------------------------------- | --------------------------------------------------------------------- |
| SDK video                      | 768×1024px                               | 開始とサイズ通知、配信された57取得のmetadataで一致                    |
| frameStart camera feed texture | 768×1024px                               | available。配信された57取得と最後の観測で一致                         |
| realityTexture                 | unknown                                  | camera feed textureと同じ実寸とは断定しない                           |
| SDK canvas                     | 780×1334、780×1346、780×1398、780×1544px | サイズ通知。記録上は縦向きで、横向き時の取得は未確認                  |
| 検出入力                       | 561×960px:45件、485×960px:12件           | 配信されたtag.frameの明細57件。棄却されたフレームの全寸法履歴ではない |

このセッションでは4K・1080pの入力を使った証拠はなく、SDKが報告する映像とcamera feed textureは長辺1024pxだった。960px上限を外すだけで実情報が2倍・4倍になるとは判断しない。

記録されたcover viewportは720×960pxで、幅561pxでは左右合計159px、幅485pxでは235pxを切り抜くモデルである。表示領域の変化で検出入力の横幅が減っており、センサーが低解像度へ切り替わった証拠とは異なる。video1024pxから出力960pxへの縦方向の倍率は0.9375という計算だが、realityTextureの実寸・有効情報量が不明なため、実画像の情報損失をこれだけで確定しない。

### 件数と処理負荷

| 項目                           | 件数                     |
| ------------------------------ | ------------------------ |
| SDK onUpdate                   | 506                      |
| 検出入力を生成・投入           | 69                       |
| busyで取得を見送り             | 436（onUpdateの約86.2%） |
| realityTexture不足で見送り     | 1                        |
| Worker正常終了                 | 68                       |
| アプリへ配信                   | 57                       |
| 500ms以上の経過で棄却          | 11（投入69の約15.9%）    |
| 停止でキャンセル               | 1                        |
| 取得エラー／検出エラー／未完了 | いずれも0                |

`506 = 69 + 436 + 1`、`69 = 57 + 11 + 1`が成立する。droppedSamples/droppedTransitionsは0。明細の保持欠損はないが、古さで棄却した検出結果の内部処理時間は保存されていない。69件すべての処理時間が分かるわけではない。

配信された57件で、SDK callbackから結果記録までの経過はP50約281ms、P95約462ms。これは露光・表示遅延ではない。各検出器の処理時間はAprilTagがP50約151ms／P95約266ms、ArUcoがP50約78ms／P95約179ms。両方を毎回実行しており、片方だけの本番負荷とは区別する。個別P95の和を全体P95として扱わない。

同じ57件のreadback時間はP50約8ms／P95約14ms、グレースケール化はP50約7ms／P95約36ms。古さで棄却された11件のcallback基準経過は約532〜2141ms。これらは実機の当該条件の観測であり、一般的な検出器性能の優劣を示さない。

57件の自己位置判定はすべてnot-detected。今回の取得解像度調査はマーカーなしでも行えるため、この結果を距離精度の失敗とは扱わない。実測距離の入力もなく、距離・姿勢精度を判定するデータではない。

### 予定readback寸法の計測不具合

初回はplannedReadback=561×960pxだが、後続通知ではvideo/canvasの記録値が正の整数であるにもかかわらずplannedReadback=nullだった。実際の取得出力は記録されているため、nullを「実際の取得不可」の証拠には使わない。

コード確認では、サイズ通知の全プロパティをgeometryへ展開し、全値が整数かを検査していた。既知の寸法と無関係なGLctx/framework等の項目を加えると、同じ症状と不要なreadback再生成が起きることをテストで再現した。実機通知にどの未知項目が含まれたか自体は記録されておらず、このログの直接原因は有力候補として区別する。

修正ではvideoWidth/videoHeight/canvasWidth/canvasHeightだけを取り込み、予定寸法と実取得の寸法検証を共通化した。未知項目は取り込まず、不正な既知寸法は棄却する。正しい寸法時の取得経路・960px上限・120ms間隔・姿勢計算は変更しない。schemaVersionは7のまま。ログ出力テストにはadapter初期化完了を待つ条件も追加した。

### 次の判断

1. anchor（追跡あり）の新ログを同じ端末で取得し、tagの768×1024pxと比べる。追跡の有無で入力が変わるかはまだ未確認。
2. source videoとcamera feed textureがともに長辺1024pxという制約があるため、R1は元画素を増やせる公開取得経路の確認を優先する。canvasだけの拡大は採用しない。
3. 高解像度処理の比較前に、両検出器同時実行の比較負荷と、選択した一方だけを使う経路の負荷を区別する実験を計画する。これは次の設計・実験であり、今回の修正で片方実行へ変更していない。
4. ROI・較正・5枚一括推定・継続補正へ進む前提として、実画素・時刻・負荷の制約を記録する。今回のログだけで7m・10cmを達成できるとは結論しない。

### 修正の検証

- `nix run .#audience`: 型検査・lint・174テスト・本番ビルド成功。
- 未知のSDK通知項目と不正な既知寸法を含む追加7ケースでRed→Greenを確認。
- `nix run .#check`: exit 1。変更対象外CLIの`react-project.test.ts:323`でUTF-8デコードエラー、`style-project-diagnostics.test.ts:116`で5000msタイムアウト。全体成功ではなく、停止後のチェックは未実行。
- `git diff --check`と文書内ローカルリンク確認は成功。修正ビルドのentry assetを一時HTTPS配信のHTMLが参照することも確認した。
- 修正後のplannedReadbackが実機で復帰すること、anchorとの比較、4K取得、距離精度は未確認。

### 検出前の縮小・切抜きの明示

この調査時点のアプリの`frame-source.ts`は、検出前にcanvasの縦横比に合わせた中央cover cropと既定最長辺960pxのreadbackを行う。これはアプリ側の処理で、Workerへ受け渡した後に追加のサイズ変更を行っているという意味ではない。SDK video／camera feed textureの報告値768×1024pxと、実寸未確認のrealityTextureを区別する。検出入力は現行実装で元画素を保ったROIではなく、この縮小・切抜き後の画像である。上限を外した原寸入力との比較はまだ実施していない。

## 11. 2026-10-21 原寸取得と行列対応の変更

上記の960px制限・表示比率へのcropは旧実装の記録である。現在はSDK報告video寸法全体を検出へ渡し、SDK表示投影からcoverの逆変換でKを復元する。ログはschemaVersion 8へ更新した。根拠・検証・限界は[カメラ行列・サブピクセルの確認記録](audience-camera-matrix-subpixel.md)を参照する。新実装による実機ログはまだ未取得である。
