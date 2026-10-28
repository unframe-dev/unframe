# Audience Web XR

他担当への実装・提供依頼、接続順、受入条件は[引き継ぎ報告書](docs/handoff-report.md)を参照。

会場の観客向けWeb XRクライアント。2026-10-22に位置保持PoCを完了し、採用済みの追跡構成でWebアプリを開発している。現在はAprilTag `tag36h11`の単一ID 0と8th Wall SDK／SLAMを使う位置保持に加え、契約データによるPNG・H.264動画・GLB描画と進行状態適用をアプリ内部で実装している。既存HTTPのjoin → Delivery → bootstrapクライアントと参加画面を実装済み。匿名 Viewer 資格・Audience profile・ブラウザ Realtime adapter を実装済み。公開環境とスマートフォンでの総合受入は未実施。

## 採用した方式

1. 有効なタグ姿勢と同じ取得callbackのSDK姿勢を1ペア得たら、会場との対応を即更新する。一致待ち・平滑化・残差による採用保留は行わない。
2. 次の有効なタグ観測まではSDK座標内の物体を固定し、SDKカメラの移動・回転で表示を保持する。
3. タグ未検出・姿勢が曖昧・再投影誤差超過・SDK姿勢欠落では新位置を採用せず、前の有効位置を保持する。
4. SDK追跡がLIMITEDになった場合、hidden、停止では物体を非表示にし、対応を破棄する。NORMAL復帰だけで古い位置を再表示せず、新しい有効なタグ観測を待つ。

SDKはabsolute。NORMALが連続5秒続いた後に検出器を準備し、最大頻度で検出を開始する。準備中に追跡が低下すれば待ち直す。検出は単一Worker・同時1フレームで、完了後に新しい画像を取得し、待ち行列を作らない。

実機報告では黒外周150mmで約3.3m、240mmで約5.8mを認識した。距離別の小揺れ補正を含む現構成を、ユーザーがWebアプリ開発へ進む基準として承認した。当面は観客が立ち位置を固定する前提。これは外部真値による10cm精度や、7m初回認識・不可視5〜10分保持を定量実証した結果ではない。追加の追跡実験を開発開始の条件とはせず、必要な改善は製品要件に応じて別途扱う。

## 操作

サイトの `/` はルーム参加画面。位置合わせ単独の検証は開発時の `/?tracking=1` を開き、必要ならサイズを選び「カメラを開始」。検出器の選択はない。詳細メニューにSDK状態・理由、タグ採用回数、実効検出Hzと診断を表示する。

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

### Cloudflare Workers

`wrangler.toml` は `dist/` を `unframe-audience` Worker で配信する。公開ドメインは `app.un-fra.me`。Wrangler の Custom Domain 設定により、デプロイ時に Workers が DNS レコードと証明書を作成・管理する。

Workers Builds のルートを `app/web/audience`、ビルドコマンドを `pnpm run build`、デプロイコマンドを `pnpm run cf:deploy` に設定する。ローカルではリポジトリルートから次を実行する。

```bash
pnpm --filter @unframe/audience run build
pnpm --filter @unframe/audience run cf:deploy:dry-run
```

全リクエストを Worker 経由で配信し、呼び出しログを100%のサンプリング率で保存する。Cloudflare の対象 Worker の Observability、または `pnpm --filter @unframe/audience run cf:tail` で確認できる。ログの URL からクエリ文字列を除去する。ブラウザ内の console／追跡診断は送信しない。Worker 経由の配信には Workers のリクエスト上限・課金が適用される。

## 構成

- `src/dev/fixtures/`: 開発用の素材表示画面、シナリオ、PNG・動画・GLB。
- `src/dev/tracking/AnchorExperience.tsx` / `AnchorExperienceView.tsx`: 位置合わせ検証の画面入口と表示専用View。カメラ・Workerの所有や姿勢推定を持たない。
- `src/dev/tracking/use-anchor-experience.ts`: 検証用の設定・サイズ選択、Reactの画面状態とセッションの接続、アンマウント時の破棄。
- `experience/anchor-session.ts`: 権限要求、開始・停止、NORMAL待機、検出開始、リセット、古い非同期処理の拒否。設定ごとに1セッションを所有する。
- `experience/tag-anchor-state.ts`: タグ推定結果と確定アンカーの状態。単一観測の即採用、SDK姿勢と500ms未満の鮮度条件、未検出時の保持を扱う。
- `src/dev/tracking/diagnostic-export.ts`: schemaVersion 21のJSON構築と明示ダウンロード。設定読込失敗時も環境・診断記録を保存できる。
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

自動テストは各実装ディレクトリの `test/` に配置する（例: `src/connection/test/`、`src/dev/fixtures/test/`、`scripts/test/`）。描画テスト専用のデータ生成は `src/rendering/test/support/` に置く。各 `test/` はVitest・型検査・lintの対象とする。

