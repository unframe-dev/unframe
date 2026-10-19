# 3Dモデルと動画のAuthoringとRuntime実装計画

- 状態: 技術検証とGLB変換APIに着手済み。Authoring/Compilerと本番Unity consumerは未接続。以下は残作業を示す。
- 対象: AuthoringからビルドしたGLBモデルとMP4動画を、Local EditorのUnity WebGL Previewと通常のUnity Runtimeで表示・再生する。
- 調査基準: 2026-10-19、`46c153890619e9dae581423a742aca735de165d1`。

## 範囲と完了条件

モデルは静的表示と素材内蔵クリップ、動画はSurfaceへの配置と再生制御を扱う。既存の[成果物契約](../packages/CONTRACT_ARTIFACTS.md)、[Data Model](../packages/DATA_MODEL.md)、[ADR-0016](../decisions/0016-model-animation-scope.md)を利用する。

- GLB: glTF 2.0 coreと`KHR_materials_unlit`、埋め込みPNG/JPEG、PBR/unlit、opaque/mask/blend、skin、morphを既存のfeature/budget内で扱う。外部URI、未許可extensionは拒否する。
- クリップ: play/pause/resume/stop、speed、loop、即時切替、crossfade、自然終了・停止姿勢の保持、再接続からの復元を扱う。root motionはbuild時に既存規則で除去し、ModelNodeのTRSと内部姿勢を分離する。
- 動画: 既存profileに従うMP4/H.264、alphaなし、任意のファイル内AAC-LC音声。play/pause/seek、loop、State切替、自然終了、Session pause/resumeを扱う。詳細なcodec条件は成果物契約を正本とする。
- 同一公開物をLocal Editorと通常Runtimeで読み込み、同じcanonical stateとlogical clockから表示・再生を復元できることを完了条件とする。通常Runtimeの受け入れには実Control Plane/Realtime経由とQuest実機を含める。

FBXや外部参照付きglTFの取り込み、任意形式からの自動transcode、ライブ配信、独立Audio、モデルのlayer/mask/additive合成、Editor上での素材編集UIは対象に加えない。素材登録と配置はAuthoring sourceから行い、既存Editorのプレビュー・再生・Cue操作で確認できるようにする。

## 現在の不足

| 境界            | 既存実装と追加対象                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoring       | [宣言](../../packages/unframe-authoring/src/domain/declarations.ts)は画像・フォントとbaked-web Surface中心。Model、Video、再生Action/Outputの宣言とloweringを追加する。                                                                                                                                                                                                                                                         |
| 素材入力        | [config](../../packages/unframe-cli/src/filesystem/load-config.ts)はentryFileのみ。[lock](../../packages/unframe-cli/src/filesystem/lock.ts)のassetsはBase64同梱で、[lock update](../../packages/unframe-cli/src/filesystem/update-lock.ts)は既存assetsを保持する。ローカル素材を登録・固定する入口が必要。                                                                                                                     |
| Compiler/Assets | Assetsの[GLB変換API](../../packages/unframe-assets/src/model/transform-glb.ts)は実装済み。[CompilerSourceAsset](../../packages/unframe-compiler/src/api/types.ts)はPNG/JPEG/TTF/OTFのみで、Bundleのmodelsは空。[partition planner](../../packages/unframe-compiler/src/api/plan-surface-partitions.ts)もVideoを拒否する。素材入力・変換API・metadataをCompilerへ接続し、動画検証と描画計画を追加する。                          |
| 出力/Preview    | [generation reader](../../packages/unframe-cli/src/filesystem/read-build-generation.ts)はGLB/MP4拡張子に対応済みだが、[atomic output](../../packages/unframe-cli/src/filesystem/atomic-output.ts)は未対応。[preview capability](../../packages/unframe-cli/src/author/preview-capability.ts)もModel/Videoを無効にしている。                                                                                                     |
| Local進行       | [Cue executor](../../packages/unframe-core/src/runtime/cue-executor.ts)、[local playback](../../packages/unframe-cli/src/author/local-playback.ts)、[wire変換](../../packages/unframe-cli/src/author/playback-wire.ts)はTimeline/Surface遷移中心。media/modelClip状態とRunの接続が必要。                                                                                                                                        |
| Realtime/実配信 | Goの[モデル再生](../../app/server/realtime/internal/runtimecore/v2_model.go)・[動画再生](../../app/server/realtime/internal/runtimecore/v2_media.go)、[Delivery route](../../app/server/control-plane/src/modules/publications/delivery.ts)は存在する。[Control Plane profile](../../app/server/control-plane/src/modules/publications/capability.ts)はModel/Videoを無効にしており、対応profileの追加・端末登録との接続が必要。 |
| Unity           | [通常Runtime](../../app/unity/Assets/Scripts/PresentationRuntime/PresentationBakedRuntime.cs)と[Preview adapter](../../app/unity/Assets/Scripts/PresentationRuntime/Preview/PresentationLocalPreviewAdapter.cs)はModel/Videoを受理しない。[共通player](../../app/unity/Assets/Scripts/PresentationRuntime/Rendering/PresentationPlaybackPlayer.cs)へモデル・動画consumerを接続する。                                            |

