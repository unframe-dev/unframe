# Audience Web XR

会場の観客向けWeb XRクライアント。2026-10-22、ユーザーが現構成で十分な精度を確認し、位置保持PoCを完了とした。以降はこの追跡構成を基準としてWebアプリ開発へ進む。現在はAprilTag `tag36h11`の単一ID 0と8th Wall SDK／SLAMを使う位置保持に加え、契約データによるPNG・H.264動画・GLB描画と進行状態適用をアプリ内部で実装している。既存HTTPのjoin → Delivery → bootstrapクライアントと参加画面を実装済み。匿名資格の発行・Audience profile登録・接続環境は外部提供待ちで、実Backend・Realtimeとの接続は未検証。

## 採用した方式

1. 有効なタグ姿勢と同じ取得callbackのSDK姿勢を1ペア得たら、会場との対応を即更新する。一致待ち・平滑化・残差による採用保留は行わない。
2. 次の有効なタグ観測まではSDK座標内の物体を固定し、SDKカメラの移動・回転で表示を保持する。
3. タグ未検出・姿勢が曖昧・再投影誤差超過・SDK姿勢欠落では新位置を採用せず、前の有効位置を保持する。
4. SDK追跡がLIMITEDになった場合、hidden、停止では物体を非表示にし、対応を破棄する。NORMAL復帰だけで古い位置を再表示せず、新しい有効なタグ観測を待つ。

SDKはabsolute。NORMALが連続5秒続いた後に検出器を準備し、最大頻度で検出を開始する。準備中に追跡が低下すれば待ち直す。検出は単一Worker・同時1フレームで、完了後に新しい画像を取得し、待ち行列を作らない。

実機報告では黒外周150mmで約3.3m、240mmで約5.8mを認識した。距離別の小揺れ補正を含む現構成を、ユーザーがWebアプリ開発へ進む基準として承認した。当面は観客が立ち位置を固定する前提。これは外部真値による10cm精度や、7m初回認識・不可視5〜10分保持を定量実証した結果ではない。追加の追跡実験を開発開始の条件とはせず、必要な改善は製品要件に応じて別途扱う。

## 操作

サイトの `/` はルーム参加画面。位置合わせ単独の検証は開発時の `/?tracking=1` を開き、必要ならサイズを選び「カメラを開始」。検出器の選択はない。画面はSDK状態、生理由、タグ採用回数、最後のタグ更新からの経過時間、実効検出Hzを表示する。

黒い外周15cm・白余白込み22.5cmが既定。`/?tracking=1&size=22.5|36|50|60|70`で余白込み外寸cmを指定する。黒い境界は外寸の2/3。黒外周240mmの検証には`/?tracking=1&size=36`（余白込み360mm）を使う。サイズ選択は即反映し、変更時は前のアンカー・保存画像を消す。印刷ページは`/print-target.html?size=22.5`。画面表示・印刷後は実寸を測り、白余白を残す。

ArUco、タグ単独、SDK単独、負荷切替、比較画像、静止／回転／移動の区間指定、合成ラボ、旧複数マーカーボードは撤去した。旧mode/detector/strategy/correctionによる分岐はない。過去の実証は`docs/experiments/`に履歴として残す。

## 開発

リポジトリルートで実行する。

```bash
nix run .#setup
nix run .#audience
nix run .#audience -- dev
nix run .#audience -- fix
nix run .#audience -- preview
```

`audience`は型検査・lint・単体テスト・本番ビルド。`preview`は既に作成した成果物を配信する。`dev`と`build`の事前処理でSDKと検出器資産を準備する。スマートフォンのカメラには信頼されたHTTPSが必要。一時トンネルはプロセス停止で利用できなくなる。

マーカー資産再生成：`nix develop --command pnpm --filter @unframe/audience run markers:generate`。

## 構成

- `AnchorExperience.tsx` / `AnchorExperienceView.tsx`: 画面入口と表示専用View。カメラ・Workerの所有や姿勢推定を持たない。
- `experience/use-anchor-experience.ts`: 設定・サイズ選択、Reactの画面状態とセッションの接続、アンマウント時の破棄。
- `experience/anchor-session.ts`: 権限要求、開始・停止、NORMAL待機、検出開始、リセット、古い非同期処理の拒否。設定ごとに1セッションを所有する。
- `experience/tag-anchor-state.ts`: タグ推定結果と確定アンカーの状態。単一観測の即採用、SDK姿勢と500ms未満の鮮度条件、未検出時の保持を扱う。
- `experience/diagnostic-export.ts`: schemaVersion 21のJSON構築と明示ダウンロード。設定読込失敗時も環境・診断記録を保存できる。
- `tracking/adapter.ts`: SDKとWorkerの所有、固定absolute設定、画像取得の制御、状態・性能の記録。
- `fiducials/frame-source.ts`: SDKが報告するvideo全体を取得し、表示用4×4投影行列からcover変換を逆算して同じ画像のKを求める。
- `fiducials/detector.ts` / `worker.ts`: AprilTag 3のWASMで`tag36h11`を検出。`quad_decimate=1`・`refine_edges=1`。
- `fiducials/pose.ts` / `tag-localization.ts`: 画像だけから単一タグ姿勢を推定・判定。POSIT由来の反転初期値を含む最大4候補で探索し、曖昧姿勢と再投影誤差超過を除く。SDKをタグ推定の初期値に使わない。
- `rendering/live-tag-anchor.ts`: `sdkFromVenue = sdkFromCamera * inverse(tagVenueFromCamera)`を即反映。検出間は行列を維持し、SDKの通常描画ループで表示する。
- `rendering/presentation-space.ts`: タグ表示から会場基準を復元し、設定の`presentationToVenue`と共有原点用の独立Groupを接合する。子ノードはこの`contentRoot`へ追加する。
- `rendering/presentation-guide.ts`: プレゼン位置確認用の1m座標軸と幅1m・高さ0.5625mの枠。実プレゼン素材ではない。
- `rendering/png-plan.ts`: 既存DeliveryとParticipantRuntimeViewからPNGの選択済state binding、空間親子、fit、表示状態と予算を照合する。
- `rendering/png-presentation.ts`: PNGを全件準備後にプレゼンrootへ接合し、失敗・取消時は巻き戻す。
- `assets/png-texture.ts`: 期限付きURLからPNGを取得し、サイズ・SHA-256・寸法を検証してsRGB textureを生成する。
- `tracking/input-capture.ts`: 最後の配信フレームの原グレー画素とPNGを明示操作でJSONへ保存。

画像を縮小・中央切抜きせず、SDK報告videoサイズを維持する。4096×4096画素予算を超える入力はエラーにし、黙って縮小しない。画素はWorkerへ移譲し、結果と一緒に返却して同じフレームへ復元する。別のgetUserMedia・描画ループは追加しない。

