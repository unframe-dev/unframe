# Local Editor: Unity Preview の実装契約

[ADR-0025](../decisions/0025-local-editor-unity-preview.md) に基づく Source 編集、Dev／Dist generation、Unity Preview、表示済み Dist の公開経路の実装契約。想定読者は CLI、Core、Web、Unity の実装担当者。実ブラウザー・native Unity・実サービスの E2E は別途検証し、その成功を本書だけから判断しない。

保存済み Step・Cue・アニメーションの閲覧とシークは [Cue 時間軸仕様](./LOCAL_EDITOR_TIMELINE_SPEC.md) を参照。

## 1. 目標と初期範囲

保存済みのローカル project を Dev Preview で確認し、明示 build で生成した同じ `dist` を Dist Preview・Control Plane 公開・本番読み込みに使用する。

Preview は Structured／Opaque Source から生成した canonical baked-web／native-ui Surface、Stage／container／Presenter anchor 配下の配置、Step／Cue／Timeline、Surface の遷移、カメラの視点操作を扱う。表示の初期値とローカル進行は Core の既存規則から導出する。公開後の本番読み込み E2E は native Unity Editor で実 Realtime Snapshot を受け取る。WebGL の本番 Realtime 接続、Quest 実機は別の検証対象とする。Model と video は対応する residency plan で読み込み、Native UI は共通レンダラーで表示し、Gesture・外部イベント・Surface 操作と仮想 Presenter の姿勢を入力できる。Zone は仮想 Presenter によるローカル判定を扱う。

Web UI は Local Host の project 読み込み、公開 Props の保存、診断表示を扱う。Inspector 編集は対応する React scene に限る。編集用 metadata を得られない Source も Compiler の検証を通れば build・表示でき、UI は閲覧と診断を提供する。その他の Source は外部 editor で保存して Dev Preview に反映する。Unity 上の選択・Gizmo・Component 配置は拡張目標であり、初期の完了条件に含めない。

## 2. 所有権とデータ経路

```text
Authoring Source + assets + config + installed dependencies
               │ snapshot / validate / compile
               ▼
Definition + RenderBundle + AssetSet + BuildManifest + assets
        ├─ dev channel → Local Preview Adapter ─┐
        ├─ dist       → Local Preview Adapter ─┤
        └─ publish → Control Plane → Delivery ─┤
                    割り当て済み Realtime     │
                         → ConnectionSnapshot ┤
                                              ▼
                              共通 Unity Runtime 入力・描画
                                  ├─ Web Preview shell
                                  ├─ native Unity Editor shell
                                  └─ Quest shell
```

