# Audience Webアプリ開発への移行

- 更新日: 2026-10-24
- 状態: 位置保持PoCはユーザー承認により完了。Audience内の責務分離、座標接合、PNG・動画・GLB描画、進行適用、HTTPクライアント、視聴UIを実装済み。実Backend／Realtimeとの接続と総合受入は未完了。
- 所有アプリ: `app/audience/`。編集用の`app/web/`と分離する。
- 統合先: `webXR/audience`。`webXR/tracking-poc`は取り込み済み。現状保存のDraft PRは[#167](https://github.com/unframe-dev/unframe/pull/167)。2026-10-22に最新main（最終取得時点`5219fa91`）を取り込み、競合を解消した。新しい実装は更新済み統合ブランチから作業ブランチを分ける。

## 引き継ぐ構成

[採用記録](../experiments/audience-apriltag-adopted.md)と[Audience README](../../app/audience/README.md)を追跡の基準とする。

- AprilTag `tag36h11`の単一ID 0。姿勢が一度有効に取れたら即確定する。
- 次の観測まで8th Wall absolute SDK／SLAMで位置を保持する。未検出・曖昧姿勢では前のアンカーを維持する。
- SDK追跡低下・hidden・停止では非表示にし、新しいタグ認識を要求する。
- 確定値から表示を分離し、距離別の上限付き閾値内の小揺れだけを抑える。閾値を超える変化は即反映する。
- カメラ権限、NORMAL待機、Worker、GPU読取、姿勢推定、描画、停止・復帰の所有と破棄の境界を保つ。
- JSON診断と入力画像の明示保存を開発時の調査に利用する。製品UIでの公開方法はアプリ開発時に決め、自動アップロードしない。

現構成はユーザーが開発開始に十分と評価した基準であり、7m認識・外部真値に対する10cm誤差・不可視5〜10分保持を定量実証したものではない。追跡方式の再選定や追加実験を開発開始の条件にはしない。

## 製品方針

Unframeは無償。会場の観客はログイン・登録なしでサイトを開き、ルームIDを入力して参加する。会場内で登壇者と同じ空間・進行を視聴する。ログイン不要参加は製品要件であり、現状は匿名資格の発行・登録済Audience profile・接続環境の提供待ち。HTTP取得後はカメラの位置合わせへ進めるが、実プレゼンのライブ視聴はまだ接続していない。

完成範囲はユーザー指定により、動画・3Dモデルも含めたUnframeの対応表現の視聴とする。PNGだけの取得・表示・進行同期は中間目標であり、アプリ完成とは扱わない。既存契約のbaked-web、native-ui、video、modelと各Runtime状態に対するWeb側の対応表を工程1で作成し、Web向けの配信選択と実装範囲を明示する。未対応の必須表現を黙って省略して完成とはしない。

## 実装順序

最初の実用上の到達点を「ログインなしでルームへ参加し、実サーバーの公開成果物をXR表示し、登壇者の進行に合わせてPNG表示が更新されること」とする。段階ごとに取得・表示・状態反映を結び、独自の簡易通信契約は作らない。0〜6で最初の実用的なPNG視聴を成立させ、その後の動画・3Dを含む表現対応と総合受入までを必須の実装順とする。

| 順序 | 実装範囲・担当                                               | 完了条件                                                                                                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | 完了：最新mainとの統合（統合ブランチ）                       | Draft PRのCI・共通文書・ロック等の競合を解消し、共有契約とアプリの依存を現行mainへ揃える。Node.jsのセキュリティ更新はこの作業へ混在させない                                                                                                                                         |
| 1    | 既存契約の適合・接続境界と初期対応表（Audience）             | 既存join／Delivery／bootstrap／Realtimeを使う接続手順、Audienceが受け取るデータと失敗条件、表現対応表、Backend担当への確認・依頼事項を記録する。匿名資格の発行、profile登録、ブラウザ用通信経路のサーバー実装は担当範囲に含めない。予算の確定には端末測定が必要であることを明示する |
| 2    | アプリ基盤と追跡の分離（Audience）                           | XrHost、Localization、Renderer、アプリ制御、診断UIにPoCの責務を分ける。採用済みの検出・確定・保持・小揺れ補正を維持し、開始・停止・再入場でカメラやWorkerが重複しない                                                                                                               |
| 3    | 契約データの表示（Audience）                                 | 既存RenderBundle／AssetSetManifest／Delivery／ParticipantRuntimeViewのfixtureをテストに用い、PNG、sRGB・透過、寸法・座標・表示状態をThree.jsへ反映する。ページ番号だけの独自データモデルで代用しない                                                                                |
| 4    | 参加・実プレゼン取得クライアント（Audience、外部依存あり）   | 既存join／Delivery／bootstrapのクライアント、資格・素材URLの期限管理、失敗時UIを実装する。匿名資格・Audience profile・HTTP originがBackendから提供された後、ログインなしの実接続を検証する。提供前は既存契約fixtureで検証し、匿名参加完了とは扱わない                               |
| 5    | 初期進行状態の取得・反映（Audience、外部依存あり）           | transport非依存の受信・適用器を既存Control／State契約とfixtureで作る。通信方式と接続先の提供後にbrowser adapterを接続し、handshake／Snapshot／StateReadyを実検証する。異なる世代やSnapshot適用前の状態を描画しない                                                                  |
| 6    | ライブ進行の取得・反映（Audience）                           | sequence／fence／originの整合を維持し、投影済みstate・reliable event・runtime clockから表示対象、transform、opacity、遷移・Timelineを更新する。サーバーの進行判断をブラウザで再実行しない。基本的なReplay／再同期も実装する                                                         |
| 7    | 動画・3Dを含む表現対応（Audience、profile登録はBackend依頼） | 動画とGLBを必須対象とし、再生・停止・途中参加・同期、model clip・crossfade・held状態など既存契約が定義する再生状態を反映する。baked-web／native-uiのWeb向け表示方式も対応表に従って実装する。renderer、予算、profile登録を一組で検証し、未対応機能をsupportedと宣言しない           |
| 8    | 復帰・終了・負荷の実機受入（Audience、外部接続を含む）       | 切断復帰、資格失効・素材URL更新、追跡低下と再認識、hidden復帰、終了・退出・ルーム変更を通して確認する。繰り返し入退室後のCPU/GPUリソースとメモリ上限、iPhone Safari／Android Chromeでの操作・表示を検証する                                                                         |

この開発の担当範囲はAudienceアプリと接続クライアントまでとする。Backend／インフラ／ネットワークの実装・設定変更や共有契約変更は行わず、必要事項を担当者への依頼として整理する。既存契約で足りる箇所はそのまま使い、未確定のAPI名や通信方式をAudience側で共有仕様として決めない。

工程1の[接続境界・担当者への確認事項](../../app/audience/docs/connection-boundaries.md)と[適合確認](../../app/audience/docs/contract-compatibility.md)を基準に、2〜3と4〜6の通信非依存部分を進められる。4の匿名参加の実接続は資格・profile・originの提供、5〜6のライブ実接続はブラウザ通信経路の提供を待つ。待機中のfixtureはテスト専用とし、製品に模擬Backendや自動的な別経路を残さない。既存ログイン資格を使った確認は、明示的に用意された開発環境で行う任意の疎通確認であり、匿名参加の合格とは扱わない。

会場タグ設定の受理・検証と空間接合はAudienceが担当する。設定の配布元、設置poseと共有原点の対応は外部との合意事項として別途残し、この3つの外部接続課題と混同しない。

画面は各段階で必要な状態に合わせて追加する。ルーム入力→準備→位置合わせ→視聴→終了の導線をアプリ制御が持ち、通信状態・素材状態・追跡状態は別に管理する。接続失敗や失効・古い状態の拒否は4〜6から実装し、8まで先送りしない。8は復帰UIを含む一連の受入と負荷検証の段階。

## 表現対応の完成条件

工程7は次の順序で進める。各形式の読み込み成功だけでなく、進行同期・途中参加・停止状態の復元まで確認する。

1. baked-web／native-uiの配信選択とWeb描画を契約に対応させ、表示状態・透過・配置・遷移を確認する。
2. 動画の取得とデコード、runtime clockに基づく再生位置、停止・保持・途中参加を実装する。音声・透過・codecは対応表と実端末の能力に合わせてDeliveryと選択を整合させる。
3. GLBの取得・配置・材質・透過等の対応と、契約上のclip・crossfade・held状態・途中参加を実装する。
4. PNG・動画・3D等が混在するプレゼンで進行・描画・資源解放を検証し、最終Audience profileを確定する。

対応表には既存CapabilityProfileのfeatures／limitsと、Runtimeの各状態を列挙する。端末が実際に再生できる形式を宣言し、利用する配信表現を契約に従って選択する。必須表現の読み込み失敗・未対応は明示し、欠落したまま正常視聴の完了とは判定しない。

## 契約上の依存関係

最新mainの`DeliveryService.select()`は参加者のcapability／projectionを保存し、bootstrapは保存済み`projectionProfileId`を必要とする。実接続の基本順は以下。

```text
匿名viewerの確立
→ Audience capabilityによるDelivery選択・Manifest取得
→ bootstrapによる接続資格・接続先取得
→ 契約に従うControl／State接続とSnapshot／Readyの処理
→ 進行状態を反映したXR視聴
```

Deliveryで選択したprofileを同じ参加者のまま途中変更する経路は、現行実装ではconflictとなる。PNG段階から動画・3D段階へ対応表を変える場合は別profileとして登録し、新しい参加者資格・セッションで参加するか、Backend側に明示的なprofile切替契約を追加する。同じ参加者での単なる再接続・再入場で選択が解除されるとは仮定しない。capabilityを一度選択した後にクライアントだけでsupported項目を書き換えない。

最初の実接続から、publication／assignment／projection／originとsequenceの照合、期限切れ資格の拒否、準備完了の条件を実装する。素材URLの更新は同じ公開物の素材IDに対する取得先更新として扱い、別のpublicationを混ぜない。HTTPのCORS・Cache-Controlとcapabilityのメモリ予算に従い、永続キャッシュを前提にしない。

会場設定契約のrevisionと共有`presentationOrigin`のversion、端末内SDK座標の寿命は別に扱う。各観客のタグ再認識はその端末の対応変換だけを更新し、共有原点を書き換えない。

## 再利用する範囲

- `packages/contracts`の型・schema・wire契約、公開物の識別とruntime投影を基準にする。共有の純粋な検証・数値処理はブラウザ依存を確認して利用する。
- PoCの8th Wall起動、SDK報告画像取得、AprilTag Worker、姿勢推定、即時採用、SDK保持、表示専用小揺れ補正を再利用する。
- `unframe-renderer-web`は固定Browserで成果物を生成するビルド時rendererであり、Audienceの表示runtimeとして組み込まない。
- CLIのauthor preview用`local-playback`はCueを実行するため、そのままAudienceへ流用しない。Audienceは投影済み状態を適用して描画する。
- fixtureはテストに用い、製品の参加経路に模擬Backendや未実装APIへの代替経路を残さない。

## 開発の区切り

各段階を独立した機能単位でコミットする。この担当では`packages/contracts`／Backendを変更せず、必要な契約追加は所有する担当者へ依頼する。Audience内部の接続口は実装境界であり、Audience専用schemaを新しい共有契約として扱わない。PoCで確認した追跡動作の変更と、参加・素材・同期の追加を混在させない。

製品機能の追加・不具合修正は通常のTDDと対象領域の品質ゲートに従う。各段階で契約fixtureと失敗条件を確認し、4〜6と8では実サーバー・実端末で検証する。PoC時の軽いデバッグ指定は実験の履歴として残す。

## 工程0の実施記録（2026-10-22）

`origin/main`の`a5f57c04`を統合ブランチへ取り込み、10ファイルの競合を解消した。mainの管理Web／Local Editor分離、Backend、共有契約、Runtime projectionを保持し、AudienceのCI・Nix入口・開発手順を併存させた。ロックファイルは両アプリのimporterを保持してpnpmで整合確認し、固定ロックでのインストールが成功した。Audienceの追跡コードと`flake.lock`は取り込み前から変更していない。

未コミットだった本計画書の実装順と動画・3Dを含む完成範囲は保持した。次の着手点は工程1の契約と対応表の確定であり、参加・表示・同期の新機能はこの統合では実装しない。

統合後の検証結果:

- `nix run .#audience`: 型検査・lint・111テスト・ビルド成功。
- `nix run .#web`: 型検査・lint・25テスト・ビルド成功。既存のbundleサイズ警告あり。
- `nix run .#local-editor`: 型検査・lint・91テスト・ビルド成功。
- `nix run .#realtime`: vet・lint・test・build・race成功。
- `nix flake check`: macOS arm64で成功。既存のapp meta等の警告と、Linux実行検証が含まれない点は従来どおり。
- `nix develop --command pnpm install --frozen-lockfile --ignore-scripts`: 成功。
- 関連workflow 4件の`actionlint`、シェル入口の`bash -n`、競合マーカー・差分検証: 成功。
- `nix run .#check`: CLIで2件失敗し中断（412件成功・2件失敗）。`react-project.test.ts`の凍結アーカイブ復元は前回同様のUTF-8エラー。`reference-project.test.ts`のlocal closure更新は一時`.unframe-source.lock`のENOENTであり、同じテストの単発再実行は成功した。CLIソースはmainと同一で、この統合で修正していない。全体ゲート成功とは扱わない。

カメラ実機の再測定、管理Web／Local Editorの独立したE2E、Unity Editorテストは今回実行していない。追跡コードの変更はなく、対応する代替検証は上記の個別ゲートと差分の同一性確認で行った。

### 作業中に更新されたmainの追加取り込み

最終確認でmainにPR #163（動画・3Dモデルの素材・Authoring・Runtime対応）が追加されていたため、`5219fa91`も追加で取り込んだ。追加分は競合なくマージできた。統合コミットは`f4664ce9`（`a5f57c04`の競合解消）と`bb87b14e`（`5219fa91`の追加取り込み）。

追加後もmainのBackend・共有契約・Web・Local Editor・Unity・Runtime・CLIはmainと同一、Audienceの実装と`flake.lock`は取り込み前と同一である。main由来のUnity生成資産の空白形式は変更せず、PRの差分検証は最新main基準で成功した。

追加後の`nix run .#audience`（111テスト）、`nix run .#web`（25テスト）、`nix run .#local-editor`（92テスト）は型検査・テスト・ビルドまで成功。`nix run .#realtime`もvet・lint・test・build・race成功。追加分の依存インストールは固定ロックで成功した。`flake.nix`／`flake.lock`は最初の統合検証後に変化していない。

追加mainでの`nix run .#check`はCLIで3件失敗した（484件成功・3件失敗）。凍結アーカイブ再作成のUTF-8エラー1件と、`source-assets.test.ts`の動画metadata／transform identity取得の5秒タイムアウト2件。全体ゲートは失敗として記録し、成功した個別ゲートで代替検証した。これらのCLIコードは最新mainと同一であり、他アプリの修正は行っていない。

共通設定のAudience独自差分は、Audience用CI／Nixコマンド・共通チェック呼出し・パス定義・依存追加・vendor／生成コードのformat/lint除外である。他アプリのruntimeや共有契約への独自変更はない。共通CIにはAudienceの検証が追加されるため、その結果も集約CIの成功条件となる。

## Audienceの責務分離の実施記録（2026-10-22）

工程2のコード分離を実施。画面を`AnchorExperienceView`、Reactとの接続を`useAnchorExperience`、起動・停止・待機と破棄を`createAnchorSession`、位置合わせ状態を`createTagAnchorState`、JSON出力を`diagnostic-export`へ分けた。SDK／カメラ／Workerの所有は既存adapter、表示と小揺れ補正は既存rendererに維持した。Backend・共有契約・依存・設定は変更していない。

開始・停止・再開始・権限待ち／検出準備中の取消、単一観測採用と失効条件、設定失敗時の診断保存をTDDで確認。`nix run .#audience`は122テスト・型検査・lint・build成功。実機でのカメラ精度と入退場の再確認は未実施であり、機器を用いた受入とは区別する。次の実装対象は会場／プレゼン座標の接合と契約fixtureによるPNG描画。

全体ゲート`nix run .#check`はCLIの`react-project.test.ts`「recreates v1 from a frozen pnpm archive without running package scripts」で既知のUTF-8エラーが再発し失敗した（CLIは486件成功・1件失敗）。ログは`/tmp/audience-refactor-full-check.log`。後続の集約チェックは実行されておらず、Audienceの代替検証は個別の`nix run .#audience`（122件成功、型・lint・build成功）で行った。CLI・Backend・共有契約・設定の差分はない。全テスト成功を要求するgit-commitスキルの条件を満たさないため、コミットは未作成。

## プレゼン座標接合の実施記録（2026-10-22）

Audience内部工程2（本表の責務分離の次に行う空間接合作業）を実装した。`presentationToVenue`をプレゼン基準から会場基準への変換（会場内での配置）として利用し、共有Runtime originの受け口を独立したGroupとして設けた。合成は`displayedSdkFromMarker × inverse(venueFromMarker) × venueFromPresentation × presentationOrigin × node local chain`。小揺れfilterはマーカーpivotのまま維持し、raw位置・共有origin・ノードのlocal transformへ混ぜない。

位置確認用に1m軸と幅1m・高さ0.5625mの枠を表示する。共有originは未接続のidentityで、実Snapshot受理やPNG描画の実装は含まない。非一様scaleを含む親子合成・原点変更・追跡低下・再認識・filter分離・ガイド破棄をテストし、`nix run .#audience`は128テスト・型・lint・build成功。全体`nix run .#check`は変更していないCLIの既知UTF-8エラー1件（486成功・1失敗）で失敗。実機受入は未実施、コミットは未作成。次は既存契約fixtureによるPNG描画へ進める。

## Audience内部工程3：契約PNG描画の実施記録（2026-10-22）

既存Deliveryの選択済PNGとportable ParticipantRuntimeViewを使う`buildPngPlan`、PNG取得／検証、Three.js描画、sessionの`presentPng`入口を追加した。既存RenderBundle／AssetSetManifestのfixtureとProtobuf往復したDelivery fixtureをテストに使用する。logical boundsと物理寸法、fit／cover clip／UV、state binding、sRGB・alpha・opacity・active／visible、親子TRS、共有原点を反映する。未対応renderer／active run等は拒否し、省略して成功とは扱わない。

現在の画面へfixture自動読込・模擬Backendは追加していない。接続制御が有効なDeliveryとSnapshotを取得して`presentPng`へ渡す統合は工程4〜5で行う。工程3は描画モジュールとfixtureテストの実装完了で、実機画素・素材実取得の受入完了ではない。

Audienceのworkspace依存に`@unframe/contracts`を追加し、pnpm-lockのAudience importerのみを更新した。Backend・共有契約・CI・インフラ設定は変更していない。`nix run .#audience`は155テスト・型・lint・build成功、PNGモジュールのブラウザbundleも成功。実デコード／GPU出力はテストダブル使用で未実機検証。次の対象はSnapshot・更新イベントからの状態適用と、HTTPクライアントの接続である。

工程3の全体検証`nix run .#check`はCLI `react-project.test.ts`の凍結アーカイブ復元で既知のUTF-8エラー1件により失敗（CLI486成功・1失敗）。後続の集約チェックは未実行。ログは`/tmp/audience-png-full-check.log`、Audience個別の成功ログは`/tmp/audience-png-check.log`。代替検証としてAudienceの155テスト・型・lint・buildとPNGモジュールのブラウザbundleを確認した。全テスト成功を要するgit-commitスキルの条件を満たさないため未コミット。

## 工程3のレビュー修正（2026-10-22）

3件の指摘を修正した。透明Surface間をcamera深度、同Surface内をlayerで並べる描画前更新を追加。旧bitmapを含む置換時CPU予算を取得前に検査し、取消ロードが解放されるまで次のロードを直列化する。texture bindingsの集計をplane数からchecksum単位のunique PNGへ修正し、別asset IDの同一PNGも共有する。失敗時の旧表示維持、SDK描画callbackの保持・復元もテストした。

Audienceの167テスト・型・lint・build成功（chunkサイズ警告あり）。実機描画は未検証。サーバー・共有契約・インフラ設定は変更していない。

レビュー修正後の`nix run .#check`はCLIの凍結アーカイブ復元で既知のUTF-8エラー1件により失敗した（CLI486成功・1失敗）。後続集約チェックは未実行。代替検証としてAudienceの167テスト・型・lint・buildを確認済み。ログは`/tmp/audience-review-fixes-full-check.log`と`/tmp/audience-review-fixes-check.log`。全テスト成功条件を満たさないためコミットは引き続き保留。

## Audience内部工程4：進行状態適用の初期実装（2026-10-23）

既存契約のConnectionSnapshot、Reliableイベント、State keyframe／deltaを受け取るRuntime storeと、PNG描画へ渡すplaybackを追加した。sessionの`openRuntime(delivery)`が受け口を所有し、停止・scene破棄で破棄する。Wire変換、状態検証・保持、描画、通信の責務を分離した。NodeのTRS・active・visible・opacity、Surface cut切替、原点、同じGroup内のStep、停止・終了を反映する。同じ素材の状態更新はtextureを再取得しない。

Controlの順序抜け・不一致・不正入力は表示を消し再同期要求とする。接続側がreset後にSnapshotを渡すことで復帰する。Stateのgap・fence不一致・未到達baseはframeを捨て、表示とControlを維持してkeyframeを待つ。古いState、Snapshotの巻き戻し、State接続通知の重複、停止後の遅延入力を検証した。StateReady／Replay要求の生成・通信経路・HTTP接続・画面からの取得は未実装。

工程4全体は進行中。今回の範囲は静的PNGであり、Group所有リソース／Group切替・Timeline／active run・アニメーション遷移・変数・Presenter anchor・Local Overlay・動画／model状態は未対応として拒否する。実機・実サーバーとの受入は未実施。Backend・共有契約・共有設定は変更していない。

工程4の最終個別検証: `nix run .#audience`で215テスト・型検査・lint・buildが成功した。ビルドには既存の大きなchunk警告がある。実機・実ネットワークでの受入は未実施。

全体検証`nix run .#check`は、Audience外のCLI `react-project.test.ts`の凍結アーカイブ復元で既知のUTF-8エラーが再発し失敗した（CLI486成功・1失敗）。後続の集約チェックは未実行。代替検証はAudience個別ゲートの215テスト・型・lint・build成功。ログは`/tmp/audience-runtime-final-full-check.log`と`/tmp/audience-runtime-final-check.log`。コミットは作成していない。

## Audience内部工程4：Group切替（2026-10-23）

現在のGroupとpresentation所有のNode／Surfaceを対象に状態を受理・描画する。GroupExitedで旧Groupの状態を破棄し外部viewをnullにして表示を消す。GroupEnteredの完全な初期状態を検証し、StepEnteredで新しい安定状態を公開する。presentation所有の状態は維持する。退出時に旧描画・素材を破棄し、新しいGroupの素材を読み込む。切替中と切替前の古いbaseのStateを新しいGroupへ適用しない。

PNG計画も現在Groupとpresentation所有のリソースに限定する。ロード済み素材だけで更新できる場合は再取得せず、不要textureを解放する。新しい素材が必要なら既存の予算検査・取消・ロード失敗処理を通す。契約fixtureを基にしたGroup切替をRuntimeと実PNG描画モジュールの結合テストで確認した。画像デコードはテストダブルであり、実機・GPU・実通信の受入は未実施。

Timeline・active run・アニメーション遷移・変数・Presenter anchor・Local Overlay・動画／GLB・実通信は残作業。共有契約・Backend・インフラ・依存・設定の追加変更は行っていない。

Group切替の最終個別検証: `nix run .#audience`で232テスト・型検査・lint・build成功。既存のchunkサイズ警告がある。実機・GPU・実サーバー素材取得は未検証。ログは`/tmp/audience-group-root-final-check.log`。

Group切替の全体検証`nix run .#check`はAudience外のCLI `react-project.test.ts`凍結アーカイブ復元の既知UTF-8エラー1件で失敗（CLI486成功・1失敗）。後続の集約チェックは未実行。代替検証はAudience個別ゲートの232テスト・型・lint・build成功。全体ログは`/tmp/audience-group-full-check.log`。コミットは未作成。

## Audience内部工程4：TimelineとSurfaceクロスフェード（2026-10-23）

RunのWire変換・整合性検証、Timeline開始／完了／取消、Surface transition開始／完了を追加した。Delivery catalogとportable viewからruntime時刻の表示状態を導出する純関数と、受信時計／ローカル単調時計の対応を分離した。pause／resume、途中参加、4easing、Quaternion最短補間を扱う。表示上の終点でサーバーの完了・進行判断を代行しない。

XR描画前に素材準備済みviewを評価し、既存mesh・materialの値だけを更新する。静的表示は補間しない。クロスフェードはSurface内の全partitionを状態ごとにpremultiplied RGBA合成した後でfrom／toを混合し、empty端点と両素材の予算を検査する。重なるpartitionも状態全体で合成する。Surface shaderのunique textureは8枚までとし、超過を取得前に拒否する。素材は完了イベント後に不要分を解放する。Timeline中と累積opacityが1未満のSurfaceも合成後に透過を掛ける。Timeline所有fieldへのState上書きは拒否し、Run lifecycle前の遅延Stateは次keyframe待ちへ分離する。

Snapshotのtransitioning／pendingNextは受理する。StartedイベントにはpendingNextが無いため、Flowの再実行や進行先の推定をせず、後続Step／Groupイベントに従う。変数・Anchor／Local Overlay・動画／GLB・HTTP／実通信は残作業。ネットワーク遅延／端末間時計差の測定・補償、実GPUのshader画素とカメラ同時負荷は未検証。共有契約・Backend・設定・依存の追加変更はない。

Timeline／遷移の全体検証`nix run .#check`はAudience外のCLI `react-project.test.ts`凍結アーカイブ復元の既知UTF-8エラー1件で失敗（CLI486成功・1失敗）。後続の集約チェックは未実行。全体ログは`/tmp/audience-animation-full-check.log`。実機GPU／実通信の受入は未実施、コミットは作成していない。

Timeline／遷移の最終個別検証: `nix run .#audience`で271テスト・型検査・lint・build成功（既存chunkサイズ警告あり）。さらに一時ローカル検証ページをChrome headless／SwiftShaderで描画し、shaderコンパイルと重なる背景／前景の画素を確認した。linear RGBA8でcrossfade中間値`[128,0,0,255]`、合成後opacity=0.5の値`[128,0,0,128]`が成功。検証ページと一時サーバーは削除・停止した。実iPhone GPU・カメラ同時負荷・実通信の同期精度は未検証。ログは`/tmp/audience-animation-composite-final-check.log`と`/tmp/audience-animation-gpu-output.html`。

## Audience内部工程4：変数とViewer入力状態（2026-10-23）

SnapshotとVariableChangedの変数をcatalogのScalarType／ownerへ照合して適用する。現在Groupの完全性と型を検証し、退出でGroup変数を破棄、入場／再入場で初期化する。presentation変数は維持する。PNGの文字や素材を変数から再生成せず、値の受理・保持と描画bindingを分離する。native-ui動的bindingは未対応。

入力状態を調べた結果、既存契約のenabledLogicalInputsはPresenter専用、Viewerでは常に空であり、更新用差分イベントはない。Runtime受け口でDelivery role=Viewer（2）を要求し、Snapshotの空入力を検証する。LogicalInputAcceptedは通知として扱い、入力有効化・進行コマンド送信・Cue／Flow再実行は行わない。Wire変換・PNG低水準処理へ資格検証の責務を移さず、参加・通信から受け取るRuntime入口で検証する。

共有のpresenter fixtureは原本を変更せず、Audience RuntimeテストのcloneをViewer用に調整した。Backend・共有契約・依存・設定は変更していない。残る接続作業はHTTP join／Delivery／bootstrap、通信・再同期要求、素材readinessと実機受入。動画／GLB・Anchor／Local Overlayは未対応のまま。

変数／Viewer入力状態の最終個別検証: `nix run .#audience`で303テスト・型検査・lint・build成功（既存chunkサイズ警告あり）。変数更新からPNG描画までの結合、素材再取得なし、Viewer入力の無効維持、Presenter／不正Viewer Snapshot拒否を確認した。実通信・実機での受入は未実施。ログは`/tmp/audience-variables-root-check.log`。

変数／Viewer入力状態の全体検証`nix run .#check`はAudience外のCLI `react-project.test.ts`凍結アーカイブ復元の既知エラー1件で失敗（CLI486成功・1失敗）。後続の集約チェックは未実行。代替検証はAudience個別ゲートの303テスト・型・lint・build成功。全体ログは`/tmp/audience-variables-full-check.log`。Backend・共有契約・依存・設定の追加変更はなく、コミットは未作成。

## スマホ向けfixture表示画面（2026-10-23）

開発時だけ`?fixture=1`で開ける専用画面を追加した。既存AnchorSessionとRuntime受け口を使い、明示的カメラ開始後にViewer用Snapshotと11個のControl更新を手動適用する。1m幅PNG A／B、移動・透過Timeline、pause／resume、クロスフェード、変数、Group切替、終了を確認できる。黒い外周15／24cmを選択し、再初期化・停止・状態JSON保存を備える。

固定テスト時刻のためクリック間隔はRuntimeと一致しないこと、サーバー未接続であることを明示する。本番bundleにはfixtureコードとPNGを入れず、同一originの開発用PNGを既存HTTPS／hash／寸法検証経由で取得する。既存一時トンネルを接続する開発サーバーは4175番。Backend・共有契約・依存・設定を変更していない。

Chrome／SwiftShaderでHTTPS経由の実素材取得・デコード・Snapshotと全11操作・WebGL描画まで確認した。スマホ幅の画面表示を確認したが、iPhoneカメラ・タグ・GPU同時負荷の受入は未実施。通常画面と実接続をfixtureで置き換えない。

fixture画面の個別検証: `nix run .#audience`で312テスト・型検査・lint・build成功（既存chunkサイズ警告あり）。本番distにfixture画面文言・scenario・テストPNGが含まれないことも確認した。Chrome／SwiftShaderでHTTPS実素材の取得・hash検証・decode・Snapshotと全11操作・非空画素の描画まで成功。個別ログは`/tmp/audience-fixture-check.log`、ブラウザ結合ログは`/tmp/audience-fixture-render-output.html`。iPhone実機カメラ受入は未実施。

最終の停止履歴／追跡状態修正後は313テスト・型検査・lint・build成功。本番distへの非混入も再確認した。全体`nix run .#check`はAudience外のCLI凍結アーカイブ復元の既知UTF-8エラー1件で失敗（CLI486成功・1失敗）、後続集約チェックは未実行。代替検証は個別Audienceゲート。ログは`/tmp/audience-fixture-final-check.log`と`/tmp/audience-fixture-full-check.log`。未コミット。

## fixture実機報告の修正（2026-10-23）

カメラ許可後に約2倍拡大される問題は、fixture canvasのCSSがSDKのinline backing pixel寸法に負けることが原因だった。通常画面と同じ100% important指定へ揃え、カメラFOV・source画像・内部行列は変更しない。ブラウザで2倍拡大のRedと、DPR1／2／3相当の寸法一致のGreenを確認した。

検出器のDEVロード失敗はViteの相対動的import queryによるpublic moduleのsource変換が原因。同一origin絶対URLへ解決して実Worker初期化のRed→Greenを確認。共有設定・Backend・vendor配布物は変更していない。

修正後の個別検証: `nix run .#audience`で314テスト・型検査・lint・build成功（既存chunkサイズ警告あり）。Chromeの実module WorkerでAprilTag WASM初期化とtag36h11 ID 0検出も確認した。レイアウト検証ではDPR1／2／3相当のinline backing寸法に対し表示寸法がviewportへ一致。SDKのカメラFOV・内部行列・source画像解像度は変更していない。iPhone実機での再確認は未実施。ログは`/tmp/audience-fixture-camera-fixes-check.log`、`/tmp/audience-detector-browser-final-green.log`、`/tmp/audience-fixture-layout-final.html`。

今回の全体`nix run .#check`はAudience外のCLI凍結アーカイブ復元の既知UTF-8エラー1件で失敗（CLI486成功・1失敗）。後続集約チェックは未実行。代替検証は個別Audienceの314テスト・型・lint・buildと実ブラウザ検証。全体ログは`/tmp/audience-fixture-camera-fixes-full-check.log`。未コミット。

## プレゼン進行後のカメラ停止報告への対応（2026-10-23）

受領checkpointは操作2のpause後にtracking error／Runtime resetで、元のエラー詳細を保存できていなかった。画面文言からframe-source停止経路を確認した。実SDK GlTextureRendererとThreeの共有contextで、旧material.dispose後のSDK描画が1282を発生させる問題を再現。renderer.resetStateを先行させると発生しないことを確認した。

SDK rendererの状態解除操作をsessionへ渡し、表示交換・破棄前に実行する。source取得前のGLエラーと取得中のGLエラーを診断上分離し、context loss／取得自身のエラーは停止を維持する。fixtureチェックポイントに取得診断と最後の正常Runtime概要を追加し、停止後のreset状態だけで原因を失わないようにする。実iPhoneで報告症状が解消したかの再確認は未実施。

fixtureチェックポイントをschemaVersion 2へ更新し、tracking.error・camera取得diagnostics・GL errorsのbefore-capture／capture区間・最後の正常Runtime概要を保存する。画像や素材URLは含めない。現在Runtimeが停止後awaiting-snapshotへresetされてもlastReadyRuntimeで直前状態を区別する。

最終個別検証は`nix run .#audience`で325テスト・型・lint・build成功（既存chunk警告あり）。停止時のリソース解除順、既存GLエラーと自身の取得失敗の分離、schema2診断、カメラ停止後の再試行を検証した。実SDK GL再現は修正前1282／resetState後エラーなし。全体`nix run .#check`はCLI凍結アーカイブ復元の既知UTF-8エラー1件で失敗（CLI486成功・1失敗）、後続集約チェックは未実行。ログは`/tmp/audience-camera-progress-final-check.log`、`/tmp/audience-camera-progress-full-check.log`、`/tmp/audience-sdk-resource-repro.html`。iPhone実機での症状解消確認は未実施、未コミット。

## HTTP参加クライアント（2026-10-23、実装順序表の工程5）

通常入口にルーム参加画面を接続した。HTTPクライアント、接続状態制御、React表示をAudience内で分離し、既存join → Delivery → bootstrapを使う。Control Planeの生成型と共有Delivery Protobufを再利用し、Backend・共有契約・CI・インフラ・依存は変更しない。

Cookie identityを既存APIへ送信するが、匿名資格発行やログイン操作は作らない。API originと登録済Audience profile IDをVite環境変数で提供する。未設定は接続不可として案内する。HTTP応答、Viewer、同session・profile・publication・assignment、資格・素材URL期限を検証し、取消・退出・再取得・破棄を扱う。機密値は公開状態やログへ出さずメモリだけに保持する。

preparedはHTTP接続情報の取得完了。Realtime通信・Snapshot受信・Ready・素材readiness・実プレゼン描画完了ではない。新しい公開物やprofileを同じ接続へ混在させない。匿名identity延長・自動資格更新・永続復帰は未実装。退出はローカル破棄のみ。開発用fixtureは従来のURLを維持し、位置合わせ単独画面は `/?tracking=1` に移した。

実接続受入には外部担当から匿名viewer資格、Audience profile登録、HTTP origin/Cookie許可、実テストsessionの提供が必要。ブラウザ用Realtime経路も引き続き外部依存。

検証: `nix run .#audience` は383テスト・型検査・lint・build成功（既存の大きなchunk警告あり）。HTTPの実clientと接続制御をJSON／Protobuf応答で結合し、Viewer／fenceの不一致、401、取消後の遅延完了、資格・素材URLの最短期限、タイマー停止中の利用時検査、同公開物のassignment更新を検証した。Chromeで参加画面の表示を確認。実Backend・匿名参加・ライブ受信の受入は未実施。

`nix run .#check` はAudience外の `packages/unframe-cli/test/react-project.test.ts` の既知の `semantic/cli-lock-update-failed: The encoded data was not valid for encoding utf-8` で失敗（CLI486成功・1失敗）。後続の集約チェックは未実行であり、合格とは扱わない。Audienceは上記個別ゲートで検証した。ログ: `/tmp/audience-connection-final-check.log`、`/tmp/audience-connection-full-check.log`。コミットは未作成。

## 動画・GLB表示（2026-10-23、工程6）

既存Delivery／Runtime契約でH.264 MP4と自己完結GLBを実装した。取得検証、Surface合成、動画decoder、AnimationMixerを分離。media/modelのSnapshotと再生・停止・seek・完了・取消・crossfadeイベントを受理し、Runtime時計から表示をsampleする。PNGと動画の同Surface合成を共有し、再生自動許可の拒否状態と追跡低下／ページ非表示時pauseを扱う。モデルの既知CPU・埋込texture予算はPNG／動画予約量と合算する。ブラウザdecoder内部メモリは実機測定待ち。

fixture画面に通常15操作・2秒地点からの途中参加13操作を追加。実素材によるChrome／SwiftShaderの通常／途中参加・動画画素変化・GLB解析／描画・WebGL error=0・終了時root撤去を確認。Audience444テスト・型・lint・build成功。iPhone Safariカメラ同時負荷・音声・長時間測定・実Realtimeは未検証。対応制約と操作はapp/audience/README.mdへ記録した。

Backend・共有契約・依存・CI・インフラへの追加変更なし。全体ゲートは既知CLI凍結アーカイブUTF-8エラー（486成功・1失敗）で停止、後続未実行。/tmp/audience-media-final-check.log と /tmp/audience-media-full-check.log。未コミット。

## Android NORMAL待機の診断追加（2026-10-23）

Galaxy／Chromeではカメラは起動するがNORMAL待機から進まないとの報告。写真のschema2ログは追跡診断を除外していたため、原因は未確定。画面にSDK起動段階・更新／reality／有効pose回数・最終更新経過・生追跡状態／理由／イベントとセンサー受信の有無を追加。JSONにも安全な項目を追加した。センサー生値は保存せず、追加権限要求や追跡判定の変更は行わない。Galaxyでの原因確定は新ログ待ち。

起動診断の個別検証: `nix run .#audience` は452テスト・型検査・lint・build成功（既存chunkサイズ警告あり）。Chromeでfixture画面のSDK処理表示を確認。センサー生値を保存しないこと、停止時listener撤去、再開始時reset、NORMAL前のpipeline更新記録、JSONの安全な項目出力をテストした。Galaxy実機での再確認は未実施。個別ログ: `/tmp/audience-startup-final-check.log`。

全体検証 `nix run .#check` は既存CLI `react-project.test.ts` の凍結アーカイブ復元で既知のUTF-8エラーにより失敗（CLI486成功・1失敗）。後続の集約チェックは未実行。ログ `/tmp/audience-startup-full-check.log`。今回の追加はAudienceと関連記録のみ、未コミット。

## 視聴UI整理（2026-10-24）

ルーム入力、カメラ許可／SDK NORMAL待ち、マーカー認識、視聴を表示段階として分離。Material Design 3参考の青緑・明色・丸角へ統一。カメラ待機と認識はカメラ背景、認識と視聴は最小表示とし、診断・設定・fixture操作はメニューへ移した。showGuidesで視聴用の箱・軸・1m枠を除き、位置合わせ確認画面には残す。

HTTP prepared後に明示的なカメラ開始画面へ進み、資格失効・退出で破棄する。ライブ未接続なので通常参加では位置合わせ後に配信待ちとする。fixtureは素材準備完了＋有効タグ後に視聴画面へ進む。Backend・共有契約・認証・追跡条件・依存への追加変更はない。スマホ幅の画面検証とUI遷移テストを行い、XR精度実験は追加しない。

UI変更の検証: `nix run .#audience` は459テスト・型検査・lint・build成功（既存chunkサイズ警告あり）。画面段階、視聴中の最小UI、メニュー操作、HTTP prepared後のカメラ画面、退出／資格失効、検証ガイド非表示を確認。ログ `/tmp/audience-ui-final-check.log`。本番bundleに動画／GLB fixtureを含まないことを確認。

全体ゲート `nix run .#check` は今回未変更の `packages/unframe-compiler/test/video-compilation.test.ts:245` の `preserves baked/video/baked paint order with complete independent ownership` が5000msタイムアウト（compiler387成功・1失敗）で停止。後続集約チェックは未実行で、全体成功とは扱わない。設定・timeoutは変更しない。ログ `/tmp/audience-ui-full-check.log`。変更は未コミット。

## Draft更新前レビュー（2026-10-24）

契約・進行状態、素材取得と描画、UIと追跡を分けて確認し、次の3件を回帰テスト付きで修正した。

- 適用済みControlより古いStateのbaseを拒否し、確定したNode位置・表示状態の巻き戻しを防ぐ。表示は維持してState keyframeを待つ。
- PNGのIHDR構造と実寸を画像デコード前に照合し、宣言寸法による予算検査をすり抜けた画像を先に展開しない。
- マーカーサイズ変更時に検証用ルートのqueryとhashを保持し、再読み込み後も検証画面へ戻れるようにする。

最終Audience個別ゲート `nix run .#audience` は52ファイル・467テスト、型検査・lint・本番buildが成功。ログは `/tmp/audience-pr-final-check.log`。既存の500kB超chunk警告は残る。実Backend／Realtime接続とAndroidのNORMAL待機問題の解決を完了扱いにしない。今回の追加差分はAudience本体、関連文書、既存contractsを参照するAudience importerの依存ロック3行のみ。共有契約・Backend・CI・Nix設定の追加変更はない。

今回の `nix run .#check` はControl Planeの検査を通過後、Audience外の `packages/unframe-compiler/test/video-compilation.test.ts:245` の `preserves baked/video/baked paint order with complete independent ownership` が5000msタイムアウトし停止した（compiler387成功・1失敗）。後続集約チェックは未実行。全体成功とは扱わず、対象外のコードやtimeout設定は変更しない。ログは `/tmp/audience-pr-full-check.log`。ユーザーの現状保存・push依頼に従ってDraftへ反映し、この検証制約をPRへ明記する。