`@8thwall/engine-binary@1.0.0`、Three.js `0.183.2`を固定。`js-aruco2@2.0.0`は検出器としては使わず、姿勢推定のPOSIT/SVDとAprilTag辞書の資産生成のために残す。runtime生成コードは`generated-posit.mjs`でSVD/POSだけを含む。

## JSON

通常ログはschemaVersion 21 / mode `audience-anchor`、ファイル名`audience-anchor-tracking-log.json`。frameごとに単一検出結果`result.detections/durationMs`、タグ姿勢・候補診断、採用可否`anchorUpdated`、最新アンカー、K・画像/画面寸法・時刻metadataを保存する。SDK生値・型・理由・姿勢、取得／投入／完了／配送／棄却／取消、処理時間と実効Hz、リング欠落件数も記録する。過去の比較スキーマと結果構造が異なる。旧形式向けの互換経路は持たない。

「検出入力画像付きJSONを保存」では、最新の配信結果1件を`detectorInput`へ含める。原寸gray8のBase64と同じ画素のPNGを、枠・軸なしで同梱する。未検出0件でも保存できる。停止後も保存可能で、新しい開始・サイズ変更で前画像を破棄する。結果が一度も配信されていない場合は保存できない。画像に周囲の人や会場が含まれる可能性を画面に明示し、自動送信しない。通常JSONには画素を含めない。

## 限界と履歴

センサー露光時刻とSDK姿勢時刻の同期、歪み補正・物理カメラ較正、SDK地図epochは未確認。SDK報告寸法はセンサー原寸の保証ではない。NORMALや再投影誤差を物理的な精度の証明にしない。タグ姿勢が揺れれば即採用による表示ジャンプも起こり得る。

SDK配布物は未改変で同一originへ配置し、LICENSE・著作権・ハッシュを保持する。AprilTag wrapper、AprilTag本体、POSIT/SVD、辞書の必要なライセンスを画面から参照できる。

[採用方式と整理記録](../../docs/experiments/audience-apriltag-adopted.md)、[設計・開発計画](../../docs/plans/audience-web-xr-plan.md)、[SDK配信要件](../../docs/plans/audience-web-xr-engine-requirements.md)。

## 表示の小揺れ補正

確定したタグ姿勢とSDK姿勢は変更せず、SDK座標内のマーカー表示姿勢だけをタグ更新時に補正する。距離はタグ由来の会場内カメラ位置とマーカー位置から求めるため、SDKの移動値で閾値は変わらない。

| タグまでの推定距離 | 位置差の閾値             | 回転差の閾値             |
| ------------------ | ------------------------ | ------------------------ |
| 2.5m以内           | 10mm                     | 0.5度                    |
| 2.5〜5.5m          | 両端の値を距離で線形補間 | 両端の値を距離で線形補間 |
| 5.5m以上           | 20mm（上限）             | 1度（上限）              |

直前の確定姿勢・現在の表示姿勢の両方との差が位置・回転とも閾値以内なら、表示を新しい姿勢へ35%寄せる。どちらかの閾値超過、初回、clear後、距離が非有限または負の場合は位置と回転を即反映する。微小な本当の修正もこの範囲では抑える可能性がある。閾値と係数は実機調整用の設定であり、精度保証ではない。

検出の合間は固定し、補正残差も次の観測まで保持する。SDKカメラへの補正や一致待ちは追加しない。通常JSON schema 21の各採用frameの`displayStabilization`に`markerDistanceMeters`、今回の`thresholds`、判定・差・残差・補正前後の行列を記録する。非採用frameはnull。

## Webアプリ開発への引き継ぎ

追跡方式の再選定は終了し、現在の検出・確定・SDK保持・表示補正の境界を維持する。次の実装範囲と順序は[Webアプリ開発計画](../../docs/plans/audience-web-app-plan.md)を参照する。ルーム参加・実サーバーとのライブ接続は未実装のため、PoC完了と製品機能の完成を区別する。

既存Quest／Unity契約との共用範囲・不足・座標接合は[契約適合の確認記録](docs/contract-compatibility.md)を参照する。現時点では静的照合であり、Backend実接続の適合は未検証。

Audience側の接続口とBackend担当への依頼事項は[外部接続境界](docs/connection-boundaries.md)を参照。既存join／Delivery／bootstrapを利用し、匿名資格発行・profile登録・ブラウザ通信経路の提供は外部依存として扱う。

## 責務分離の確認（2026-10-22）

PoCの検出・姿勢推定・即時採用・SDK保持・距離別小揺れ補正は維持し、画面とセッション所有、位置合わせ状態、診断出力を分離した。SDK・カメラ・Workerは引き続き`tracking/adapter.ts`が所有し、セッションはadapterの開始／停止とscene破棄の接続だけを行う。

TDDで追加した11件は、単一観測の即採用、未検出／曖昧姿勢の保持、SDK姿勢欠落、500msの鮮度境界、clear後の新観測、連続NORMAL待機、権限待ち中の停止、重複開始、再開始、遅延した検出準備の破棄、設定未取得時の診断保存を確認する。`nix run .#audience`は122テスト・型検査・lint・build成功。実機のカメラ精度は再測定していない。ルーム参加・プレゼン描画・ライブ接続は引き続き未実装。

全体ゲート`nix run .#check`はCLIの`react-project.test.ts`「recreates v1 from a frozen pnpm archive without running package scripts」で既知のUTF-8エラーが再発し失敗した（CLIは486件成功・1件失敗）。ログは`/tmp/audience-refactor-full-check.log`。後続の集約チェックは実行されておらず、Audienceの代替検証は個別の`nix run .#audience`（122件成功、型・lint・build成功）で行った。CLI・Backend・共有契約・設定の差分はない。全テスト成功を要求するgit-commitスキルの条件を満たさないため、コミットは未作成。

## プレゼン座標の接合（2026-10-22）

`presentationToVenue`はメートル・右手系・Y-up・forward -Zの会場基準とプレゼン基準の固定対応（`venueFromPresentation`）として使用する。共有Runtimeの`presentationOrigin.pose`はこの設定とは別の子Groupへ適用する。

```text
SDKFromNode = displayedSDKFromMarker
            × inverse(venueFromMarker)
            × venueFromPresentation
            × presentationFromStage
            × nodeの親子local matrix
```

タグ更新の小揺れ補正は従来と同じマーカーpivotで計算し、プレゼン配置や共有原点の更新をfilterへ入れない。raw `sdkFromVenue`、JSON schemaVersion 21、タグサイズ指定は変更していない。階層全体が追跡低下で非表示となり、新しいタグ観測で再表示する。共有原点は`setPresentationOrigin(Matrix4)`という描画内部の受け口であり、Runtimeのversion／fence検証は後続の状態適用器が担当する。現段階ではサーバー未接続のためidentityで診断表示し、Snapshot取得済みとは扱わない。