| 所有先                   | 責務                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/`    | canonical artifact・描画に再利用する生成 message の正本。必要な Preview の cross-application schema もここに定義する |
| `packages/unframe/core/` | build 検証、publication 非依存の role／capability 選択、Runtime catalog・初期表示状態の導出                          |
| `packages/unframe/cli/`  | project filesystem、保存、出力 channel、generation 固定、Local Author HTTP API                                       |
| `app/web/local-editor/`  | Dev／Dist 選択、保存・build・表示 revision の提示、Unity instance と要求の lifecycle                                 |
| `app/unity/`             | Preview／Delivery 入力 Adapter、共通 hierarchy・描画・素材管理、WebGL／Quest platform Adapter                        |
| Control Plane            | upload された build の公開整合性、認可、Delivery projection。Source や Dev generation は受け取らない                 |

`PresentationRuntimeDataStore` は Delivery／Snapshot の検証を所有する。描画参照は `IPresentationRenderView` を介し、Preview／Delivery Adapter が共通 hierarchy・renderer・`PresentationPlaybackPlayer` を使う。ノード状態反映、Timeline の同期・補間、Surface 遷移の評価、再生時計のサンプリングを共通化し、通信・素材取得・Quest 校正・Preview の表示交換は各 Adapter が所有する。本番 Adapter の fence 検証は維持する。

### Local Editor と管理 Web

`app/web/local-editor/src/app/main.tsx` が Host の接続 API から token を取得し、workspace を生成する。`workspace/create-workspace.ts` が project／preview／publication controller と workspace 単位の Zustand vanilla store を組み立て、commands が feature 間の操作を接続する。React は selector 購読と入力・focus を所有し、HTTP／build・認証 polling／Unity 配送は controller と `infra/` の adapter が所有する。Unity canvas は固定 viewport に一つだけ接続し、テーマやパネル操作では作り直さない。`dispose` で通信・timer・通知待ち・Unity を終了する。

UI HMR ではメモリー上の session に token・Workspace・React root を保持し、同じ Host の接続、選択、パネル配置、未保存 Props と入力途中の文字列を再利用する。Unity canvas は Workspace ごとに保持し、view の再接続でも作り直さない。React effect の再実行では Workspace を破棄せず、Host の切替・ページ終了時に破棄する。controller の実装変更は再起動で適用する。

公開 Props の draft は project controller が管理する。保存は直列で、保存完了後に履歴を確定する。結果不明の保存は同一 command ID・基準 revision・command で再送する。外部変更で draft を消さず、競合時には自動上書きしない。Transform の編集 UI は提供しない。`index.html` から `dist` を生成し、Local Host が同一 origin で配信する。旧 Author entry、Slide／Element 文書、localStorage 文書保存、React 3D viewport は編集経路から撤去した。

対象は CLI 起動時に指定した project であり、ブラウザーから任意 filesystem path を開く API はない。管理 Web は認証・device 承認・account settings、公開済み Dist の確認とルーム作成を担当する。ローカル Editor の起動・保存・Preview はログインなしで利用する。

認証・device 承認・account settings は CP が信頼する設定済み `WEB_ORIGIN` で配信する。Local Host は設定済み CP と client ID に対して既存 device authorization を開始・poll し、公開用 bearer credential を取得する。Editor は同一 origin の Host API で認証状態と承認用 `user_code`・URLを扱い、CP へ cookie 付きで直接接続しない。CP credential と `device_code` は Host のメモリーだけに保持し、Web UI・localStorage・project・ログへ渡さない。Host 終了・認証期限切れ時は再認証する。CP の verification URI と承認画面の router path を揃え、Google login など承認画面の認証も信頼済み origin 内で完結させる。

Local Host は既存の origin／token 検査と `connect-src 'self'` を維持する。Editor は verification URL を別タブで開き、Editor の同じ project・表示済み Dist を保持したまま Host API から認証状態を取得する。承認後の credential は Host の poll で取得し、Editor への cookie／credential redirect は行わない。認証完了後も実際の publish 受付で Dist を再照合し、認証中の成果物変更を取り込まない。認証の取消・失敗・期限切れはローカル編集・保存・Preview を妨げない。

旧文書から Source への自動移行・互換保存は初期範囲に含めない。Editor のテストは Source 保存、外部変更、ログインなし Preview、保存／build／load 失敗、公開時認証を扱う。Control Plane の現行 CRUD schemaVersion と退役済み Presentation wire contract は区別し、Web 統合だけを理由に server／device API を削除しない。

Presentation ID は初回 build 前にローカルで生成し、Authoring Source の presentation identity として永続化する。公開時の認証後、Local Host が同じ ID を CP に登録する。CP は ID の形式・一意性と所有権を検証し、既存 ID は公開権限がある場合だけ利用できる。衝突・権限不足では拒否し、ID の暗黙変更や確認済み Dist の書き換えは行わない。

登録 API はローカル ID と登録用 metadata を受け、旧 Definition を必須にしない。登録・認証情報は成果物に混ぜず、CP へ Authoring Source を送る保存経路も追加しない。

## 3. 成果物と Preview 入力の契約

### 出力 channel

| 項目            | Dev                                             | Dist                                 |
| --------------- | ----------------------------------------------- | ------------------------------------ |
| 完成 generation | `.unframe/preview/generations/<id>`             | `.unframe/generations/<id>`          |
| current pointer | `.unframe/preview/current` → `generations/<id>` | `dist` → `.unframe/generations/<id>` |
| 更新契機        | 保存済み入力の自動 build                        | 明示的な本番 build                   |
| 公開対象        | ローカル Preview                                | Dist Preview と publish              |

channel は固定 enum とし、任意の output path は受け付けない。両 channel は同じ immutable artifact set を生成する。generation ID は格納先の identity、BuildManifest の build identity は内容の identity として区別する。staging、revision 再検査、managed symlink の atomic replacement は ADR-0013 に従う。

Dist Preview は load 開始時に generation を固定する。publish は、正常表示中の Dist Preview の build identity／artifact hashes と現在の `dist` が一致する場合だけ開始する。Dev 表示中・Dist 未表示・不一致の場合は Dist Preview の読み込みを要求し、upload を開始しない。照合と generation の固定を一つの受付処理で行い、以降の `dist` 更新で upload 元を切り替えない。hash の照合対象は canonical artifact と参照素材の bytes。publish 完了は、固定した成果物と公開結果の一致で確認する。過去 generation を選んで公開する UI は初期範囲に含めない。

publish は固定 Dist の完全性を検証し、現在の Source を読み直して build したり、最新ローカル revision との一致を要求したりしない。A を build・表示した後に Source を B へ保存しても、現在の `dist` が A のままなら A を公開できる。公開先の競合は、公開要求に固定した期待 PublicationFence（初回は未公開）と CP の現在値を原子的に照合して検出する。別の publish が先行した場合は競合として返し、期待値を自動更新して再送しない。認可・Asset readiness・active-use lock は維持する。CP の Draft revision とローカル Source revision の一致を公開条件にする旧方針は置き換える。

### Core の共通描画選択

`verifyBuildIntegrity` 済みの BuildArtifacts と role／CapabilityProfile を受ける publication 非依存の処理で、selection・Runtime catalog を構築する。出力は visible IDs、選択済み Render Surface／State／artifact、Runtime catalog、asset closure／residency。既存の renderer 選択・参照検証を共有する。Local Preview 専用の入口ではメモリ予算による admission を適用せず、本番配信の入口では引き続き適用する。

Delivery は従来どおり `verifyPublicationIntegrity` を通し、共通結果に PublicationFence、profile identity、projection instance、asset access を付加する。Local Preview は build identity を使い、publication／session／assignment を付加しない。

Delivery は描画 catalog・素材・fence を提供し、本番の Node／Surface の現在状態は割り当て済み Runtime Core の `ConnectionSnapshot` から取得する。本番 Adapter は Session／Publication／profile／assignment fence と Snapshot の sequence を検証してから共通 renderer に状態を渡す。復旧・進行済み Snapshot を Definition の宣言初期値へ戻さない。

描画の role は viewer、capability は Web Preview の実装済み機能を表す固定 profile とする。初期 Group と Surface State は Definition の宣言値を使い、Node の active／visible／opacity／local Transform を Core の初期化規則に従って生成する。読み込み直後は一時停止し、再生操作まで時計・timer・Timeline の自動進行を停止する。catalog に含まれても現在の表示状態に存在しない Group-owned ノードは inactive とする。

### ローカル再生

Local Host は commit 済み request ごとに Core の Cue state と単調時計を持つ。`/api/editor-events` WebSocket の `playback` 操作は `requestId` と `command`（`poll`／`play`／`pause`／`reset`／`input`／`movePresenter`／`gesture`／`semanticEvent`／`surfaceInteraction`／`selectStep` と下記の確認・復旧 command）を受け、`input` のみ現在実行可能な `cueId` を指定する。`gesture` は種類、`semanticEvent` はイベント名と actor、`surfaceInteraction` は Surface／interaction ID を受ける。`selectStep` は存在する Group／Step を指定し、新しい run の初期状態で一時停止する。過去の実行結果は引き継がず、任意の状態・時刻は受け付けない。入力候補と guard・競合・完了・timer の評価は Core に委譲する。接続時に Host／Origin を検証し、最初の JSON メッセージの `token` で Editor session を認証する。古い request と実行不能な入力は `409` のエラー応答で拒否する。

応答は `LocalPreviewPlaybackState`（request、sequence、現在の Group、Node／Surface 状態、ActiveRuns、RuntimeClock）と現在の Group／Step・入力候補・終了状態を返す。Host は再生中だけ約100ms間隔で状態を配信し、Web が Unity の `Playback` acknowledgement を受けて `applied` を送るまで次の配信を待つ。一時停止中とビルド待機中は定期配信しない。初回同期、操作、状態配信、反映確認と表示 commit／無効化は同じ WebSocket 接続を使う。切断時は最後の反映確認済み状態へ復元し、一時停止して再同期する。Unity は catalog と sequence を検証して状態を適用し、共通プレイヤーを毎 frame 更新する。reset は時刻をゼロに戻し、run の識別子を更新するが sequence は戻さない。新しい load・invalidate・終了で再生要求を無効化し、古い応答を破棄する。再生状態は Source や Dist へ保存しない。

### Zone の確認

`movePresenter` は Unity の float 座標で表現できる有限値の腰位置 `[x,y,z]`（Presentation 座標）と任意の単位 quaternion `[x,y,z,w]` を受け、Host が有効な Zone の進入・退出を既存の Cue 実行器へ渡す。判定は各軸で中心から±1m、一度内側に入った後は±1.03mを超えて退出する。初回・再開・Step／Group 切替時は現在位置を記録するだけで進入を作らない。停止中・確認中・遷移中・終了後は発火しない。reset／selectStep は位置を原点・向きを初期値へ戻し、recover は適用確認済みの位置と所属状態を復元する。

応答の `spatial` は Zone の有無によらず腰位置・向きと各 Zone の中心・有効状態・内外状態を返す。Web は再生状態の適用後に `Spatial`（`{requestId, sequence, presenterPosition, presenterRotation, zones}`）を Unity に送り、同じ識別子の ACK を待ってから Host へ適用を確認する。視点切替は `View(perspective|overhead)`、俯瞰からの位置入力は requestId 付きの `unframe-preview-presenter` 通知で伝える。Surface の ray 判定結果は `unframe-preview-interaction`（requestId、surfaceId、interactionId）で Web へ伝え、通常再生中に Host へ送る。古い request の位置・Surface 入力は破棄する。

Unity は通常・俯瞰の両視点でグリッド床と原点のリング・X/Z 軸の十字を表示し、俯瞰では共通原点の tag36h11 ID 0、Zone 枠と Presenter も表示する。タグは位置を確認する表示用ガイドであり、実機の画像認識・校正には接続しない。通常視点へ戻ると以前のカメラ位置を復元する。`ResetCamera("")` は通常視点へ切り替え、カメラを Presentation 座標 `[0, 1.6, 4]` に置き、`z=0` の表示面を正面から見る。Presenter anchor の Body は腰、Head は腰から上方0.65m、LeftHand／RightHand は左右0.35m・上方0.25m・前方0.25mの仮想姿勢とし、腰の向きに合わせて回転させる。実際の頭・手のトラッキングは行わない。これらの確認操作は Source・Dist を変更しない。

### Cue 確認と適用確認

Core の `executeCueEvent`／`advanceCueClock` は `{ capture: true }` の明示指定時だけ accepted Cue の actions 適用後・遷移前の checkpoint を返す。Host は request と Group／Step entry に結び付け、同じ Cue の最新 occurrence を保持する。候補評価・guard 拒否は記録しない。

| command             | 入力と意味                                                                  |
| ------------------- | --------------------------------------------------------------------------- |
| `inspectCue`        | occurrence ID と確認 ID。通常再生を退避し、発火直後の状態へ入る             |
| `seekCue`           | 確認 ID と有限の安全な非負整数 `timeMilliseconds`。duration 以下の絶対時刻  |
| `leaveInspection`   | 確認 ID。退避した通常位置へ一時停止で戻る                                   |
| `applied`           | request と sequence。Unity の適用成功後に Host の正常表示 checkpoint を確定 |
| `recover`           | 故障 sequence。最後の正常 checkpoint を新 sequence・一時停止で返す          |
| `invalidateDisplay` | request の表示・再生・確認記録を失効する                                    |

応答は `mode`、`inspection`、最新 `occurrences` と完全 playback state を含む。確認中の play／poll は確認範囲だけを進め、timer／completion による後続進行を行わない。reset／selectStep／load／invalidate は記録を失効する。重複開始・終了は同じ session を再実行せず、終了済み ID や置換済み occurrence は409で拒否する。不正時刻は400で、範囲を暗黙 clamp しない。

ブラウザーは HTTP と Unity の acknowledgement を直列に待ち、適用成功後だけ `applied` を送る。`prepared`／`committed` は build identity、`playback`／`restored` は request・sequence を照合する。`failed` の `outcome`（入力拒否 `rejected`／適用故障 `failed`）と `phase`（apply／update／restore）を区別する。入力拒否だけでは正常 scene の復旧を開始しない。部分適用・後続 frame 故障・通知 timeout は操作と公開を止め、`recover` → Unity `Restore` → `restored` → Host `applied` の順に復旧する。復元失敗は receipt と request を失効し、明示再読込で新 request を作る。初期適用未確認・復旧中・復旧失敗の receipt は公開に使えない。

### Local Preview Adapter

Local Author Host は固定 generation の4つの artifact JSONを `verifyBuildIntegrity` で検証する。選択した asset closure の bytes は AssetSet の mediaType・encodedSizeBytes・checksum と照合する。

Preview の cross-application envelope は次の field を持つ。canonical schema と publication 非依存の nested message を再利用し、Preview 独自の Node・Surface・artifact 定義を複製しない。fence を持つ Delivery／Snapshot envelope は流用しない。

| field                        | 契約                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `schemaVersion`              | Local Preview envelope の version。canonical artifact の version と区別する                       |
| `requestId`                  | Web UI が各 load に発行する一意 ID。Bridge の結果・commit・discard は同じ ID を使う               |
| `sourceRevision`             | 取得済み build 入力の revision。Dist Preview は `null`                                            |
| `buildManifest` / `assetSet` | 固定 generation の検証済み canonical artifact                                                     |
| `projection`                 | 共通描画選択結果。publication key／profile identity を含めない                                    |
| `initialState`               | Core が導出した初期 Node／Surface／Variable 状態。Session／assignment／replay の field を含めない |
| `assets`                     | 選択 closure の Asset ID と opaque reference の対応。path や任意 URL は含めない                   |

Host のローカル HTTP API は CLI の Author contract が所有し、envelope の schema と C# consumer は同じ正本から生成・drift 検査する。正本は `packages/contracts/proto/unframe/preview/preview.proto`。canonical JSON は文字列として保持し、projection／initial state は既存 Proto message を再利用する。Dist の `source_revision` は optional field の absence で表す。TypeScript wire descriptor／static binding／型は Contracts の `generate:wire-*` scripts、C# と Unity の Proto コピーは `nix run .#unity-proto` で生成する。対応する `check:wire-*` と `nix run .#unity-proto -- check` で drift を検査する。

