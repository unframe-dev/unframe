# Local Editor: Unity Preview の実装契約

[ADR-0025](../decisions/0025-local-editor-unity-preview.md) に基づく Source 編集、Dev／Dist generation、Unity Preview、表示済み Dist の公開経路の実装契約。想定読者は CLI、Core、Web、Unity の実装担当者。実ブラウザー・native Unity・実サービスの E2E は別途検証し、その成功を本書だけから判断しない。

## 1. 目標と初期範囲

保存済みのローカル project を Dev Preview で確認し、明示 build で生成した同じ `dist` を Dist Preview・Control Plane 公開・本番読み込みに使用する。

初期 Preview は Structured／Opaque Source から生成した canonical baked-web Surface、Stage／container 配下の配置、初期 Group／State の静止表示、カメラの視点操作を扱う。表示の初期値は Core の既存初期化規則から導出する。公開後の本番読み込み E2E は native Unity Editor で実 Realtime Snapshot を受け取る。Cue 発火、Timeline 再生、WebGL の本番 Realtime 接続、Quest 実機は後続の検証とする。初期 Preview の未対応描画入力である Model、video、native-ui、tracking anchor などは load error にする。

Web UI は Local Host の project 読み込み、Props／Transform の保存、診断表示を扱う。Inspector 編集は対応する React scene に限る。編集用 metadata を得られない Source も Compiler の検証を通れば build・表示でき、UI は閲覧と診断を提供する。その他の Source は外部 editor で保存して Dev Preview に反映する。Unity 上の選択・Gizmo・Component 配置は拡張目標であり、初期の完了条件に含めない。

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

`PresentationRuntimeDataStore` は Delivery／Snapshot の検証を所有する。描画参照は `IPresentationRenderView` を介し、Preview／Delivery Adapter が共通 hierarchy・renderer を使う。本番 Adapter の fence 検証は維持する。

### Web features の統合

`app/web/src/features/editor/` が Source Inspector、保存・Undo／Redo、診断、Dev／Dist 選択、Unity lifecycle、公開 UI を所有する。`editor.html` から `dist-editor` を生成し、Local Host が同一 origin で配信する。旧 Author entry、Slide／Element 文書、localStorage 文書保存、React 3D viewport は編集経路から撤去した。

対象は CLI 起動時に指定した project であり、ブラウザーから任意 filesystem path を開く API はない。Web の `/editor/$presentationId` は Local Host 起動の案内を表示する。Home の mock 一覧はローカル project の正本ではない。認証・device 承認・account settings は Web application に保持し、ローカル Editor の起動・保存・Preview はログインなしで利用する。

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

publish は固定 Dist の完全性を検証し、現在の Source／lock を読み直して build したり、最新ローカル revision との一致を要求したりしない。A を build・表示した後に Source を B へ保存しても、現在の `dist` が A のままなら A を公開できる。公開先の競合は、公開要求に固定した期待 PublicationFence（初回は未公開）と CP の現在値を原子的に照合して検出する。別の publish が先行した場合は競合として返し、期待値を自動更新して再送しない。認可・Asset readiness・active-use lock は維持する。CP の Draft revision とローカル Source revision の一致を公開条件にする旧方針は置き換える。

### Core の共通描画選択

`verifyBuildIntegrity` 済みの BuildArtifacts と role／CapabilityProfile を受ける publication 非依存の処理で、selection・Runtime catalog を構築する。出力は visible IDs、選択済み Render Surface／State／artifact、Runtime catalog、asset closure／residency。既存の renderer 選択・参照・budget 規則を再実装しない。

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
| `sourceRevision`             | lock refresh 確定後の build 入力 revision。Dist Preview は `null`                       |
| `buildManifest` / `assetSet` | 固定 generation の検証済み canonical artifact                                           |
| `projection`                 | 共通描画選択結果。publication key／profile identity を含めない                          |
| `initialState`               | Core が導出した初期 Node／Surface 状態。Session／assignment／replay の field を含めない |
| `assets`                     | 選択 closure の Asset ID と opaque reference の対応。path や任意 URL は含めない         |