初期設定はタグ・プレゼンとも原点なので、タグ上に長い1m軸と薄青の1m枠が表示される。設定ファイルの`presentationToVenue.position`をメートルで変更するとプレゼンガイドだけが移動する。`rotation`は単位Quaternionのobject形式で指定する。変更後は再読み込みして新しい設定で開始する。検証用の短い軸・箱はタグ位置に残る。

座標テストは回転・平行移動したタグとプレゼン配置、共有原点の即時更新、非一様scaleを含む親子行列、追跡低下・再認識、小揺れfilterとの分離、診断ガイドの実寸と資源破棄を確認した。`nix run .#audience`は128テスト・型検査・lint・build成功。実機での実寸・配置・精度の確認、実プレゼンのPNG描画、Runtimeからの共有原点適用は未実施／未実装。

工程2の`nix run .#check`もCLIの凍結アーカイブ復元で既知のUTF-8エラー1件が発生した（CLI486成功・1失敗）。ログは`/tmp/audience-presentation-space-full-check.log`。後続集約チェックは未実行、Audienceは上記個別ゲートで検証済み。共有コード・設定は変更せず、コミットは引き続き保留。

## 契約データからのPNG描画（2026-10-22）

XR scene開始後、セッションの`presentPng(delivery, participantRuntimeView)`に既存契約のデータを渡す。Deliveryは`DeliveryManifestWire`、Runtime viewは既存portable `ParticipantRuntimeView` schemaを使う。Control／State wireからの変換、Snapshot受理、sequence／fence照合はRuntime受け口が担当する。`presentPng`は低水準の描画入口であり、接続の正当性や資格を保証しない。実接続では`openRuntime`を通す。

Deliveryの選択済`projectionProfile.renderSurfaces`を使用し、RenderBundle全候補の配信選択をブラウザでやり直さない。`stateBindings → artifact → state texture → assetAccess`を素材IDとchecksumで照合する。RenderBundleとAssetSetManifestの既存fixtureも、素材識別の整合をテストで確認する。別profileのRuntime fixtureはそのまま混ぜず、テストで対応IDへ合成してから使う。

配置はlogical左上座標をメートルのSurface中心座標へ変換する。contain／cover／stretchに対応し、coverは物理枠へ切り抜き、UVを対応する範囲へ変更する。nodeはlocal TRSの親子階層を維持し、非一様scaleを含むworld matrixをTRSへ再分解しない。sRGB、opaque／straight alpha、opacity、active／visible、レイヤー順を反映する。共有原点は工程2の専用rootへ一度だけ適用する。

PNGはHTTPS・CORS・credentials omit・no-storeで取得する。期限・media type・PNGシグネチャ・encoded size・SHA-256・デコード後寸法を確認し、署名URLをエラーへ含めない。ImageBitmapは非乗算alpha・色変換なし・縦反転で生成し、textureのflipYはfalse、mipmapなしとする。ロードは直列、同一assetは共有し、保持中bitmapと次画像decodeのCPUピークを合算して既存capability予算内に制限する。bitmapはGPU遅延upload・context再生成のためdisposeまで保持する。URLの期限更新・認証・Deliveryの再取得はHTTPクライアント工程の責務。

停止・scene破棄・次の表示要求は進行中ロードを中止する。描画は全件準備後に接合し、失敗時は既存の表示を維持する。置換成功・終了時は自分が所有するgeometry・material・texture・bitmapを解放する。

この段階の対象は静的なPNG状態である。native-ui・動画・model・shape・light・Presenter anchor・Local Overlay・active run／遷移中の状態は未対応として拒否し、黙って欠落させない。Snapshot・更新イベントの静的PNGへの適用は以下のRuntime受け口で対応する。Timeline・Surfaceクロスフェードは以下のアニメーション層で対応し、動画・GLBは工程6の作業となる。診断用ガイドと製品データは別で、製品へfixture URLや模擬Backendを追加していない。現在の画面は引き続き位置合わせ用ガイドであり、自動的にfixtureプレゼンをロードしない。

`@unframe/contracts`をAudienceのworkspace依存へ追加し、pnpm-lockのAudience importerだけを更新した。共有契約・Backend・インフラ・CI設定の変更はない。

検証: `nix run .#audience`は155テスト・型検査・lint・build成功。追加の27テストでは契約fixtureのwire往復・素材対応、fit／UV、階層・表示・予算、PNG取得の拒否条件、取消・巻き戻し・セッション所有を確認した。PNGモジュール単独のブラウザ向けbundleも成功。画像デコードとGPU表示のテストはテストダブルを用いており、実ブラウザの画素表示、実機のカメラ同時負荷、実サーバー素材取得は未検証。

工程3の全体検証`nix run .#check`はCLI `react-project.test.ts`の凍結アーカイブ復元で既知のUTF-8エラー1件により失敗（CLI486成功・1失敗）。後続の集約チェックは未実行。ログは`/tmp/audience-png-full-check.log`、Audience個別の成功ログは`/tmp/audience-png-check.log`。代替検証としてAudienceの155テスト・型・lint・buildとPNGモジュールのブラウザbundleを確認した。全テスト成功を要するgit-commitスキルの条件を満たさないため未コミット。

## PNGレビュー指摘の修正（2026-10-22）

- Surfaceごとに描画Groupを分け、Sceneの描画前にcamera spaceの中心深度でSurface間の順序を更新する。各Surface内部はpartition layer順を維持する。元のSDK描画コールバックを呼び、scene破棄時に戻す。交差する半透明面の画素単位の合成を保証する方式ではなく、Surface中心による順序付けである。
- 置換前のImageBitmap保持量を候補のserial decodeピークへ加算し、上限超過は取得開始前に拒否する。取消したロードの解放を待ってから次を開始し、停止・破棄も待機候補を無効にする。失敗時は旧表示を維持する。
- Texture bindings、GPU／CPU量はchecksum単位で重複排除したPNGを集計する。同じchecksumの別asset IDも代表assetを共有し、URL／期限が異なっても重複ロードしない。サイズ・寸法・alphaが矛盾するmetadataは拒否する。

`nix run .#audience`は167テスト・型検査・lint・build成功。回帰テストは複数Surfaceの深度と同面layer、camera／親transformの変化、既存callbackの維持、置換時の予算・取消解放待ち、共有PNGとaliasを確認する。実機の画素描画とカメラ同時負荷は未検証。ビルドには既存の大きなchunkに対する警告がある。共有契約・Backend・インフラ設定は変更していない。

レビュー修正後の`nix run .#check`はCLIの凍結アーカイブ復元で既知のUTF-8エラー1件により失敗した（CLI486成功・1失敗）。後続集約チェックは未実行。代替検証としてAudienceの167テスト・型・lint・buildを確認済み。ログは`/tmp/audience-review-fixes-full-check.log`と`/tmp/audience-review-fixes-check.log`。全テスト成功条件を満たさないためコミットは引き続き保留。