## 責務とデータの流れ

```text
project configの素材登録 + AuthoringのAsset参照・配置・Action
  → CLIの安全な素材snapshotとlock照合
  → Assetsの形式検証・GLB変換・実測metadata
  → CompilerのDefinition / RenderBundle / AssetSet / binary生成
  → CLIのatomic generation出力
  → Local Preview binding または publish / DeliveryManifest
  → 同じUnity loader・描画・再生consumer
     ← LocalのCore または Realtimeが確定したstate / Run / logical clock
```

- `unframe-authoring`は宣言API、`unframe-components`は必要な標準Model/Video Componentのsourceを所有する。Component固有のUnity実行コマンドは作らずcanonical Actionへlowerする。
- `unframe-assets`はbounded bytesからの形式検証、GLB変換、配布bytesとmetadataを所有する。Compilerは参照解決、意味検証、partition、公開物の組み立てを所有する。動画やGLBをWeb RendererでPNG化しない。
- CLIはファイルI/O、lock、変換ツールの起動環境、cache、出力・配信を所有する。外部toolは既存worker hostへ閉じ込め、実行時間・入力/出力サイズ・取消を制限する。プロセス型や絶対pathをCoreへ持ち込まない。
- 再生位置、完了、Cue進行、競合判定のauthorityはCore/Realtimeに置く。Unityのdecode完了・動画末尾callback・Animatorを進行のauthorityにしない。
- `PresentationPlaybackPlayer`配下でモデル姿勢・動画位置・Surface描画を共通化する。Native/WebGLの差は素材取得、decode用URL、codec/audio、resource解放のadapterへ置く。

## 実装順序

各項目は最小の代表fixtureでRed → Green → Refactorを回し、対応する表示consumerまで通してから次の機能を足す。共通基盤は最初のモデル経路で必要な範囲から導入する。

### 1 技術検証と受け入れfixtureの確定

技術検証の再現手順と観測範囲は[GLB/Unity](../../scripts/experiments/media-model/README.md)、[WebGL動画](../../scripts/experiments/media-video/README.md)、[動画metadata](../../scripts/experiments/media-metadata/README.md)を参照する。実験用playerの成立と、本番consumerへの接続・受け入れを区別する。残る判断は次のとおり。

