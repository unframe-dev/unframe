# 8th Wall Distributed Engine Binaryの導入・配信要件

> 2026-10-22更新：位置保持PoCは現構成でユーザー承認を得て完了した。以下の配布条件調査・比較方式の記載はPoC時点の記録であり、現行方式は[採用記録](../experiments/audience-apriltag-adopted.md)と[Audience README](../../app/audience/README.md)を参照する。SDKの固定版・配布物とライセンス保持の実装は継続して利用する。

- 調査日: 2026-10-20
- 対象: SLAMを含むDistributed Engine Binary。MIT版エンジンとは区別する。
- 状態: 公式資料とローカル配信の完全性確認に加え、iPhone Safariの実機ログでSLAM・Image Targetsの起動を観測した。複数ホスト・全ネットワーク要求・Android等の網羅検証は未完了。専用マーカー検出器の配布物を導入した。新方式の実機起動・精度は未確認。
- 前提: Unframeは無償。以下の配信・表記条件は、商用か無償かによらず確認する。

## 1. 根拠と確認範囲

「公式記載」「ブラウザ側の条件」「Unframeで採る方針」「実測待ち」を区別する。公式の一般的な導入例から、特定バージョンの全ネットワーク動作を保証しない。採用時に正確なバージョン、取得元、配布物のハッシュ、同梱LICENSEを記録する。

| 項目                       | 調査結果                                                       | 導入時の扱い                                               |
| -------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| 自前ホスト                 | 公式に対応。npmのdist一式をexternal/xrへコピーする例がある     | 同一origin配信を初期方針にする                             |
| App Key・ドメイン登録      | 現行の導入例に設定手順なし。旧ホスト型loaderは置換対象         | 登録不要と推定するが、採用バージョンの起動確認は未完了     |
| CORS                       | ブラウザのorigin間アクセス制約。バイナリライセンスの条件とは別 | SDK一式を同一originへ配置し、別originの素材/APIは個別設定  |
| 著作権・ライセンス         | 保持と利用者からのアクセスが必要                               | 配布物を改変せず、同梱LICENSEと著作権表示を公開する        |
| 常時ロゴ・起動スプラッシュ | 現行のWeb向け表記案内に必須との記載を確認できない              | 常時ロゴは要件にしない。第三者ライセンス画面を用意する方針 |
| CSP / COOP / COEP          | 全利用形態に対する8th Wall固有の一律必須設定を確認できない     | 使用する機能・実行時の要求に基づいて確定する               |