## 進行状態の適用

`createAnchorSession().openRuntime(delivery)`が、通信から独立した受け口を返す。有効なXR sceneの起動後に呼び出し、既存契約の`ControlServerItemWire`を`applyControl`、`StateServerItemWire`を`applyState`へ渡す。`getSnapshot()`で待機・表示可能・再同期要求・終了と描画状態を取得できる。`stateSync: "awaiting-keyframe"`は通信側が次のState keyframeを要求するための状態であり、Controlの再同期とは分けて扱う。停止・scene破棄で受け口と素材を破棄し、その後の遅延入力は無視する。

- `runtime/wire-view.ts`: ProtobufのSnapshotを既存portable ParticipantRuntimeViewへ変換する。
- `runtime/runtime-store.ts`: Snapshot、Reliableイベント、State keyframe／deltaを検証して保持する。NodeのTRS・active・visible・opacity、Surfaceのcut切替、共有原点、同じGroup内のStep、一時停止・終了を反映する。
- `runtime/playback.ts`: 最新状態を描画へ渡す。素材準備中の更新をまとめ、同じ素材の更新ではtextureを再取得しない。必要な新素材は既存PNG取得・予算検査を通す。

Control側のsession・publication・profile・assignment・originの不一致、Reliable順序抜け、不正入力、未対応の状態は`resync-required`として表示を消す。Stateの差分抜け・fence不一致・Control未到達のbaseはそのframeを捨て、表示を維持して次のkeyframeを待つ。古いStateは無視する。復帰には接続側が`reset()`し、新しいSnapshotを渡す必要がある。Snapshotの重複による巻き戻しやState接続通知の重複は受理しない。終了時も表示を破棄する。

工程4はPNG描画・Timeline・Surfaceクロスフェードに対応する。Presenter anchor・Local Overlay・動画／model状態は未対応として拒否する。StateReady送信、Replay／Snapshot再取得、ブラウザ向けRealtime通信、HTTP取得と画面からの接続は未実装。受け口自身は通信を開始しない。現在の診断画面からプレゼンを自動取得することはない。

検証はSnapshotから実PNG描画モジュールへの結合、素材再利用、State差分、順序抜け時の即時非表示、明示的な再初期化、停止後の入力拒否を含む。カメラ・GPU・実ネットワークでの受入は未実施。

工程4の最終個別検証: `nix run .#audience`で215テスト・型検査・lint・buildが成功した。ビルドには既存の大きなchunk警告がある。実機・実ネットワークでの受入は未実施。

全体検証`nix run .#check`は、Audience外のCLI `react-project.test.ts`の凍結アーカイブ復元で既知のUTF-8エラーが再発し失敗した（CLI486成功・1失敗）。後続の集約チェックは未実行。代替検証はAudience個別ゲートの215テスト・型・lint・build成功。ログは`/tmp/audience-runtime-final-full-check.log`と`/tmp/audience-runtime-final-check.log`。コミットは作成していない。

## Group切替

RuntimeはGroup所有のNode／Surfaceを現在のGroupだけに絞り、presentation所有の状態と合わせて描画する。Snapshotには現在のGroupに属する完全な状態が必要であり、別Groupの状態や初期状態への自己補完は受理しない。

`GroupExited`で旧Groupの状態を破棄し、表示を消す。`GroupEntered`の初期状態を検証して保持し、続く`StepEntered`で新しい安定状態を公開する。切替途中のStateは次のkeyframe待ちとし、旧Groupの差分を新しいGroupへ適用しない。presentation所有の状態はstore内で維持する。epochや対象Groupが不正なイベントは再同期要求となる。

PNG計画は現在のGroupとpresentation所有リソースだけを対象にする。旧Groupのmesh・素材は退出時に破棄され、新しいStep確定後に必要素材を読み込んで描画する。同じロード済み素材だけで表示更新できる場合は再取得せず、不要になったtextureを解放する。ロードが失敗した場合に退出済みGroupを復元しない。

ProjectedRuntimeCatalogにはGroup一覧がないため、資源を持たないGroup IDの存在確認はできない。順序・epoch・初期状態は検証する。

動画／GLB・実通信は引き続き未対応。

Group切替の最終個別検証: `nix run .#audience`で232テスト・型検査・lint・build成功。既存のchunkサイズ警告がある。実機・GPU・実サーバー素材取得は未検証。ログは`/tmp/audience-group-root-final-check.log`。

Group切替の全体検証`nix run .#check`はAudience外のCLI `react-project.test.ts`凍結アーカイブ復元の既知UTF-8エラー1件で失敗（CLI486成功・1失敗）。後続の集約チェックは未実行。代替検証はAudience個別ゲートの232テスト・型・lint・build成功。全体ログは`/tmp/audience-group-full-check.log`。コミットは未作成。

## TimelineとSurfaceクロスフェード

`runtime/animation-view.ts`は既存DeliveryのTimelineと受信したRunを使い、指定runtime時刻の表示状態を純関数で導出する。opacity・position・rotation・scale、4種類のeasing、Quaternionの最短経路補間とcanonicalな符号を扱う。canonicalな受信状態へ毎フレームの補間値を書き戻さない。

`runtime/runtime-clock.ts`は受信runtime時刻をローカルの単調時計へ対応付ける。running中だけ経過時間を加え、pause／終了では停止する。同じ時刻のState受信で基準を再設定しない。ネットワーク遅延や端末間の時計差を測定・補償する機能は未実装であり、実通信時の同期精度は別途検証が必要。

RuntimeはTimeline開始・完了・取消、Surface transition開始・完了を検証する。Timeline完了では終値、明示停止／Group退出による取消ではイベント時刻の値を保持する。Presentation終了による取消では終値をcommitしない。表示が終点へ達してもRunの完了や次Stepへの進行をローカルに決定せず、Controlイベントを待つ。Timeline所有propertyをStateが上書きする入力を拒否し、Run lifecycle前のbaseの遅延Stateは表示を保って破棄する。

`playback.prepareFrame()`をXRの描画前に呼び、素材準備が完了したviewだけをsampleする。PNG rendererは既存meshのTRS・visibility・opacityとshaderのweightだけを更新する。静的表示では補間を省略する。フレーム評価／描画の失敗時は詳細を外へ出さず表示を破棄する。

Surfaceクロスフェードはfrom／to両状態の素材を準備し、両方のメモリ予算を検査する。Surface内の全partitionを旧状態・新状態それぞれでlayer順にpremultiplied RGBA合成し、その2枚の合成結果を混合する。重なるpartitionを個別にフェードして重ねる方法ではない。1つのSurface shaderで使うunique textureは8枚を上限とし、超過は取得前に拒否する。empty状態は透明端点として扱う。両素材は完了イベントまで保持し、完了後の更新で不要素材を解放する。Timeline中とSurfaceの累積opacityが1未満の場合もSurface単位で合成してから透過を掛け、重なるpartitionへ別々に透過を掛けた際の差を避ける。Shaderの実機GPU画素検証は未実施。