- glTFast 6.20.0の受理範囲を、texture、unlit、mask/blend、vertex influence、UV、sparse accessorまで既存profileと照合する。shader variantsの同梱とmask後のNode opacityを実画素で確認する。通常RuntimeとQuestでのimport・manual clip評価・resource上限を検証する。汎用glTF parser/importerは新規自作しない。
- `transformGlb`のTRIANGLES限定を、受理profileに必要なstrip/fanの正規化まで拡張する。glTF Transform/Khronos ValidatorのprovenanceをCompilerのcacheへ接続する。
- ffprobeのcontainer/stream/frame情報と全decodeを組み合わせ、SPS等の途中変化・偽装、各profile条件を本番入力でも検査する。container durationとdecoded frame終端が異なる実例があるため、timestamp/edit list/最終sampleを含むdurationの整合・拒否規則を確定する。拡張子とcodec名だけで合格させない。
- 検証済bytes → Blob/Object URL → Unity VideoPlayerを本番の認証・取消・再生拒否通知へ接続する。Native、対象browser、実GPU、大きい素材・同時decoder・長時間drift/解放を追加検証し、seek許容差とmemory budgetを確定する。spikeの暫定150msを製品閾値に流用しない。
- Questは実機が現在接続できないため未検証である。Editor/WebGLで実装を進めても、Quest向けcapabilityの対応済み広告と最終受け入れは実機検証まで保留する。

依存は必要なpackageとUnity Package Managerへ追加し、pnpm/Unityのlockを更新する。ffprobe等は既存flakeに固定し、Linux/macOSそれぞれのtool identityをbuild provenanceとcache keyへ含める。同一OS内の再現性とOS間の一致は別に検証する。

**退出条件:** 各consumerで受理する形式・機能と検証範囲が定まり、未対応profileを誤広告しないこと。動画のduration・seek・資源上限の未解決事項を閉じてから、その条件に依存する本番処理を接続する。

### 2 静的モデルをAuthoringから両方のUnityへ通す

1. data-onlyの`unframe.config.ts`へ、stable Asset IDとproject-relative source path/media typeの対応を追加する。Authoringは`assetRef`とModel宣言で参照し、公開Definitionへsource pathを出さない。
2. lockはsourceのhash/sizeと変換条件・tool identityを固定し、大きなGLB/MP4をBase64で保存しない形式に改める。素材の入力・固定方法を統一するため、既存画像・フォントとexamplesも同じ素材登録へ移行する。必要なschema version更新を行い、旧形式の代替読込経路は追加しない。
3. 既存の安全なfilesystem snapshotとrevision検査を使い、素材追加・変更・削除をwatch、lock update/refresh、build cacheへ反映する。build時にhash違いを黙って採用しない。Compilerへのdescriptorとbytesは分離し、binaryの多重Base64化と無制限copyを避ける。
4. 実装済み`transformGlb`をCompilerへ接続し、選択sceneのroot channel除去、clip/material対応、負荷集計を配布GLBから確定する。変換後bytesのhashをAssetSetとBundleへ束縛する。source Asset IDと配布binary identityを混同しない。
5. Modelの配置・owner/audience・TRS/opacityを既存Definitionへlowerする。Bundle.models、AssetSet closure、atomic output、publish uploadとgeneration読込をGLBまで通す。
6. Preview/Nativeの投影とresidencyへModelを接続し、その時点で実装済みのfeature/上限を持つprofileで検証する。検証済bytesから実モデルを生成し、既存Scene wrapper配下へ配置して座標変換を一度だけ適用する。materialのalpha/mask、Node opacity、depth writeは成果物契約どおりに評価する。
7. importer生成物、mesh/material/texture、instanceの所有者を定める。Preview candidateの失敗・取消・置換時に解放し、commit済み表示を失敗で壊さない。Nativeも停止・再読み込みで解放する。

**主対象:** `unframe-authoring`、`unframe-assets`、`unframe-compiler`、`unframe-cli`のfilesystem/author/publication、UnityのDelivery/Rendering/Preview、生成project準備script。

**Redと受け入れ:** 小さなGLBをsourceからbuildし、Local WebGLとNativeでfixtureの実meshを確認する。外部URI、壊れたaccessor、未知extension、予算超過、素材差替え、checksum不一致を拒否する。同素材の複数instanceでTRS/opacityが独立し、同入力の再buildは同じ公開物になる。

### 3 モデルクリップとLocal進行を接続する