素材取得は、認証済み Local Author API と WebGL Asset Adapter を介す。reference は固定 generation の検証済み catalog だけを指し、任意の filesystem path／外部 URL を受け付けない。Asset Adapter が bytes を共通 Unity renderer へ渡し、renderer は HTTP、Bearer token、Source を知らない。全 PNG を一つの Base64 JSON に載せる方式は採用しない。

Host の Preview 素材は最大4件を並列取得・検証し、検証済み bytes を descriptor 単位の LRU に最大64 MiB保持する。上限を超える素材は保持せず、cache miss は固定 generation から再取得・検証する。load 開始時と公開受付時は cache による検証省略を行わない。公開用の固定 snapshot は全素材を再検証して別に保持し、合計 encoded bytes の256 MiB上限を適用する。

Unity は decoded dimensions と texture metadata の一致も検証する。local TRS、physical size、fit、partition bounds、UV、alpha／sRGB は [ADR-0010](../decisions/0010-spatial-surface-coordinate-contract.md) と [ADR-0012](../decisions/0012-texture-budget-residency-contract.md) に従う。Preview 固有の座標変換・shader 意味論を設けない。

## 4. 更新と失敗時の挙動

### Dev の入力生成

Dev は導入済み `node_modules` と保存済み Source・素材を検証し、同一 Host 内で revision が一致する場合は取得済み graph と成功した解析の準備済み入力を再利用する。revision の照合では依存の内容・symlink・実行権限も検証する。依存の導入・更新はプロジェクトのパッケージマネージャーが所有する。workspace・symlink・peer dependency を含む取得済み graph と local files を revision に含め、公開前に再検証する。Compiler と隔離 worker は取得済み入力を使う。永続 lock の更新は行わず、publish は生成済み Dist を検証する。