根拠: [公式導入手順](https://8thwall.org/docs/engine/overview)、[旧loaderの移行手順](https://8thwall.org/docs/migration/self-hosted)、[公式表記ガイド](https://8thwall.org/docs/open-source)。登録不要との評価は公式例からの推定であり、「ドメイン制限なし」の明文保証ではない。

## 2. 初期の配信方式

アプリHTMLとSDK一式を同じscheme・host・portから配信する。別サブドメインは同一originではない。インフラでCDNを使っていても、ブラウザから同じoriginに見える構成なら同一origin配信として扱える。

SDKは正確なバージョンを固定し、公式配布物の内部ディレクトリ構造とファイル内容を保持して静的コピーする。xr.jsだけをコピーしない。JSの再バンドル、minify、ファイル名の変更、ライセンスコメントの除去は行わない。圧縮転送する場合も、復号後のバイト列が元の配布物と一致するようにする。

```html
<script src="./external/xr/xr.js" async data-preload-chunks="slam"></script>
```

この例は配置構造を示す。実際のアプリのbase URLに対して解決先を確認する。起動はSDKとslam chunkのロード完了後に行う。現在はImage Targetデータを使わず、専用検出器をWorkerで実行する。AprilTag画像をImage Targetsへ登録する方式ではない。旧apps.8thwall.comのApp Key付きloaderは併用しない。

`.wasm`を配信する場合は `Content-Type: application/wasm`、JSには適切なJavaScript MIMEを設定する。不明なファイル要求にSPAのindex.htmlを200で返さない。キャッシュはバージョン間で混在させず、更新時はSDK一式を同時に切り替える。

根拠: [Binary README](https://github.com/8thwall/engine/blob/main/README.md)、[WebAssemblyのMIME要件](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/instantiateStreaming_static)。

## 3. CORSとドメインの条件

SDK一式が同一originで、別originへのリダイレクトもない場合、SDK配信用のAccess-Control-Allow-Originは通常不要。ただしCSP、認証redirect、MIME、workerの制約は別途満たす必要がある。

別originのCDNから配信する場合、公式例はscriptに `crossorigin="anonymous"` を指定する。配信側が対応するAccess-Control-Allow-Originを返す必要があり、xr.jsの成功だけでは完了としない。追加JS、WASM、worker、画像等の実際の要求と解決先を確認する。WorkerにはCORS以外の起点origin制約もあるため、CORSヘッダーだけで動くとは判断しない。

公開・認証不要の静的素材をcross-origin配信するときの選択肢は、`Access-Control-Allow-Origin: *`、または許可する正確なoriginである。複数の許可originを判定して値を変える場合は、許可リストで検証し `Vary: Origin` を設定する。任意のOriginを無条件に反射しない。

Cookie等のcredentials付きcross-origin要求では `*` は使用できず、正確なoriginと `Access-Control-Allow-Credentials: true` が必要になる。preflightが発生するAPI要求はOPTIONS・必要メソッド・ヘッダーも許可する。SDKの静的配信にCookie認証を要求しない方針とする。

Image Target画像、PNG/GLB等の配信元とControl Plane APIは、SDKの配信設定とは別に確認する。署名付きURLにもCORS条件は適用される。CORSを認証・アクセス制御の代替にしない。WebSocketは通常のfetch CORSとは別に、サーバーでOriginと接続資格を検証する。

根拠: [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)、[Workerの読み込み条件](https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker)。

## 4. 著作権・ライセンス表示

LICENSE §1.1は原形での利用・配布を定め、§1.3は権利表記、作成者、契約と保証免責への参照を要求する。無償利用でも適用される。MITライセンスへ置き換えない。公式が要求するバイナリ自体の表記を保持する。

Web向けの公式ガイドは、未改変の配布物内に著作権表示とライセンスがあり、開発者ツール等から閲覧できる形を案内している。HTMLソース内の表記も案内されており、常時ロゴや起動時のダイアログを一般必須要件とはしていない。一方、ファイルを閲覧できないnative/desktopパッケージ版には、体験内のAboutやCredits等への表示を求めている。

Unframeでは、同梱LICENSE全文と元の著作権表示を実際の配信成果物に残す。そのうえで第三者ライセンス画面から閲覧できるようにし、作成者Niantic Spatial、著作権、エンジン契約、同契約の保証免責への参照を載せる。第三者ライセンス画面はUnframeの実装方針であり、Webで画面表示が一律必須という意味ではない。公式との提携・承認を示唆する表現は使わない。

Unframeが無償であることだけから、あらゆる利用制限が消えるとは扱わない。特に競合製品に関する条項は料金条件とは別に存在する。これはCORSやロゴ表示とは別の利用範囲の判断であり、SDKを一要素として用いる今回の用途と、採用時点の契約を照合する。

根拠: [LICENSE §1.1–1.3](https://github.com/8thwall/engine/blob/main/LICENSE)、[公式表記ガイド](https://8thwall.org/docs/open-source)。同梱版がこの参照先と異なる場合は差分を確認する。

## 5. CSP・隔離・権限

CSPのscript-src/default-srcがWebAssemblyコンパイルを制限する場合、`'wasm-unsafe-eval'` 等の許可が必要になる。SDKにJavaScript evalが必要とは未確認であり、`'unsafe-eval'` を最初から追加しない。worker-srcのblob:等も実際に必要な場合だけ許可する。script-src、connect-src、worker-src、img-src等をReport-Onlyで観測し、本番ポリシーを決める。Report-Onlyで動いたことを強制適用時の合格としない。

COOP/COEPは8th Wall利用だけを理由に一律有効化しない。SharedArrayBuffer等のcross-origin isolationを要求する機能が実際に必要か確認する。有効化する場合はcross-origin素材のCORS/CORP条件やログイン導線への影響も検証する。

実機アクセスは信頼されたHTTPSを使う。開発PCのlocalhost例外をスマートフォンからのLAN IPアクセスに適用しない。iframe埋め込みは初期構成に含めず、導入する場合はPermissions Policyと埋め込み元の権限委譲を別途確認する。

根拠: [CSPとWASM](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src)、[COEP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy)、[カメラ権限](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)、[8th Wallのブラウザ要件](https://8thwall.org/docs/troubleshooting/browser-requirements)。

## 6. 実機検証の開始条件と記録

実機検証では次を未完了項目として管理する。公式資料の確認済み状態と、以下の起動試験の合格を混同しない。

- [x] 採用する配布物のバージョン・取得元・ハッシュ・LICENSEを記録した（npmの `@8thwall/engine-binary@1.0.0`、pnpm lockfileと生成するファイル別SHA-256一覧）。
- [x] ビルド成果物のSDKファイル群が配布物と一致し、著作権表示・LICENSEをHTTPで閲覧できる（ローカル開発サーバーと本番previewで全13ファイルを検証）。
- [x] 一時的な検証用HTTPSホストで、App KeyなしのSDK・slam chunk・Image Target起動をiPhone 13 / Safariのログで確認した。他端末・他ホスト・ネットワーク全要求の検証とは区別する。
- [ ] 別のHTTPSホストでも同じ成果物を起動し、ドメイン登録に依存しないことを確認した。
- [ ] コールドキャッシュで全要求のURL・status・MIME・CORSを確認し、追加ファイルの欠落とSPA fallbackがない。
- [ ] 同一origin構成では、旧8th Wall loaderや意図しない外部originへの実行時依存がないことをNetworkで確認した。通信ログは機密値を除いて記録する。
- [ ] CSP強制適用下で起動でき、必要なWASM・worker・画像の要求が許可される。
- [ ] 別originの素材/APIを利用する場合、実際の読み込みと必要なpreflightが通る。curlでのHTTP成功だけでCORS合格にしない。
- [ ] iOS Safari・Android Chromeで権限許可、SLAM、画像認識、再読込を確認した。

この確認ではバイナリの逆解析や改変を行わない。公開ドキュメント、配布ファイルの完全性、HTTP応答、ブラウザでの起動結果で検証する。採用バージョンとローカル配信の完全性は確認したが、本番配信環境の網羅検証は未完了である。iPhone Safariから一時HTTPSホストでSLAMとImage Targetsが動作したログは得られたが、これを上記の全項目の合格とはしない。未チェックの項目を実証済みとは報告しない。

## 7. 専用マーカー検出器の配布境界（PoC実装済み）

[設計方針](./audience-web-xr-plan.md)に従い、AprilTag 3とArUcoの専用検出器を比較する。8th Wall BinaryはSLAM・カメラ・描画ループの担当として維持する。専用検出器のコード・WASM・Worker・マーカーファミリーは別の配布物として扱い、8th Wallの契約だけで利用条件が満たされるとは判断しない。

- 採用実装・版・取得元・ライセンス・著作権表示・ハッシュと、ビルド方法／再現性を記録する。ブラウザ移植版を使う場合は、元の検出器と移植版の双方の条件・保守状況を確認する。
- 検出器の静的配布物も同一originを基本とし、WASMのMIME、Workerの起点、CSP、キャッシュの版混在を検証する。カメラ画像を外部サービスへ送らず端末内で処理する方針とする。
- マルチスレッドWASM等を採用する場合だけ、SharedArrayBuffer・COOP／COEPの必要性と既存配信への影響を評価する。AprilTag／ArUcoの採用を理由に隔離ヘッダーを一律追加しない。
- 8th Wallのカメラ映像を公開APIで共有できることを確認し、別のカメラ取得やSDK内部の逆解析で補わない。映像・SLAM姿勢の同期、内部パラメータの対応、iPhone SafariでのWorker・メモリ・FPS・発熱を測定する。
- 固定ボードのID、ファミリー／辞書、実寸の測定境界、会場配置バージョンを別途管理する。画像データの配布成功を、マーカー検出と尺度成立の実証にしない。

### 現在の取得・準備方式

- AprilTagは[arenaxr/apriltag-js-standalone](https://github.com/arenaxr/apriltag-js-standalone)のcommit `f0fe55676265a1251ad36f18bac9939206a59e19` の配布JS／WASMをvendorへ固定した。元AprilTagのcommitは `4cdba6a8c6cf4efeb032fa5542da927d4677c035`。取得元とファイル別SHA-256は `app/audience/vendor/apriltag/provenance.json` に保持する。
- `prepare-detectors.mjs` はvendorのSHA-256を検証し、JS／WASM・wrapperのBSD-3・元AprilTagのBSD-2を `public/external/detectors/` に配置する。UMD wrapperへES module exportを追加した別ファイルを生成する。この加工は第三者オープンソース検出器のライセンス下で行い、未改変配布が必要な8th Wall Binaryには行わない。
- ArUcoは `js-aruco2@2.0.0` をpnpmで固定する。ブラウザWorker向けに必要なモジュールを生成し、MITライセンスと辞書内のBSD等の権利表記を保持・配信する。`DICT_4X4_50` と `tag36h11` の検証ボードを使う。
- UIの「検証情報とライセンス」から各LICENSE・辞書の権利表記・provenanceを参照できる。同一originでWASMをfetchし、Workerを起動する。マルチスレッドWASMやSharedArrayBufferは使用しないため、そのためのCOOP／COEPは追加しない。
- カメラと描画ループは8th Wallが所有する。公開 `reality.realityTexture`・姿勢・投影行列を同じ応答から取得し、公開 `GlTextureRenderer.create` で表示背景と同じcropの画素へ変換する。CameraPixelArrayと最新の生カメラtextureの同期を仮定せず、別のカメラ取得も追加しない。根拠は[公開追跡adapter](https://github.com/8thwall/8thwall/blob/main/reality/app/xr/js/src/tracking-controller.ts)、[公開レンダラー](https://github.com/8thwall/8thwall/blob/main/reality/app/xr/js/src/gl-renderer.ts)、[公開Three.js adapter](https://github.com/8thwall/8thwall/blob/main/reality/app/xr/js/src/threejs-renderer.ts)。公開mainと採用Binaryの完全な一致を保証するものではなく、実機での方向・対応精度を検証する。

専用検出器のコード導入と配布準備は実装済みである。一時HTTPSホストのブラウザで、SDK公開GPU処理からWorker内の両検出器・共通姿勢推定までを合成4条件で確認した。主要ページ・WASM・ボード・ライセンスのHTTP配信と、SDK全13ファイル・AprilTag配布物のSHA-256一致も確認した。iPhone Safariでの性能・精度・全ネットワーク要求・CSP強制適用は未確認である。旧Image Targetsの起動実績を新方式の合格へ流用しない。