1. AuthoringのComponent構造、Action effect、Output producerへModel targetと既存`modelClip.*`/`modelClipCompleted`相当を追加する。clip IDを配布GLBの`sourceAnimationIndex`と実測durationへ固定し、存在しないclipをbuild errorにする。
2. Local用TypeScript Coreへモデルのcanonical state、Run、完了、停止姿勢、crossfadeの規則を実装する。Definitionだけを渡す現在の初期化を見直し、admission済みBundleからclip/durationを固定した実行catalogを入力する。CLIへ再生規則を置かず、既存Realtime実装と同一fixtureで、Action batchの競合・原子性も照合する。
3. [Preview proto](../../packages/contracts/proto/unframe/preview/preview.proto)の初期状態・再生状態へ既存RealtimeのModelClip state型を再利用して追加する。CLIのcatalog/Run/state投影、現在空のmodelClipStatesを生成するCore snapshot経路、Unityの検証済RenderViewを拡張する。新たなframeごとの骨格配信は設けない。
4. 共通playerへModelClip playerを接続し、canonical stateとlogical timeでclipとcrossfadeを手動評価する。Runが消えても保持姿勢を復元し、Node TimelineはwrapperのTRSだけを制御する。animation featureとRuntime capabilityを対応profileへ追加する。

**Redと受け入れ:** play/pause/resume/stop、speed/loop、最終姿勢、停止したcrossfade mixture、crossfade中のplay拒否、途中参加・再接続・Session pauseを検証する。同一GLBの二instanceを別時刻で動かし、移動Timeline併用時にもroot motionでModelNodeが動かないことを実描画で確認する。

### 4 動画をAuthoringから両方のUnityへ通す

1. 素材登録へMP4を追加し、bytesから既存profileの映像・音声条件とduration/寸法を検証する。自動transcodeを足さず、不適合には診断を返す。音声なし/あり、loop/non-loop、State切替のfixtureを用意する。
2. AuthoringへVideo contentと再生Action/完了Outputを追加する。media対象SurfaceはVideoをちょうど一つ持つという規則、State別loopとduration整合性をbuild時に検証する。
3. CompilerのpartitionをVideoとbaked-webの組み合わせへ拡張する。既存の完全被覆・clip・非重複・layer順序を維持し、生成できない配置は診断で拒否する。動画を含む画面全体をPNG化しない。BundleのVideo artifact、AssetSet、atomic出力とpublishを接続する。
4. Local Coreにmedia state/Runとplay/pause/seek、完了処理を追加し、Preview proto、Core snapshotとwire投影へ既存RealtimeのMedia state型を接続する。admission済みVideo artifactの正のdurationと現在Stateのloopを実行catalogへ束縛し、動画decoderの末尾通知でCueを進めない。
5. 共通Video playerをSurface描画へ接続し、対応profileのVideo feature/上限とRuntime capabilityを有効にする。検証済素材の準備、RenderTexture、fit/crop、opacity、audio、pause/seek/loop、decode遅延からの復帰を扱う。seekを毎frame発行せず、許容誤差と再同期条件をspike実測に基づき固定する。
6. WebGLはuser activationと音声許可の状態を既存EditorのPlay操作へ接続する。browserの再生拒否・decode失敗・未準備を表示し、無音への切替や成功扱いをしない。Session clockを止めるかはRuntime契約に従い、consumer単独で進行を書き換えない。
7. Nativeの検証済encoded cacheとWebGLのURL/bytes所有を接続する。動画、音声、RenderTexture、URL、downloadの取消と解放をPreview transaction/Runtime寿命へ揃える。全体取得方式の場合はencoded bytesとdecode中memoryの重なりをbudgetへ含める。

**Redと受け入れ:** source MP4から両consumerで実フレームが変化し、音声が再生されることを確認する。pause/seek/loop、State切替、終端と完了Cue、遅いPrepare、途中参加、Session pause、browser再生拒否、壊れた素材、期限切れ・取得失敗、decoder予算超過を確認する。

### 5 Capabilityと実配信の受け入れを完了する