Snapshotのtransitioning／pendingNextは受信して保持する。開始イベントにはpendingNextが含まれないため、そのイベントだけから進行判断や新しいpendingNextを生成しない。CueやFlowを再実行せず、Step／Groupイベントへ従う。既存契約・Backend・共有設定・依存は変更していない。

Timeline／遷移の全体検証`nix run .#check`はAudience外のCLI `react-project.test.ts`凍結アーカイブ復元の既知UTF-8エラー1件で失敗（CLI486成功・1失敗）。後続の集約チェックは未実行。全体ログは`/tmp/audience-animation-full-check.log`。実機GPU／実通信の受入は未実施、コミットは作成していない。

Timeline／遷移の最終個別検証: `nix run .#audience`で271テスト・型検査・lint・build成功（既存chunkサイズ警告あり）。さらに一時ローカル検証ページをChrome headless／SwiftShaderで描画し、shaderコンパイルと重なる背景／前景の画素を確認した。linear RGBA8でcrossfade中間値`[128,0,0,255]`、合成後opacity=0.5の値`[128,0,0,128]`が成功。検証ページと一時サーバーは削除・停止した。実iPhone GPU・カメラ同時負荷・実通信の同期精度は未検証。ログは`/tmp/audience-animation-composite-final-check.log`と`/tmp/audience-animation-gpu-output.html`。

## 変数とViewerの入力状態

Runtimeはcatalogに宣言された変数を既存ScalarType（string／finite number／boolean／null）と照合して保持する。Snapshotにはpresentationと現在Groupが所有する変数の全件が必要で、欠落・重複・不明ID・他Group値・型不一致を拒否する。`VariableChanged`は受信した値を適用し、Cue・guard・演算式をAudienceで再実行しない。

Group退出時にはGroup変数を破棄し、入場・再入場では`GroupEntered.initialization.variables`を適用する。presentation変数はGroup間で維持する。変数は`getSnapshot().view.variables`から取得できる。既存のPNGは固定画像であり、変数から文字・HTML・素材を生成し直す機能はない。native-uiの動的bindingは未対応のまま。

`openRuntime(delivery)`の受け口は`projectionProfile.key.role`が既存SessionRoleのViewer（2）であることを検証する。Presenter／未指定／未知roleは拒否し、Viewer Snapshotに空でない`enabledLogicalInputs`がある場合も再同期要求とする。既存契約の有効入力一覧はPresenter向けで、Viewerは常に空配列。有効入力集合の差分イベントは存在しない。`LogicalInputAccepted`は実行済み通知として扱い、進行入力を有効化しない。Audienceからの進行コマンド送信やPresenter用入力UIは追加しない。

Wire変換・PNG描画の低水準関数はroleから独立した処理であり、資格・参加権限の検証を代替しない。共有fixtureは変更せず、Audience RuntimeテストのcloneだけをViewer用にして検証する。匿名資格発行・profile登録・HTTP／ブラウザ通信は未接続。

変数／Viewer入力状態の最終個別検証: `nix run .#audience`で303テスト・型検査・lint・build成功（既存chunkサイズ警告あり）。変数更新からPNG描画までの結合、素材再取得なし、Viewer入力の無効維持、Presenter／不正Viewer Snapshot拒否を確認した。実通信・実機での受入は未実施。ログは`/tmp/audience-variables-root-check.log`。

変数／Viewer入力状態の全体検証`nix run .#check`はAudience外のCLI `react-project.test.ts`凍結アーカイブ復元の既知エラー1件で失敗（CLI486成功・1失敗）。後続の集約チェックは未実行。代替検証はAudience個別ゲートの303テスト・型・lint・build成功。全体ログは`/tmp/audience-variables-full-check.log`。Backend・共有契約・依存・設定の追加変更はなく、コミットは未作成。

## 開発専用fixture表示画面

開発サーバーを起動し、HTTPS経由で`/?fixture=1&size=36`を開く。`size=36`は黒いタグ外周24cm（余白込み36cm）、`size=22.5`は黒い外周15cm。`fixture=1`は開発モードでだけ有効で、本番ビルドには画面・シナリオ・テストPNGを含めない。通常のURLでは従来の位置合わせ画面を表示する。

1. テスト画面でタグの黒い外周サイズを選び、同サイズのAprilTag ID 0を別の画面または紙へ用意する。
2. 「カメラを開始」を押し、カメラ・動きの検出を許可する。SDK NORMAL／検出器準備の完了を待ち、タグを映す。
3. タグの約50cm上方に幅1m・高さ0.5625mの画像Aを表示する。タグを覆わずに位置・実寸・追跡保持を確認する。
4. 「次の操作」で移動・透過、停止／再開、A→Bクロスフェード、変数更新、Group退出／初期化／Step開始、終了を順に確認する。退出から新Step開始までは非表示になる。
5. 「初期状態に戻す」でSnapshotからやり直し、「停止」でカメラを止める。「状態をJSON保存」で操作番号・Runtime・追跡概要を保存できる。画像・素材URL・Deliveryは含めない。

これは固定のテスト時刻を持つ手動シナリオであり、クリック間隔とRuntime時刻は一致しない。例えば遅れて一時停止を押すと、指定された1秒地点へ戻る。実サーバー同期精度の検証には使わない。素材は開発用パス`/src/fixtures/slide-a.png`・`slide-b.png`から同一originで取得し、既存PNG loaderのHTTPS・checksum・寸法検証を通す。HTTPで素材URL制約を緩めないため、スマホでは信頼できるHTTPS経由で開く。

`nix run .#audience -- dev --host 127.0.0.1 --port 4175 --strictPort`で開発サーバーを起動できる。既存の一時HTTPSトンネルを同じポートへ接続する。トンネルURLは再起動で変わるため固定の公開先として扱わない。

カメラ開始は明示操作のみ。停止・再初期化・画面破棄で遅延処理を無効化する。模擬Backendや匿名資格の発行は追加していない。カメラを使ったiPhone実機受入は未実施。

fixture画面の個別検証: `nix run .#audience`で312テスト・型検査・lint・build成功（既存chunkサイズ警告あり）。本番distにfixture画面文言・scenario・テストPNGが含まれないことも確認した。Chrome／SwiftShaderでHTTPS実素材の取得・hash検証・decode・Snapshotと全11操作・非空画素の描画まで成功。個別ログは`/tmp/audience-fixture-check.log`、ブラウザ結合ログは`/tmp/audience-fixture-render-output.html`。iPhone実機カメラ受入は未実施。

最終の停止履歴／追跡状態修正後は313テスト・型検査・lint・build成功。本番distへの非混入も再確認した。全体`nix run .#check`はAudience外のCLI凍結アーカイブ復元の既知UTF-8エラー1件で失敗（CLI486成功・1失敗）、後続集約チェックは未実行。代替検証は個別Audienceゲート。ログは`/tmp/audience-fixture-final-check.log`と`/tmp/audience-fixture-full-check.log`。未コミット。

