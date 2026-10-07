# Local Editor: Unity Preview の設計と実装計画

設計確定・実装未完了。[ADR-0025](../decisions/0025-local-editor-unity-preview.md) に従い、ローカル成果物の Unity 表示を先に通す。想定読者は CLI、Core、Web、Unity の実装担当者。

## 1. 目標と初期範囲

保存済みのローカル project を Dev Preview で確認し、明示 build で生成した同じ `dist` を Dist Preview・Control Plane 公開・本番読み込みに使用する。

初期 Preview は Structured／Opaque Source から生成した canonical baked-web Surface、Stage／container 配下の配置、初期 Group／State の静止表示、カメラの視点操作を扱う。表示の初期値は Core の既存初期化規則から導出する。公開後の本番読み込み E2E は native Unity Editor で実 Realtime Snapshot を受け取る。Cue 発火、Timeline 再生、WebGL の本番 Realtime 接続、Quest 実機は後続の検証とする。初期 Preview の未対応描画入力である Model、video、native-ui、tracking anchor などは load error にする。

Web UI は既存 Author の project 読み込み、Props／Transform の保存、診断表示を入口にする。Inspector 編集は既存 Author が扱える React scene に限る。編集用 metadata を得られない Source も Compiler の検証を通れば build・表示でき、UI は閲覧と診断を提供する。その他の Source は外部 editor で保存して Dev Preview に反映する。Unity 上の選択・Gizmo・Component 配置は拡張目標であり、初期の完了条件に含めない。

## 2. 所有権とデータ経路