- 各consumerの対応featureと実測上限を既存Model/Video capability・residencyへ反映する。単に`supported: true`へ変更せず、decoder同時数、model負荷、encoded cache、texture/decode memoryを検証する。
- Previewの固定capability、Control Planeの`quest-baked-web-v1`に代わる対応profile、端末側の登録・正規化・Delivery選択を揃える。旧profileへ未対応機能を広告しない。既存Delivery/Realtime schemaと署名付きasset経路を再利用し、対応外consumerはpublicationを部分表示せずadmissionで拒否する。
- 小さな再配布可能fixtureと利用条件をexamplesへ追加する。一つのPresentationで画像、文字、静的Model、内蔵clip、音声付き動画、Timeline/Cueを組み合わせる。
- CLI build/publish → Control Planeの素材upload/Delivery → Realtime state → Native/Questの実描画を通す。Localは同じ公開物を実WebGLで読み、Dev/Dist切替、再build、取消、失敗後の再試行を確認する。
- 素材取得を変える場合は、範囲外・期限切れ・別publicationの参照拒否、checksum/size、Range/HEAD（採用した場合）、切替後の古い非同期完了とresource解放を回帰テストする。

## 検証とドキュメント

| 検証範囲                      | 実施内容                                                                                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoring/Compiler/Assets/CLI | package scriptで対象限定のテスト・型検査を行う。静的抽出、参照/closure、GLB変換、codec検証、出力hash、lock/cache無効化、取消/失敗の回帰を追加する。                                                                                |
| Core/Realtime                 | 共通の入力・clock・Action列から、media/modelClipのstate/Run/完了/保持姿勢が一致することを検証する。必要な契約差だけ修正し、GoにTypeScript実装を共有しない。                                                                        |
| 契約生成                      | schema/proto変更時は`scripts/contracts/generate-consumers.sh`と`check-breaking.sh generate`を実行し、Go/C#/TypeScript、Unityへのコピー、conformance fixtureを同期する。生成物は手で編集しない。                                    |
| Unity                         | EditModeで検証・時計・姿勢・transaction寿命を確認し、必要なPlayModeテストでimport/decode/renderを確認する。`build-preview.sh`、`prepare-native-editor.ts`、`test-native-editor.sh`が生成するmanifest/asmdef/コピー対象も更新する。 |
| 実WebGL                       | `nix run .#unity-preview`で生成したplayerを使い、`UNFRAME_REAL_WEBGL=1`の`app/web/e2e/local-editor-webgl.spec.ts`系受け入れを実行する。bridge mockや通常Web E2Eを実decodeの証拠にしない。                                          |
| Native/Quest                  | `scripts/unity/test-native-editor.sh`の既存modeを利用・拡張し、実配信と再接続を確認する。QuestではIL2CPP/URP、音声、decoder上限、material/skin/morph、長時間の切替と解放を検証する。Linux Editorの成功をQuestの証拠にしない。      |

GLB/MP4 fixtureの期待metadata・姿勢・画面は独立した既知値で固定する。UIは利用者フローのE2Eを中心に検証し、内部componentの呼出回数に依存するテストは増やさない。画・音・時刻の許容差は技術検証で定め、任意の待ち時間や「エラーなし」だけを合格条件にしない。

実装と同じ変更単位で、Authoring契約、Assets/Compiler/CLIのArchitecture、Local Editor設計、Unity手順とexample利用法を更新する。規範契約の変更が必要な場合だけDATA_MODEL/CONTRACT_ARTIFACTS/ADRを改訂し、既存契約を現状の未実装へ合わせて弱めない。

作業中は対象限定の検証を行い、包括的な`nix run .#check`は明示的なコミット依頼時にまとめる。Nix変更時は`nix flake check`、Unity変更時はC#整形・meta整合性を別途確認する。Unity静的CI、実Editor、WebGL、Questの結果を分け、未実行環境を通過扱いにしない。

完了した項目はこの計画から除き、未解決の作業と受け入れ条件だけを維持する。