## fixtureカメラ表示と検出器ロードの修正（2026-10-23）

fixture canvasも通常画面と同様にCSSのwidth／heightを100% importantへ固定した。SDKのThree.setSizeは描画pixel寸法をinline CSSにも書くため、通常CSSだけではDPR=2のとき表示がviewportの2倍となる。カメラのFOV・ズーム・検出画像の解像度を変えず、CSS表示寸法と描画buffer寸法を分離する。ブラウザで修正前の2倍表示を再現し、修正後はDPR1／2／3相当のinline指定すべてでviewportと一致した。

AprilTag配布moduleは同一originの絶対URLへ解決して動的importする。Vite DEVが相対URLへimport queryを付けてpublic moduleをsource変換しようとする500エラーを避ける。WASMも従来通り同一originから取得し、配布vendorを改変しない。通常画面とfixtureは同じ検出器loaderを使う。

修正後の個別検証: `nix run .#audience`で314テスト・型検査・lint・build成功（既存chunkサイズ警告あり）。Chromeの実module WorkerでAprilTag WASM初期化とtag36h11 ID 0検出も確認した。レイアウト検証ではDPR1／2／3相当のinline backing寸法に対し表示寸法がviewportへ一致。SDKのカメラFOV・内部行列・source画像解像度は変更していない。iPhone実機での再確認は未実施。ログは`/tmp/audience-fixture-camera-fixes-check.log`、`/tmp/audience-detector-browser-final-green.log`、`/tmp/audience-fixture-layout-final.html`。

今回の全体`nix run .#check`はAudience外のCLI凍結アーカイブ復元の既知UTF-8エラー1件で失敗（CLI486成功・1失敗）。後続集約チェックは未実行。代替検証は個別Audienceの314テスト・型・lint・buildと実ブラウザ検証。全体ログは`/tmp/audience-fixture-camera-fixes-full-check.log`。未コミット。

## プレゼン進行時のカメラ停止対策（2026-10-23）

初期PNGからTimelineへ切り替えると旧MaterialのGL programが破棄される。SDKのカメラ用GlTextureRendererはcurrent programを保存・復元するため、削除予約されたprogramを切り替えた後に復元するとINVALID_OPERATION（1282）となる。実SDKとThree.jsの共有WebGL contextで修正前1282・resetState後エラーなしを再現した。

Tracking adapterはSDKのxrScene.rendererのresetState操作をsessionへ渡す。sessionはPNG applyView・置換／停止時のMaterial破棄・anchor破棄前にresetStateを呼び、GLとThree内部キャッシュを合わせて解除する。生のgl.useProgram(null)だけでThreeのキャッシュを残さない。

カメラ取得前から存在するGLエラーはframe-source-gl-errors（before-capture）に記録し、自身のrender／readPixels中のエラー（capture）とは分離する。取得処理自身のエラー、context loss、32回で収束しないerror状態は停止する。検出画像の寸法・intrinsics・追跡精度の設定は変更しない。

fixtureチェックポイントをschemaVersion 2へ更新し、tracking.error・camera取得diagnostics・GL errorsのbefore-capture／capture区間・最後の正常Runtime概要を保存する。画像や素材URLは含めない。現在Runtimeが停止後awaiting-snapshotへresetされてもlastReadyRuntimeで直前状態を区別する。

最終個別検証は`nix run .#audience`で325テスト・型・lint・build成功（既存chunk警告あり）。停止時のリソース解除順、既存GLエラーと自身の取得失敗の分離、schema2診断、カメラ停止後の再試行を検証した。実SDK GL再現は修正前1282／resetState後エラーなし。全体`nix run .#check`はCLI凍結アーカイブ復元の既知UTF-8エラー1件で失敗（CLI486成功・1失敗）、後続集約チェックは未実行。ログは`/tmp/audience-camera-progress-final-check.log`、`/tmp/audience-camera-progress-full-check.log`、`/tmp/audience-sdk-resource-repro.html`。iPhone実機での症状解消確認は未実施、未コミット。

## HTTP参加の接続準備（2026-10-23）

通常の入口 `/` はルームコード入力画面。開発用fixtureは `/?fixture=1&size=36`、位置合わせ単独の検証は `/?tracking=1&size=36`。どちらも開発時のみで、fixtureのSnapshotを実接続として扱わない。前回のfixture一連操作はユーザーが実機で正常動作を確認した。

AudienceアプリのVite環境変数を設定して開発サーバーを再起動する。本番はビルド時に指定する。値は公開設定であり、資格やトークンを入れない。

| 設定                                  | 内容                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `VITE_AUDIENCE_API_ORIGIN`            | 担当者から提供されたHTTPS Control Plane origin。パス・query・資格は不可 |
| `VITE_AUDIENCE_CAPABILITY_PROFILE_ID` | 実装済み表現・端末予算に適合し、サーバーへ登録されたAudience profile ID |

未設定時は参加ボタンを無効にする。架空の資格発行API、profile名、Realtime endpoint、ログイン画面は追加しない。現在のHTTP認証は既存APIのCookie identityを `credentials: include` で利用する。匿名viewerの発行経路は未提供であり、未認証時は401を表示する。既存ログインを製品の参加要件にはしない。API originのCORS・Cookie・Origin検証の許可はBackend担当が設定する。

- `connection/http-client.ts`: 既存Control Plane生成型を使用。join・bootstrapのJSONを実行時検証し、Deliveryは共有Protobuf decoderで読み込む。HTTPS、Content-Type、契約バージョン、取消、期限を検証する。応答本文のエラー・資格・署名URLをログや画面へ出さない。
- `connection/join-controller.ts`: 順序、同session・Viewer・capability・projection・publication・assignmentの整合を検証する。確定した資格と素材URLはメモリのみで保持し、最短期限で破棄。`getPrepared()`も期限を再確認する。画面のsnapshotには資格を含めない。
- `connection/JoinExperience.tsx`: 参加・失敗・取消・情報更新・接続解除を表示する。`prepared`はHTTP接続情報の取得完了であり、ライブ受信や素材描画の準備完了ではない。

「取得情報を更新」は同じ参加者・sessionでDeliveryとbootstrapを再取得する。公開物のfenceと選択済profileを維持し、assignmentの更新は新しいDeliveryとbootstrapを照合する。匿名identityの発行・延長を代行せず、取得失敗・期限切れは再試行を要求する。リロード後の自動復帰・資格の永続保存・自動更新は未実装。「退出」はAudience内の処理取消と保持データ破棄であり、サーバーの参加者削除APIは呼ばない。