Host のローカル HTTP API は CLI の Author contract が所有し、envelope の schema と C# consumer は同じ正本から生成・drift 検査する。正本は `packages/contracts/proto/unframe/preview/preview.proto`。canonical JSON は文字列として保持し、projection／initial state は既存 Proto message を再利用する。Dist の `source_revision` は optional field の absence で表す。TypeScript wire descriptor／static binding／型は Contracts の `generate:wire-*` scripts、C# と Unity の Proto コピーは `nix run .#unity-proto` で生成する。対応する `check:wire-*` と `nix run .#unity-proto -- check` で drift を検査する。

素材取得は、認証済み Local Author API と WebGL Asset Adapter を介す。reference は固定 generation の検証済み catalog だけを指し、任意の filesystem path／外部 URL を受け付けない。Asset Adapter が bytes を共通 Unity renderer へ渡し、renderer は HTTP、Bearer token、Source を知らない。全 PNG を一つの Base64 JSON に載せる方式は採用しない。

Unity は decoded dimensions と texture metadata の一致も検証する。local TRS、physical size、fit、partition bounds、UV、alpha／sRGB は [ADR-0010](../decisions/0010-spatial-surface-coordinate-contract.md) と [ADR-0012](../decisions/0012-texture-budget-residency-contract.md) に従う。Preview 固有の座標変換・shader 意味論を設けない。

## 4. 更新と失敗時の挙動

### Dev のローカル lock refresh

Dev は保存済み Source・ローカル素材の変更を検知し、対応する component／theme の file closure の hash を refresh してから build する。対象素材はその closure 内のローカルファイルとする。元の local path を持たない `lock.assets` の埋込 bytes は保持し、自動 refresh の対象にしない。既存 package の解決結果・version・snapshot は維持し、必要な local hash と整合性 hash のみ再計算する。package の追加・更新や lock の再作成は明示操作とし、自動 install／network 解決は行わない。通常の check／本番 build は Source／lock の frozen 入力を検証し、自動 refresh しない。publish は固定 Dist のみを検証する。

Host は Source lease と既存 lock 規則を使い、refresh 対象の入力 snapshot を検証する。refresh の確定前と build の出力公開前に revision を再検査し、Source と lock が同じ入力 snapshot に対応する場合だけ generation を公開する。途中の外部保存で revision が変われば最新入力でやり直す。refresh 失敗時は既存 lock と正常表示を維持して診断を出し、Source は巻き戻さない。成功した refresh 自身の lock 更新を追跡し、watcher が無限に refresh／build を繰り返さない。

revision は config・Source・lock の bytes を含む。refresh は開始時の revision を前提に確定し、確定後の revision を Dev build の入力として固定する。Host は確定後の snapshot を UI へ通知して `savedRevision` を更新し、同じ値を `buildingRevision` と envelope の `sourceRevision` に使う。refresh 自身の変更と外部保存を区別し、build 中にさらに入力が変わった場合はその結果を stale とする。

### 表示の更新