画像を縮小・中央切抜きせず、SDK報告videoサイズを維持する。4096×4096画素予算を超える入力はエラーにし、黙って縮小しない。画素はWorkerへ移譲し、結果と一緒に返却して同じフレームへ復元する。別のgetUserMedia・描画ループは追加しない。

`@8thwall/engine-binary@1.0.0`、Three.js `0.183.2`を固定。`js-aruco2@2.0.0`は検出器としては使わず、姿勢推定のPOSIT/SVDとAprilTag辞書の資産生成のために残す。runtime生成コードは`generated-posit.mjs`でSVD/POSだけを含む。

## JSON

通常ログはschemaVersion 21 / mode `audience-anchor`、ファイル名`audience-anchor-tracking-log.json`。frameごとに単一検出結果`result.detections/durationMs`、タグ姿勢・候補診断、採用可否`anchorUpdated`、最新アンカー、K・画像/画面寸法・時刻metadataを保存する。SDK生値・型・理由・姿勢、取得／投入／完了／配送／棄却／取消、処理時間と実効Hz、リング欠落件数も記録する。過去の比較スキーマと結果構造が異なる。旧形式向けの互換経路は持たない。

「検出入力画像付きJSONを保存」では、最新の配信結果1件を`detectorInput`へ含める。原寸gray8のBase64と同じ画素のPNGを、枠・軸なしで同梱する。未検出0件でも保存できる。停止後も保存可能で、新しい開始・サイズ変更で前画像を破棄する。結果が一度も配信されていない場合は保存できない。画像に周囲の人や会場が含まれる可能性を画面に明示し、自動送信しない。通常JSONには画素を含めない。

## 限界と履歴

センサー露光時刻とSDK姿勢時刻の同期、歪み補正・物理カメラ較正、SDK地図epochは未確認。SDK報告寸法はセンサー原寸の保証ではない。NORMALや再投影誤差を物理的な精度の証明にしない。タグ姿勢が揺れれば即採用による表示ジャンプも起こり得る。

SDK配布物は未改変で同一originへ配置し、LICENSE・著作権・ハッシュを保持する。AprilTag wrapper、AprilTag本体、POSIT/SVD、辞書の必要なライセンスを画面から参照できる。

[採用方式と整理記録](docs/experiments/audience-apriltag-adopted.md)、[接続・配信・実機受入計画](../../../docs/plans/audience-web-app-plan.md)。

## 表示の小揺れ補正

確定したタグ姿勢とSDK姿勢は変更せず、SDK座標内のマーカー表示姿勢だけをタグ更新時に補正する。距離はタグ由来の会場内カメラ位置とマーカー位置から求めるため、SDKの移動値で閾値は変わらない。

| タグまでの推定距離 | 位置差の閾値             | 回転差の閾値             |
| ------------------ | ------------------------ | ------------------------ |
| 2.5m以内           | 10mm                     | 0.5度                    |
| 2.5〜5.5m          | 両端の値を距離で線形補間 | 両端の値を距離で線形補間 |
| 5.5m以上           | 20mm（上限）             | 1度（上限）              |

直前の確定姿勢・現在の表示姿勢の両方との差が位置・回転とも閾値以内なら、表示を新しい姿勢へ35%寄せる。どちらかの閾値超過、初回、clear後、距離が非有限または負の場合は位置と回転を即反映する。微小な本当の修正もこの範囲では抑える可能性がある。閾値と係数は実機調整用の設定であり、精度保証ではない。

検出の合間は固定し、補正残差も次の観測まで保持する。SDKカメラへの補正や一致待ちは追加しない。通常JSON schema 21の各採用frameの`displayStabilization`に`markerDistanceMeters`、今回の`thresholds`、判定・差・残差・補正前後の行列を記録する。非採用frameはnull。

## 現在の視聴経路（2026-10-27）

ルーム入力 → 匿名 Viewer 資格取得 → 既存 HTTP join／Delivery／bootstrap → 明示カメラ開始 → Snapshot／素材準備 → State 接続と Ready → SDK NORMAL／タグ認識 → ライブ視聴。共有 Runtime v3 と WebSocket の Control／State を使い、登壇側の進行を適用する。

`connection/anonymous-client.ts` は API 資格、`connection/realtime-client.ts` は通信、`experience/viewing-session.ts` は XR／Runtime と入力世代を所有する。切断後は表示を解除して再接続し、新 Snapshot から復帰する。State 欠落は表示を保持して keyframe を再取得する。製品診断には資格・署名 URL・画素・プレゼン変数や進行 ID を含めない。

接続手順、origin／migration／配信設定、Ready・資格更新・復帰の条件は [接続境界](docs/connection-boundaries.md) を参照。公開環境と実機での総合受入は未実施。