HTTP取得後のRealtime transport、handshake、Snapshot受信、Ready送信、実プレゼン表示への接続は後続。既存の `openRuntime()` と取得済Deliveryをつなぐのは、その通信方式が確定してから行う。資格だけで擬似Snapshotを生成しない。

検証: `nix run .#audience` は383テスト・型検査・lint・build成功（既存の大きなchunk警告あり）。HTTPの実clientと接続制御をJSON／Protobuf応答で結合し、Viewer／fenceの不一致、401、取消後の遅延完了、資格・素材URLの最短期限、タイマー停止中の利用時検査、同公開物のassignment更新を検証した。Chromeで参加画面の表示を確認。実Backend・匿名参加・ライブ受信の受入は未実施。

`nix run .#check` はAudience外の `packages/unframe-cli/test/react-project.test.ts` の既知の `semantic/cli-lock-update-failed: The encoded data was not valid for encoding utf-8` で失敗（CLI486成功・1失敗）。後続の集約チェックは未実行であり、合格とは扱わない。Audienceは上記個別ゲートで検証した。ログ: `/tmp/audience-connection-final-check.log`、`/tmp/audience-connection-full-check.log`。コミットは未作成。

## 動画・GLB表示（2026-10-23）

工程6の表示実装を追加した。実通信は未接続のまま、既存Delivery・ParticipantRuntimeView・Controlイベントを入力とする。共有契約・Backend・依存・CI・インフラ設定への追加変更はない。以下以前の日付の開発記録は当時の状態であり、現在の対応範囲は本節を参照する。

### 対応範囲

- 動画: 不透明H.264 MP4、音声あり／なし。Surfaceの物理寸法、contain／cover／stretch、partition、layer、NodeのTRS・visibility・opacity、PNGと同じSurfaceのクロスフェードを反映する。同じ素材でもSurfaceごとにdecoderを独立させる。
- 再生: Runtime時計とmedia状態に基づく再生・停止・一時停止・再開・seek・loop・途中参加。再生中は150msを超える時刻差をseek、停止中は1msを超える差を反映する。初回停止フレームとseek完了時もVideoTextureを更新する。完了・Cue進行はローカルで決定せずサーバーイベントに従う。
- GLB: glTF 2.0の自己完結GLB、TRIANGLES、標準PBR／unlit、alpha、skin、morph、親子TRS。clipの速度・loop・停止姿勢・同一clip間を含むcrossfade・途中参加を適用する。slotごとのAnimationClip wrapperはtrackを共有する。
- 制約: 動画VP9／AV1／alpha、native-ui、Presenter anchor、Local Overlayは未対応。GLBは埋込PNG／JPEGと `KHR_materials_unlit` 拡張に対応し、外部URI・Draco／Meshopt／KTX2等は拒否する。PBRには既定のHemisphere＋Directional照明を使用する。Unframeの全表現・全拡張を無条件に対応済みとは扱わない。

### 所有と資源

`assets/video-asset.ts`／`model-asset.ts`がHTTPS・期限・CORS・MIME・サイズ・SHA-256・実デコード情報を検証する。GLBは読み込み前に内部URI、構造、頂点・triangle・clip数、埋込画像寸法、必要featureを検証する。mipmapは各levelの容量を合算する。

`rendering/presentation.ts`がPNG・動画・GLBを準備し、全件成功後に接合する。Surfaceの共通合成は `surface-presentation.ts`、動画時計とdecoder所有は `video-presentation.ts`、モデルとAnimationMixerは `model-presentation.ts`。途中失敗・取消・終了・Group退出で所有物を解放する。新素材へ置換する場合は旧decoder／モデルを先に破棄し、ロード中は表示が空になる場合がある。

PNGとGLBのtexture GPU容量・binding、既読込モデル・PNG・動画の既知CPU量を予算照合する。動画はencoded Blob＋RGBAフレームを見積もる。ブラウザdecoder内部やドライバ内部の実メモリ量は取得できず、契約値だけで端末の総メモリ安全性を保証しない。最終的なAudience profileの上限はカメラ・検出Workerと同時に実機測定する。

SDK追跡低下とページ非表示で動画を停止し、新しいタグ認識後にRuntime時計へ合わせて復帰する。音声付き動画等の自動再生が拒否された場合はfixture画面の「動画の再生を許可」を押す。許可後も拒否される端末では実機確認が必要で、音声を黙って無効にはしない。

### スマートフォンでの確認

開発サイトの `/?fixture=1&size=36` を開く。黒いタグ外周24cm（15cmの場合は画面で切替）を使う。

1. 「テスト内容」で「PNG・動画・GLB」を選び、カメラを開始してAprilTagを認識する。
2. PNGが中央、60×33.75cmの動画が左、20cm角のGLBが右に表示される。操作ボタンで動画・GLBの再生、一時停止、seek、crossfade、停止、終了を順に確認する。
3. 停止後に「動画・GLBの途中参加（2秒地点）」へ切り替え、2秒地点のSnapshotから再開する。
4. 「状態をJSON保存」で選択したfixture、再生許可待ち、進行状態と追跡情報を保存する。資格・素材URL・画素は含めない。

操作ボタンは固定Runtime時刻を持つfixtureであり、クリック間隔に合わせた実サーバー時計ではない。実素材は小さな4秒320×180 H.264動画と、回転／上下移動の2clipを持つGLB。テスト用MP4／GLBと画面は本番bundleに含めない。

検証: `nix run .#audience` は444テスト・型検査・lint・build成功（既存chunkサイズ警告あり）。Chrome／SwiftShaderで実HTTPS素材の取得・hash・MP4デコード・GLTFLoader解析・通常15操作／途中参加13操作・非空画素・動画領域の色の変化・WebGL error=0・終了後のroot撤去を確認した。仮想時計で動画デコードのタイムアウトが起きたため、GPU受入は実時間のChromeで行った。iPhone Safariのカメラ・タグとの同時負荷、音声付き動画、長時間メモリ測定、実Backend／Realtime接続は未検証。

全体ゲート `nix run .#check` は既存CLI `packages/unframe-cli/test/react-project.test.ts` の凍結アーカイブ復元でUTF-8エラーが再発（486成功・1失敗）。後続集約チェックは未実行。ログは `/tmp/audience-media-full-check.log`、Audience個別は `/tmp/audience-media-final-check.log`、実ブラウザは `/tmp/audience-media-cdp.json` と `/tmp/audience-media-cdp-late.json`。変更は未コミット。

## SDK起動・更新の診断（2026-10-23）

fixtureと位置合わせテスト画面に「SDK処理」を追加した。SDK読込、SLAM読込、pipeline開始待ち、カメラ開始済みを表示し、その後のSDK更新回数・reality受信回数・有限位置／単位Quaternion受信回数・最終更新からの秒数を表示する。カメラ開始だけでSLAMの推定処理が進んだとは扱わない。有効姿勢の受信もNORMALや精度保証とは別の指標。更新が3秒以上途切れた場合はその旨を表示する（バックグラウンド停止等も含み、原因を断定しない）。

