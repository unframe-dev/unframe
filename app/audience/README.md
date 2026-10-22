# Audience Web XR

会場の観客向けWeb XRクライアント。2026-10-22、ユーザーが現構成で十分な精度を確認し、位置保持PoCを完了とした。以降はこの追跡構成を基準としてWebアプリ開発へ進む。現在はAprilTag `tag36h11`の単一ID 0と8th Wall SDK／SLAMを使う位置保持PoCのみを実装している。ルーム参加・Backend・Quest同期は未接続。ログインなしでルームIDを入力する参加機能は後続開発。

## 採用した方式

1. 有効なタグ姿勢と同じ取得callbackのSDK姿勢を1ペア得たら、会場との対応を即更新する。一致待ち・平滑化・残差による採用保留は行わない。
2. 次の有効なタグ観測まではSDK座標内の物体を固定し、SDKカメラの移動・回転で表示を保持する。
3. タグ未検出・姿勢が曖昧・再投影誤差超過・SDK姿勢欠落では新位置を採用せず、前の有効位置を保持する。
4. SDK追跡がLIMITEDになった場合、hidden、停止では物体を非表示にし、対応を破棄する。NORMAL復帰だけで古い位置を再表示せず、新しい有効なタグ観測を待つ。

SDKはabsolute。NORMALが連続5秒続いた後に検出器を準備し、最大頻度で検出を開始する。準備中に追跡が低下すれば待ち直す。検出は単一Worker・同時1フレームで、完了後に新しい画像を取得し、待ち行列を作らない。

実機報告では黒外周150mmで約3.3m、240mmで約5.8mを認識した。距離別の小揺れ補正を含む現構成を、ユーザーがWebアプリ開発へ進む基準として承認した。当面は観客が立ち位置を固定する前提。これは外部真値による10cm精度や、7m初回認識・不可視5〜10分保持を定量実証した結果ではない。追加の追跡実験を開発開始の条件とはせず、必要な改善は製品要件に応じて別途扱う。

## 操作

サイトの `/` を開き、必要ならサイズを選び「カメラを開始」。検出器の選択はない。画面はSDK状態、生理由、タグ採用回数、最後のタグ更新からの経過時間、実効検出Hzを表示する。

黒い外周15cm・白余白込み22.5cmが既定。`/?size=22.5|36|50|60|70`で余白込み外寸cmを指定する。黒い境界は外寸の2/3。黒外周240mmの検証には`/?size=36`（余白込み360mm）を使う。サイズ選択は即反映し、変更時は前のアンカー・保存画像を消す。印刷ページは`/print-target.html?size=22.5`。画面表示・印刷後は実寸を測り、白余白を残す。

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

- `AnchorExperience.tsx`: 起動・権限・追跡ライフサイクル、単発採用、UIと診断保存。
- `tracking/adapter.ts`: SDKとWorkerの所有、固定absolute設定、画像取得の制御、状態・性能の記録。
- `fiducials/frame-source.ts`: SDKが報告するvideo全体を取得し、表示用4×4投影行列からcover変換を逆算して同じ画像のKを求める。
- `fiducials/detector.ts` / `worker.ts`: AprilTag 3のWASMで`tag36h11`を検出。`quad_decimate=1`・`refine_edges=1`。
- `fiducials/pose.ts` / `tag-localization.ts`: 画像だけから単一タグ姿勢を推定・判定。POSIT由来の反転初期値を含む最大4候補で探索し、曖昧姿勢と再投影誤差超過を除く。SDKをタグ推定の初期値に使わない。
- `rendering/live-tag-anchor.ts`: `sdkFromVenue = sdkFromCamera * inverse(tagVenueFromCamera)`を即反映。検出間は行列を維持し、SDKの通常描画ループで表示する。
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

追跡方式の再選定は終了し、現在の検出・確定・SDK保持・表示補正の境界を維持する。次の実装範囲と順序は[Webアプリ開発計画](../../docs/plans/audience-web-app-plan.md)を参照する。ルーム参加・プレゼン表示・ライブ同期は未実装のため、PoC完了と製品機能の完成を区別する。