```text
Authoring Source + assets + config + lock
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
| `packages/unframe-core/` | build 検証、publication 非依存の role／capability 選択、Runtime catalog・初期表示状態の導出                          |
| `packages/unframe-cli/`  | project filesystem、保存、出力 channel、generation 固定、Local Author HTTP API                                       |
| `app/web/`               | Dev／Dist 選択、保存・build・表示 revision の提示、Unity instance と要求の lifecycle                                 |
| `app/unity/`             | Preview／Delivery 入力 Adapter、共通 hierarchy・描画・素材管理、WebGL／Quest platform Adapter                        |
| Control Plane            | upload された build の公開整合性、認可、Delivery projection。Source や Dev generation は受け取らない                 |

既存 `PresentationRuntimeDataStore` は Delivery／Snapshot の検証を所有している。描画に必要なデータ参照をそこから分離し、両 Adapter が同じ hierarchy・renderer を呼べるようにする。本番 Adapter の fence 検証を省略して共通化しない。

### Web features の統合

`features/editor/` をローカル編集の UI・状態・Local Author API 接続・Unity Preview の所有先にする。既存 `features/author/` の project 読み込み、対応 Props／Transform の Source 保存、診断、build 状態を統合の基盤とする。CLI の Local Author Host と API contract の所有権は変更しない。

| 既存機能                         | 統合方針                                                                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `author/`                        | Editor へ統合し、保存・build・Dev／Dist・Unity lifecycle を一つの操作経路にする                                                                                                                |
| `editor/ui/`                     | shell・panel の配置や共通 UI を再利用し、旧文書への依存を外す。viewport は Unity に置き換え、初期非対応の Gizmo・Model 編集操作は露出しない                                                    |
| `editor/model/`・`editor/infra/` | 旧 Slide／Element／PresentationDocument、command／history／serializer／migration、localStorage 文書保存を置き換える。Editor 状態は Source 編集 buffer・保存 revision・選択・Preview 要求を扱う |
| `presentations/`                 | project への入口を Editor のローカル project 読み込みへ接続する。mock 一覧・CP starter definition をローカル project の正本として使わない                                                      |
| `auth/`・`device/`・`settings/`  | 公開先の認証・device authorization・account 設定として保持し、ローカル Editor の起動・保存・Preview から分離する                                                                               |

ローカル Editor の対象は Host に指定した project とし、ブラウザーから任意 filesystem path を開く API は追加しない。旧 `/editor/$presentationId` の demo／localStorage loader と Editor 全体への `requireSession` を置き換える。Editor の Web entry・build 出力は一つに揃えて Local Author Host から配信し、旧 Editor と Author の二重入口を残さない。

認証・device 承認・account settings は CP が信頼する設定済み `WEB_ORIGIN` で配信する。Local Host は設定済み CP と client ID に対して既存 device authorization を開始・poll し、公開用 bearer credential を取得する。Editor は同一 origin の Host API で認証状態と承認用 `user_code`・URLを扱い、CP へ cookie 付きで直接接続しない。CP credential と `device_code` は Host のメモリーだけに保持し、Web UI・localStorage・project・ログへ渡さない。Host 終了・認証期限切れ時は再認証する。CP の verification URI と承認画面の router path を揃え、Google login など承認画面の認証も信頼済み origin 内で完結させる。

Local Host は既存の origin／token 検査と `connect-src 'self'` を維持する。Editor は verification URL を別タブで開き、Editor の同じ project・表示済み Dist を保持したまま Host API から認証状態を取得する。承認後の credential は Host の poll で取得し、Editor への cookie／credential redirect は行わない。認証完了後も実際の publish 受付で Dist を再照合し、認証中の成果物変更を取り込まない。認証の取消・失敗・期限切れはローカル編集・保存・Preview を妨げない。

旧文書から Source への自動移行・互換保存は初期範囲に含めない。旧描画専用依存と旧 model 専用テストは import・利用箇所を確認して撤去し、Source 保存、外部変更、ログインなし Preview、保存／build／load 失敗、公開時認証の受け入れテストへ置き換える。Control Plane の現行 CRUD schemaVersion と退役済み Presentation wire contract は区別し、Web 統合だけを理由に server／device API を削除しない。

公開先 Presentation の ID・所有権登録は引き続き必要である。現行 CP の登録 API が要求する旧 Definition と、公開する canonical build は別の契約として扱う。`starter-definition` の撤去は公開先登録の契約・Adapter 整備と合わせて行い、登録経路を失わせない。CP へ Authoring Source を送る Editor 保存経路は追加しない。

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

### Core の共通描画選択

`verifyBuildIntegrity` 済みの BuildArtifacts と、role／CapabilityProfile を受ける publication 非依存の処理へ、既存 selection・Runtime catalog 構築を切り出す。出力は visible IDs、選択済み Render Surface／State／artifact、Runtime catalog、asset closure／residency。既存の renderer 選択・参照・budget 規則を再実装しない。

Delivery は従来どおり `verifyPublicationIntegrity` を通し、共通結果に PublicationFence、profile identity、projection instance、asset access を付加する。Local Preview は build identity を使い、publication／session／assignment を付加しない。

Delivery は描画 catalog・素材・fence を提供し、本番の Node／Surface の現在状態は割り当て済み Runtime Core の `ConnectionSnapshot` から取得する。本番 Adapter は Session／Publication／profile／assignment fence と Snapshot の sequence を検証してから共通 renderer に状態を渡す。復旧・進行済み Snapshot を Definition の宣言初期値へ戻さない。

初期 role は presenter、capability は Web Preview の実装済み機能を表す固定 profile とする。初期 Group と Surface State は Definition の宣言値を使い、Node の active／visible／opacity／local Transform を Core の初期化規則に従って生成する。初期化は assignment epoch に依存しない pure 処理として抽出し、Cue／timer は進行させない。catalog に含まれても初期表示状態に存在しない Group-owned ノードは inactive とする。

### Local Preview Adapter

Local Author Host は固定 generation の4つの artifact JSONを `verifyBuildIntegrity` で検証する。選択した asset closure の bytes は AssetSet の mediaType・encodedSizeBytes・checksum と照合する。

Preview の cross-application envelope は次の field を持つ。canonical schema と publication 非依存の nested message を再利用し、Preview 独自の Node・Surface・artifact 定義を複製しない。fence を持つ Delivery／Snapshot envelope は流用しない。

| field                        | 契約                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `schemaVersion`              | Local Preview envelope の version。canonical artifact の version と区別する             |
| `requestId`                  | Web UI が各 load に発行する一意 ID。Bridge の結果・commit・discard は同じ ID を使う     |
| `sourceRevision`             | build 時の入力 revision。成果物のみを開く Dist Preview は `null`                        |
| `buildManifest` / `assetSet` | 固定 generation の検証済み canonical artifact                                           |
| `projection`                 | 共通描画選択結果。publication key／profile identity を含めない                          |
| `initialState`               | Core が導出した初期 Node／Surface 状態。Session／assignment／replay の field を含めない |
| `assets`                     | 選択 closure の Asset ID と opaque reference の対応。path や任意 URL は含めない         |

Host のローカル HTTP API は CLI の Author contract が所有し、envelope の schema と C# consumer は同じ正本から生成・drift 検査する。schema の具体的な生成形式と生成コマンドは段階2で実装し、field の責務は上記に固定する。

素材取得は、認証済み Local Author API と WebGL Asset Adapter を介す。reference は固定 generation の検証済み catalog だけを指し、任意の filesystem path／外部 URL を受け付けない。Asset Adapter が bytes を共通 Unity renderer へ渡し、renderer は HTTP、Bearer token、Source を知らない。全 PNG を一つの Base64 JSON に載せる方式は採用しない。

Unity は decoded dimensions と texture metadata の一致も検証する。local TRS、physical size、fit、partition bounds、UV、alpha／sRGB は [ADR-0010](../decisions/0010-spatial-surface-coordinate-contract.md) と [ADR-0012](../decisions/0012-texture-budget-residency-contract.md) に従う。Preview 固有の座標変換・shader 意味論を設けない。

## 4. 更新と失敗時の挙動

### Dev のローカル lock refresh

Dev は保存済み Source・ローカル素材の変更を検知し、対応する component／theme の file closure の hash を refresh してから build する。対象素材はその closure 内のローカルファイルとする。元の local path を持たない `lock.assets` の埋込 bytes は保持し、自動 refresh の対象にしない。既存 package の解決結果・version・snapshot は維持し、必要な local hash と整合性 hash のみ再計算する。package の追加・更新や lock の再作成は明示操作とし、自動 install／network 解決は行わない。通常の check／本番 build／publish は frozen 入力を検証し、自動 refresh しない。

Host は Source lease と既存 lock 規則を使い、refresh 対象の入力 snapshot を検証する。refresh の確定前と build の出力公開前に revision を再検査し、Source と lock が同じ入力 snapshot に対応する場合だけ generation を公開する。途中の外部保存で revision が変われば最新入力でやり直す。refresh 失敗時は既存 lock と正常表示を維持して診断を出し、Source は巻き戻さない。成功した refresh 自身の lock 更新を追跡し、watcher が無限に refresh／build を繰り返さない。

### 表示の更新

- UI は `savedRevision`、`buildingRevision`、`loadedBuildIdentity` を区別し、保存済み内容と現在の表示が異なるときに明示する。
- 初回 Dev 選択と保存成功後に build を要求する。project 外部からの保存も入力 revision の変更として検知し、検証後に最新 revision を build する。未保存の editor buffer は入力にしない。
- 更新要求は最新1件を保持する。旧要求の build／asset load／Unity load が完了しても、現在選択している mode と要求に一致しなければ表示へ反映しない。
- build 成功時に完成 Dev generation を公開する。Unity 表示の成功は別に管理する。候補 scene と素材を準備し、最新要求であることを確かめてから表示を交換する。
- Bridge は `prepare(requestId)` の成功通知後に Web UI が mode／最新要求を照合し、`commit(requestId)` または `discard(requestId)` を送る。Unity は現在の要求に一致する候補だけを commit する。mode 切り替え時は要求を無効化し、古い load 成功だけで scene を交換しない。
- scene 交換の admission は、旧 scene と候補を同時保持する GPU 使用量と serial asset load の CPU ピークも検査する。固定 Preview capability の上限を超える場合は候補を拒否して旧 scene を維持する。ADR-0012 の単一成果物の charge は変更しない。段階2で Unity 担当が固定 Preview capability の GPU／CPU 上限とピークの算定方法を定義し、上限ちょうど・上限超過の fixture で合否を固定する。同一 checksum の資源を共有する実装では同一資源を一度だけ計上し、load 後に不要な CPU readback copy を破棄する。
- compile、asset、Unity load の失敗は診断を表示し、前の正常 scene を維持する。新候補の資源は破棄する。Source 保存は build／load 失敗によって巻き戻さない。
- Dist 選択後は Dev の完了通知で表示を上書きしない。Unity instance はプレゼン更新ごとに再起動せず、終了時に scene・素材・Bridge の資源を解放する。
- 初期は ADR-0013 と同様に過去の完成 generation を自動回収しない。Unity の旧 scene・素材の参照解放は表示交換時に行う。完成成果物の回収は cache 回収と分け、保持中の generation を保護する規則とともに後続で設計する。

## 5. 実装順序と受け入れ条件

前提として、最新 main にある Control Plane の Publication／Delivery API・migration、Session の publication 固定、Realtime v2、Unity の native 接続・描画を対象 checkout へ統合する。担当は各 server／Unity component とし、既存生成契約と関連テストを確認する。既存実装をこの計画で新規設計し直さず、Local Preview に必要な分離と実サービス接続の不足を確認する。

| 段階           | 実装                                                                                             | 完了条件                                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. 境界定義    | 本書、ADR、次段階の public seam と fixture 方針の確定                                            | 所有権、出力 channel、共通描画選択の入出力、envelope field、Bridge prepare／commit／discard、下記 fixture の検証方針を文書で固定し、独立レビューを完了                                                                         |
| 2. Dist 実表示 | 共通 Core 選択と Unity 入力、baked-web 描画、WebGL build／Bridge、固定 generation の読み込み     | Preview の交換時メモリ上限・算定方法・境界値 fixture を定義して検証。Structured／Opaque Source の Compiler 生成 `dist` の素材・配置・fit を実ブラウザーで確認。初回 load 失敗は診断を表示し、置換失敗は前の正常 scene を維持   |
| 3. Dev 更新    | 出力 channel 分離、保存検知、ローカル lock refresh、latest request、候補 scene の交換            | 外部保存を含め自動更新。package 解決を変更せず、refresh 失敗・連続保存・取消で古い結果が勝たない。Dev 更新で `dist` の link／hash が変わらない                                                                                 |
| 4. Editor 統合 | Author／旧 Editor の関連 UI と entry 統合、Source 保存・診断・revision 表示、Dev／Dist、視点操作 | ログインなしで project を開き、保存・開き直し・Preview ができる。旧文書／localStorage／React 3D 描画を編集経路から外す。Inspector の編集可否と build 可否を分離し、Dist は再 build せず表示、Dev 通知で上書きされない          |
| 5. 公開 E2E    | 表示済み Dist の照合・publish、実 CP／Realtime／素材取得、native Unity 接続                      | 古い Dist 表示・Unity commit 前の upload を拒否し、受付後の `dist` 更新でも upload 元を固定。公開結果と成果物 hash が一致し、実 Delivery／素材／Snapshot から native Unity が描画する。Source／Dev generation の upload がない |

段階2では Core の既存 Delivery selection／integrity と、Unity の既存 fixture テストを回帰検証する。座標・fit・partition・texture の fixture は Preview と Delivery Adapter の両方から共通 renderer に渡し、結果を比較する。複数 Group の初期 inactive と、旧 scene＋候補の residency 上限超過も検証する。TS Core と Go Runtime の宣言初期状態は同じ conformance fixture で比較する。段階3では filesystem channel と Host→Bridge の更新競合をテストする。

実 WebGL の描画、実サービスの公開・読み込み、Quest 実機の入力・性能は別の証拠として記録する。WebGL build や単体テストだけで段階2／5の E2E 完了としない。

段階5はローカルの実 Control Plane・Realtime と素材保存を起動し、実際の認証・権限検査を通す。公開先 Presentation の作成・権限付与、BuildManifest の presentationId と公開先 ID の整合、Session／participant、runtime assignment／lease、Delivery／bootstrap credential の準備を検証手順に含める。公開した素材を取得・hash 検証し、本番 Delivery と実 Snapshot を適用して native Unity Editor で共通 Runtime が描画するところを完了点とする。既存接続の State handshake／StateReady も実際に通す。

初期表示の比較には timer・自動 Cue のない fixture を使う。別 fixture で進行済み／復旧 Snapshot を宣言初期値へ戻さないこと、Publication／profile／assignment 不一致を拒否することを確認する。成果物 JSON／素材 bytes の改変、publish 受付後の `dist` 差し替えも検証する。架空の fence や mock response で実サービスの経路を代替しない。本番環境への deploy・upload、Cue／Timeline 再生、WebGL の本番 Realtime 接続、Quest 実機はこの受け入れ条件に含めない。

公開時認証では設定済み origin の device 承認を実際に通し、同じ project・Dist 表示を保ったまま公開できることを確認する。認証中に `dist` が変わった場合は再読み込みを要求し、取消・期限切れでも保存と Preview は継続できること、CP credential がブラウザーへ返らないことを検証する。

素材の保存先と取得 URL が同じ backend を指すことを実疎通で確認する。既存 R2 presigner の Cloudflare URL を local R2 binding にそのまま組み合わせない。完全ローカルの検証には native Unity から取得できる HTTPS 素材経路を整備する。開発用の実 R2 を使う場合は、クラウド素材保存を含む検証として記録し、完全ローカルの証拠と区別する。

Unity の生成 transport 依存と WebGL の実行環境は段階2で検証する。段階3の Author build は Dev channel を指定し、通常の本番 build を呼んで `dist` を更新する接続を残さない。