SDK生状態・理由・状態イベントと、devicemotion／deviceorientationの受信回数・加速度／角速度の有効値の有無も表示する。センサー観測は権限を追加要求せず、生の加速度・角速度・headingを保存しない。未受信だけでは非対応・許可拒否と断定しない。観測はSDK開始時にreset、停止／失敗時にlistenerを撤去する。

「状態をJSON保存」のschemaVersion 2に追加項目として `diagnostics.measurementSnapshot.startup`、`sensors`、`trackingDiagnostics`を保存する。startup／sensorカウンタは今回の開始、trackingDiagnosticsのカウンタはadapter生存期間の累計で、lastUpdate／lastEventにはsessionIdを含める。SDK生値は型と安全な状態文字列／数値に限定し、URL・任意エラー・画像を出さない。前の出力では追跡診断が除外されていた点を修正した。session.startの5秒待機設定も正しく保存する。NORMAL待機条件・画像サイズ・姿勢推定・タグ採用条件は変更しない。

起動診断の個別検証: `nix run .#audience` は452テスト・型検査・lint・build成功（既存chunkサイズ警告あり）。Chromeでfixture画面のSDK処理表示を確認。センサー生値を保存しないこと、停止時listener撤去、再開始時reset、NORMAL前のpipeline更新記録、JSONの安全な項目出力をテストした。Galaxy実機での再確認は未実施。個別ログ: `/tmp/audience-startup-final-check.log`。

全体検証 `nix run .#check` は既存CLI `react-project.test.ts` の凍結アーカイブ復元で既知のUTF-8エラーにより失敗（CLI486成功・1失敗）。後続の集約チェックは未実行。ログ `/tmp/audience-startup-full-check.log`。今回の追加はAudienceと関連記録のみ、未コミット。

## 視聴UI（2026-10-24）

Material Design 3の色の役割・余白・丸い形状を参考に、青緑 `#006b5f`、明るいsurface、角丸32px、pill型の主操作を採用した。外部UIライブラリ・フォント配信・画像・依存は追加していない。

1. `/`: ルームコード入力。入力と参加操作を中心に配置し、接続不可や失敗を表示する。既存join → Delivery → bootstrapがpreparedになった後、明示的なカメラ開始画面へ進む。
2. カメラ開始後: カメラ映像の上に「空間を準備しています」を表示。SDK NORMAL待ちと連続NORMALの残り秒、検出器準備を区別する。5秒待機条件は維持。
3. 認識中: カメラ映像、短いマーカー案内、ガイド枠、小さな状態表示・メニューだけにする。枠の大きさへ実物を合わせる必要はない。
4. 視聴中: 大きな説明や操作パネルを表示せず、状態chipとメニューのみ。再生許可が必要な動画ではその操作だけ追加する。SDKがLIMITEDになれば準備画面へ戻し、再認識する。

ライブ受信は未実装のため、通常参加後は位置合わせができても「プレゼンテーションを待っています」と表示する。タグ認識だけで実プレゼン受信済みとは扱わない。退出・資格失効でカメラ画面を破棄する。現在の実環境には匿名資格／登録profile等の外部提供が必要で、未設定の参加ボタンは無効のまま。

`ui/AudienceStage.tsx`が共通の表示とメニューsheet、`ui/viewing-phase.ts`が実状態に基づく表示段階を担当する。SDK・検出器・姿勢・メディア処理の条件は変更しない。診断・サイズ設定・ログ保存・ライセンスは右上メニューへ移した。メニューはEscape／閉じる／背景タップで閉じ、キーボードのfocusを管理する。reduced-motion、safe-area、44px以上の操作領域に対応する。

`/?fixture=1&size=36`でも同じUIを使う。テスト内容、次の操作、停止、初期化、JSON保存はメニュー内。表示データ準備と位置合わせが両方成立してから視聴画面にする。fixtureと通常視聴では検証用の箱・座標軸・1m枠を描画せず、`/?tracking=1`の位置合わせ確認だけに残す。

390×844のブラウザでルーム入力・許可・SDK待機・認識・視聴の各画面を確認し、横はみ出し0を確認。背景はレイアウト確認用の色面で、実カメラとの合成を再実証したものではない。新たなXR精度実験は実施していない。スクリーンショットは `/tmp/audience-ui-{join,permission,sdk,scanning,viewing}.png`、一時確認ページは検証後削除する。

UI変更の検証: `nix run .#audience` は459テスト・型検査・lint・build成功（既存chunkサイズ警告あり）。画面段階、視聴中の最小UI、メニュー操作、HTTP prepared後のカメラ画面、退出／資格失効、検証ガイド非表示を確認。ログ `/tmp/audience-ui-final-check.log`。本番bundleに動画／GLB fixtureを含まないことを確認。

全体ゲート `nix run .#check` は今回未変更の `packages/unframe-compiler/test/video-compilation.test.ts:245` の `preserves baked/video/baked paint order with complete independent ownership` が5000msタイムアウト（compiler387成功・1失敗）で停止。後続集約チェックは未実行で、全体成功とは扱わない。設定・timeoutは変更しない。ログ `/tmp/audience-ui-full-check.log`。変更は未コミット。

## Draft更新前レビュー（2026-10-24）

契約・進行状態、素材取得と描画、UIと追跡を分けて確認し、次の3件を回帰テスト付きで修正した。

- 適用済みControlより古いStateのbaseを拒否し、確定したNode位置・表示状態の巻き戻しを防ぐ。表示は維持してState keyframeを待つ。
- PNGのIHDR構造と実寸を画像デコード前に照合し、宣言寸法による予算検査をすり抜けた画像を先に展開しない。
- マーカーサイズ変更時に検証用ルートのqueryとhashを保持し、再読み込み後も検証画面へ戻れるようにする。

最終Audience個別ゲート `nix run .#audience` は52ファイル・467テスト、型検査・lint・本番buildが成功。ログは `/tmp/audience-pr-final-check.log`。既存の500kB超chunk警告は残る。実Backend／Realtime接続とAndroidのNORMAL待機問題の解決を完了扱いにしない。今回の追加差分はAudience本体、関連文書、既存contractsを参照するAudience importerの依存ロック3行のみ。共有契約・Backend・CI・Nix設定の追加変更はない。

今回の `nix run .#check` はControl Planeの検査を通過後、Audience外の `packages/unframe-compiler/test/video-compilation.test.ts:245` の `preserves baked/video/baked paint order with complete independent ownership` が5000msタイムアウトし停止した（compiler387成功・1失敗）。後続集約チェックは未実行。全体成功とは扱わず、対象外のコードやtimeout設定は変更しない。ログは `/tmp/audience-pr-full-check.log`。ユーザーの現状保存・push依頼に従ってDraftへ反映し、この検証制約をPRへ明記する。