### 表示の更新

- Host は project 内の入力ファイルを監視し、認証付き `GET /api/project/changes` で変更を通知する。UI は通知後に snapshot を取得し、無変更時は取得を繰り返さない。cursor の差分で取得中・再接続中の変更を拾い、取得失敗時は cursor を進めず再試行する。生成物を除外し、導入済み依存の実体とインストール先の差替えも監視する。監視自体が故障した場合は Host を再起動する。閲覧専用 Dist は成果物の更新を監視する。
- UI は `savedRevision`、`buildingRevision`、`loadedBuildIdentity` を区別し、保存済み内容と現在の表示が異なるときに明示する。
- 初回 Dev 選択と手動再読込は即時に build を要求する。保存成功・外部変更による自動更新は200msでまとめ、最新 revision を要求する。同じ revision の進行中要求は共有し、未保存の editor buffer は入力にしない。
- Host は要求の Source revision を検証してから旧 Dev 処理を取り消し、その後始末を待って最新の準備・build を開始する。Dist build はこの自動置換の対象にしない。UI は受付待ちの旧要求も結果を回収して取り消す。旧要求の build／asset load／Unity load が完了しても、現在選択している mode と要求に一致しなければ表示へ反映しない。
- 同じ入力で直近に成功した Dev generation が保持されている場合は、重い準備処理の前に再利用を判定する。全入力 revision、現在の generation、成功時の成果物 identity、全アセットの内容を照合し、前後の Source と参照先が変わっていない場合だけ再利用する。失敗・取消・削除・改変済みの成果物は再利用しない。
- 更新中は直前に commit した画面を残し、小さく「更新待ち」「ビルド中」「表示反映中」を示す。操作・公開可能な表示記録とは分離し、更新開始時に旧記録を失効させる。全面の準備表示は初回だけとし、更新失敗時も旧画面を残して診断と再試行を提示する。
- build 成功時に完成 Dev generation を公開する。Unity 表示の成功は別に管理する。候補 scene と素材を準備し、最新要求であることを確かめてから表示を交換する。
- Bridge は `prepare(requestId)` の成功通知後に Web UI が mode／最新要求を照合し、`commit(requestId)` または `discard(requestId)` を送る。Unity は現在の要求に一致する候補だけを commit する。mode 切り替え時は要求を無効化し、古い load 成功だけで scene を交換しない。
- Unity は scene の交換完了後に `committed(requestId, buildIdentity)` を返す。Web UI は現在の mode／要求と一致する通知だけで表示成功を確定し、認証済み Host API に報告する。Host は発行済み Preview 要求の固定 generation・artifact hashes と結び付けて表示済み記録を持つ。publish はその requestId を指定し、Host が現在の Dist 表示記録と照合する。これは協調する Editor の操作条件であり、CP の認可を代替しない。
- `prepare` 成功と `commit` 送信だけでは公開を許可しない。commit 失敗・完了通知の欠落・Unity instance の終了では表示未確定として公開を止める。新しい load または mode 切り替え時は Host の表示済み記録を無効化してから処理し、遅延した通知で復活させない。未確定時は再読み込みで確認し、旧 scene が残っていても公開可能とは扱わない。
- Local Preview は選択した全 PNG を候補 scene の準備時に GPU へ読み込み、Group の切り替えでは解放しない。scene の交換・破棄時に参照を解放する。Preview では GPU、serial load CPU、encoded bytes、旧 scene と候補の同時保持に対するメモリ予算上限を適用しない。画像サイズ・描画機能の制約と descriptor の整合性検証は維持し、共有 checksum は metadata が一致する場合だけ再利用する。load 後に不要な CPU readback copy を破棄する。
- compile、asset、Unity load の失敗は診断を表示し、前の正常 scene を維持する。新候補の資源は破棄する。Source 保存は build／load 失敗によって巻き戻さない。
- Dist 選択後は Dev の完了通知で表示を上書きしない。Unity instance はプレゼン更新ごとに再起動せず、終了時に scene・素材・Bridge の資源を解放する。
- 初期は ADR-0013 と同様に過去の完成 generation を自動回収しない。Unity の旧 scene・素材の参照解放は表示交換時に行う。完成成果物の回収は cache 回収と分け、保持中の generation を保護する規則とともに後続で設計する。

## 5. 検証と残る実証

| 境界                                             | 検証入口                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| 保存・履歴・最新要求・確認・復旧・公開条件       | Local Editor 各層 `tests/` の Node ロジックテスト、`nix run .#local-editor` |
| accepted 発火境界・確認投影・退避と失効・receipt | Core／CLI の Cue／Local Playback／Local Preview テスト                      |
| 共通描画・素材 integrity・交換・故障と復元通知   | Unity の Preview／Rendering EditMode テスト                                 |
| Proto drift                                      | Contracts の `check:wire-*`、`nix run .#unity-proto -- check`               |

Local Editor の専用 E2E 実行経路はない。controller の Node テストと状態表示の HTML 出力テストの成功は、実 WebGL／Quest の描画、固定 Browser／CSP、認証画面の手動操作を保証しない。再設計時の検証・未確認事項は [実装・受入記録](../plans/local-editor-preview-ui-refactor.md) を参照する。Unity player はコード変更後に `nix run .#unity-preview` で再生成する。