- UI は `savedRevision`、`buildingRevision`、`loadedBuildIdentity` を区別し、保存済み内容と現在の表示が異なるときに明示する。
- 初回 Dev 選択と保存成功後に build を要求する。project 外部からの保存も入力 revision の変更として検知し、検証後に最新 revision を build する。未保存の editor buffer は入力にしない。
- 更新要求は最新1件を保持する。旧要求の build／asset load／Unity load が完了しても、現在選択している mode と要求に一致しなければ表示へ反映しない。
- build 成功時に完成 Dev generation を公開する。Unity 表示の成功は別に管理する。候補 scene と素材を準備し、最新要求であることを確かめてから表示を交換する。
- Bridge は `prepare(requestId)` の成功通知後に Web UI が mode／最新要求を照合し、`commit(requestId)` または `discard(requestId)` を送る。Unity は現在の要求に一致する候補だけを commit する。mode 切り替え時は要求を無効化し、古い load 成功だけで scene を交換しない。
- Unity は scene の交換完了後に `committed(requestId, buildIdentity)` を返す。Web UI は現在の mode／要求と一致する通知だけで表示成功を確定し、認証済み Host API に報告する。Host は発行済み Preview 要求の固定 generation・artifact hashes と結び付けて表示済み記録を持つ。publish はその requestId を指定し、Host が現在の Dist 表示記録と照合する。これは協調する Editor の操作条件であり、CP の認可を代替しない。
- `prepare` 成功と `commit` 送信だけでは公開を許可しない。commit 失敗・完了通知の欠落・Unity instance の終了では表示未確定として公開を止める。新しい load または mode 切り替え時は Host の表示済み記録を無効化してから処理し、遅延した通知で復活させない。未確定時は再読み込みで確認し、旧 scene が残っていても公開可能とは扱わない。
- scene 交換の admission は、旧 scene と候補を同時保持する GPU 使用量と serial asset load の CPU ピークも検査する。固定 Preview capability の上限を超える場合は候補を拒否して旧 scene を維持する。ADR-0012 の単一成果物の charge は変更しない。`PresentationPreviewAdmission` は単一 scene GPU 64 MiB、旧 scene＋候補 GPU 96 MiB、serial load CPU peak 64 MiB を上限とする。GPU charge は RGBA8 の `width × height × 4`、各 texture の CPU peak は `encodedSizeBytes + 2 × decodedGpuBytes`。共有 checksum は descriptor が一致する場合だけ一度計上し、CPU peak は未共有 texture の最大値で検査する。同一 checksum の資源を共有する実装では同一資源を一度だけ計上し、load 後に不要な CPU readback copy を破棄する。
- compile、asset、Unity load の失敗は診断を表示し、前の正常 scene を維持する。新候補の資源は破棄する。Source 保存は build／load 失敗によって巻き戻さない。
- Dist 選択後は Dev の完了通知で表示を上書きしない。Unity instance はプレゼン更新ごとに再起動せず、終了時に scene・素材・Bridge の資源を解放する。
- 初期は ADR-0013 と同様に過去の完成 generation を自動回収しない。Unity の旧 scene・素材の参照解放は表示交換時に行う。完成成果物の回収は cache 回収と分け、保持中の generation を保護する規則とともに後続で設計する。

## 5. 検証と残る実証

| 境界                                         | 実装・検証入口                                                  |
| -------------------------------------------- | --------------------------------------------------------------- |
| generation・保存競合・固定 Dist 公開         | CLI の Local Preview／Publication 関連テスト、`author/` service |
| 最新要求・commit acknowledgement・失敗時保持 | Web の `preview-session`／`unity-preview`／`editor-app` テスト  |
| 共通描画・素材 integrity・交換時 budget      | Unity の Preview／Rendering EditMode テスト                     |
| Proto drift                                  | Contracts の `check:wire-*`、`nix run .#unity-proto -- check`   |
| 実ブラウザー・公開・native 読み込み          | `nix run .#local-editor-e2e`                                    |

`local-editor-e2e` は隔離したローカル D1／R2、Control Plane、Realtime、承認用 Web、Local Host を起動し、実 WebGL の Dist commit、device 承認、公開 hash、Delivery／素材取得、Snapshot／StateReady を経由する native Unity Editor 描画を検査する。素材と Realtime は実行ごとのローカル CA を用いる HTTPS 経路で接続する。fixture のアカウント／session は試験が準備する。クラウドへの deploy や本番 upload は行わない。

2026-10-07 に実 WebGL の Structured／Opaque Dev・Dist 描画、contain／alpha、Transform 保存後の画素変化を確認した。証拠は `.unframe/actual-webgl-evidence/` の画像と `pixel-evidence.json`。復旧 Snapshot の進行状態保持と Publication／profile／assignment 不一致の拒否は実 Editor fixture で検証した。同日にローカル実 D1／R2・Control Plane・Realtime の E2E も成功し、device 承認、固定 Dist 公開、Delivery／HTTPS 素材、Snapshot／StateReady、native Unity の実画素まで確認した。結果は `.unframe/unity-preview/e2e/20261007T160533-371594/result.json`、native の画像は同 directory の `native.png`。Quest 実機、Cue／Timeline 再生、WebGL の本番 Realtime 接続、入力・性能の実機確認は別の検証対象。

実行前提・生成物・ログの位置は [scripts README](../../scripts/README.md#local-editor-と-unity) を参照する。公開時認証の取り消し・期限切れでも保存と Preview は継続できる。Source のみ更新した後の固定 Dist 公開と、権限のない ID 再利用・古い PublicationFence の拒否も E2E の対象である。