## 期限更新

既存Delivery／bootstrapを期限前に再取得する。初回は最短期限の30秒前、短い寿命では残り時間の半分を目安にし、最低1秒間隔。失敗時は元の有効接続を維持し、1／2／4秒の最大3回再試行する。期限到達・取消・退出・破棄では失効を優先し、遅延応答を受理しない。

同じDelivery構造・assignmentの更新ではassetAccessだけを交換し、読み込み済み表示とカメラを維持する。新しいURLは以後の素材要求に使う。assignmentなどの変更時はカメラを維持しながらRuntimeを作り直し、新しいSnapshotを待つ。異なるpublication／profileの混在はHTTP接続制御で拒否する。API 資格も期限前に更新する。Runtime JWT の交換ではカメラを維持し、新 Snapshot と素材を再適用する。

production build は追跡済み `.env.production` により `https://api.un-fra.me` へ接続します。別環境ではビルド時に `VITE_AUDIENCE_API_ORIGIN` を指定します。開発時は `.env.example` を基にローカル設定を用意してください。

接続設定は `VITE_AUDIENCE_API_ORIGIN`（HTTPS origin）のみ。未設定なら参加不可として案内する。対応形式と資源予算は共有定義で管理し、profile IDはその内容のSHA-256から算出する。環境変数でprofileを選択しない。資格はメモリのみで、永続保存・リロード後の自動復帰は実装しない。

## 会場設定

製品視聴ではロードした設定のboard ID・revision・黒外周実寸・配置・presentationToVenueを保持し、size queryやサイズ編集で上書きしない。現在の配布元はローカル `/poc-config.json` の暫定設定。ルームごとの設定配布元・取得権限・revision更新時の扱いは外部担当と確定する。

検証用の `/?tracking=1` とfixtureでは従来のsize指定を使う。`showGuides`は箱・軸等の描画可否だけを表し、設定モードを推測しない。

## 描画・進行の対応範囲

- PNG: sRGB、透過、contain／cover／stretch、メートル配置、親子TRS、visibility／opacity、Surface合成とcrossfade。unique textureはSurfaceのcomposite shaderで最大8枚。
- 動画: opaque H.264 MP4、Runtime時計による再生／停止／seek／途中参加。再生許可が必要な場合は明示操作。追跡低下・非表示ではpauseする。
- GLB: 自己完結GLB、PBR／unlit、skin／morph、clip／crossfade／held。埋込PNG／JPEGとKHR_materials_unlitに対応。
- Runtime: Snapshot、Control／State、sequence・fence、Group／Step、変数、Timeline、Surface／media／modelの進行適用。Cue／Flowの進行判断をクライアントで再実行しない。
- 未対応: native-ui、Presenter anchor、Local Overlay、VP9／AV1／動画alpha、外部URIやDraco／Meshopt／KTX2等のGLB拡張。必須の未対応表現を黙って省略しない。

素材はHTTPS・CORS・credentials omit・no-storeで取得し、期限・MIME・encoded size・SHA-256・寸法等を検証する。PNG実寸はデコード前のIHDRとデコード後に照合する。PNG／モデル等の既知保持量とロード予算を検査するが、ブラウザの動画decoder内部やGPU driverの全確保量を保証する方式ではない。

## 開発用fixtureと受入

`/?fixture=1&size=36` は黒外周24cmのマーカーで開始する。メニューの「テスト内容」でPNG、PNG・動画・GLB、動画・GLB途中参加を選択。カメラ開始後、メニューの「次の操作」で進行し、「状態をJSON保存」で診断を取得する。固定テストデータのためサーバー接続済みとは扱わない。fixtureはDEV限定で、本番bundleにテスト素材を含めない。

製品側の接続制御はテストダブルで検証し、fixtureも同じ視聴セッションを通す。Chrome／SwiftShaderではPNG合成と動画・GLB通常／途中参加を確認済み。iPhone Safariのカメラ・動画・音声同時負荷、長時間メモリ、繰り返し入退場、公開環境での Realtime 同期は別途端末受入が必要。Galaxy ChromeのNORMAL待機は起動診断ログで調査中で、修正済みとは扱わない。実機測定なしにQuest／Unityの資源上限をAudience profileへ転用しない。

検証結果・過去の実装時点の制約は[実装履歴](docs/implementation-history.md)へ分離した。[契約適合](docs/contract-compatibility.md)と[外部接続境界](docs/connection-boundaries.md)も参照する。

## 複数端末テストの接続ログ

「テストログを保存」（MR）／「接続テストログを保存」（WebXR）から、接続・取得・送受信・同期の履歴をJSONで保存できます。保存先と端末間の比較手順は[複数端末の検証手順](../../../docs/validation/multi-device-session-diagnostics.md)を参照してください。認証情報・素材URL・カメラ画像は含みません。
