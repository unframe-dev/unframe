# Audience Webアプリ開発への移行

- 更新日: 2026-10-22
- 状態: 位置保持PoCはユーザー承認により完了。Webアプリの製品機能はこれから実装する。
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

Unframeは無償。会場の観客はログイン・登録なしでサイトを開き、ルームIDを入力して参加する。会場内で登壇者と同じ空間・進行を視聴する。現PoCのカメラ画面だけでルーム参加・プレゼン再生が実装済みとは扱わない。

完成範囲はユーザー指定により、動画・3Dモデルも含めたUnframeの対応表現の視聴とする。PNGだけの取得・表示・進行同期は中間目標であり、アプリ完成とは扱わない。既存契約のbaked-web、native-ui、video、modelと各Runtime状態に対するWeb側の対応表を工程1で作成し、Web向けの配信選択と実装範囲を明示する。未対応の必須表現を黙って省略して完成とはしない。

## 実装順序

最初の実用上の到達点を「ログインなしでルームへ参加し、実サーバーの公開成果物をXR表示し、登壇者の進行に合わせてPNG表示が更新されること」とする。段階ごとに取得・表示・状態反映を結び、独自の簡易通信契約は作らない。0〜6で最初の実用的なPNG視聴を成立させ、その後の動画・3Dを含む表現対応と総合受入までを必須の実装順とする。

| 順序 | 実装範囲・担当                                                             | 完了条件                                                                                                                                                                                                                                                                  |
| ---- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | 完了：最新mainとの統合（統合ブランチ）                                     | Draft PRのCI・共通文書・ロック等の競合を解消し、共有契約とアプリの依存を現行mainへ揃える。Node.jsのセキュリティ更新はこの作業へ混在させない                                                                                                                               |
| 1    | Audienceの契約と初期対応表（contracts／Control Plane／Realtime／Audience） | 匿名viewerの資格と寿命、ルームID解決、単一AprilTagの実寸・会場配置・revision、Audience capability、ブラウザtransportと既存Realtimeメッセージとの対応を定義する。初期PNG対応とCPU/GPU予算・非対応表現を明示する                                                            |
| 2    | アプリ基盤と追跡の分離（Audience）                                         | XrHost、Localization、Renderer、アプリ制御、診断UIにPoCの責務を分ける。採用済みの検出・確定・保持・小揺れ補正を維持し、開始・停止・再入場でカメラやWorkerが重複しない                                                                                                     |
| 3    | 契約データの表示（Audience）                                               | 既存RenderBundle／AssetSetManifest／Delivery／ParticipantRuntimeViewのfixtureをテストに用い、PNG、sRGB・透過、寸法・座標・表示状態をThree.jsへ反映する。ページ番号だけの独自データモデルで代用しない                                                                      |
| 4    | 匿名参加と実プレゼン取得（Control Plane／Audience）                        | ルームIDから匿名viewerを確立し、Audience profileでDelivery選択、公開物取得、bootstrapまで進む。署名URLの期限、素材の整合、会場設定、参加不可・終了済み・非対応表現を扱う                                                                                                  |
| 5    | 初期進行状態の取得・反映（Realtime／Audience）                             | ブラウザ用adapterとRealtimeClientを接続し、Control／State、handshake、projection、Snapshot、Ready通知を契約どおり処理する。途中参加でも現在状態をXR表示し、Snapshot適用前や異なる世代の状態は描画へ反映しない                                                             |
| 6    | ライブ進行の取得・反映（Realtime／Audience）                               | sequence／fence／originの整合を維持し、投影済みstate・reliable event・runtime clockから表示対象、transform、opacity、遷移・Timelineを更新する。サーバーの進行判断をブラウザで再実行しない。基本的なReplay／再同期も実装する                                               |
| 7    | 動画・3Dを含む表現対応（Audience／Control Plane）                          | 動画とGLBを必須対象とし、再生・停止・途中参加・同期、model clip・crossfade・held状態など既存契約が定義する再生状態を反映する。baked-web／native-uiのWeb向け表示方式も対応表に従って実装する。renderer、予算、profile登録を一組で検証し、未対応機能をsupportedと宣言しない |
| 8    | 復帰・終了・負荷の実機受入（Audience／Backend）                            | 切断復帰、資格失効・素材URL更新、追跡低下と再認識、hidden復帰、終了・退出・ルーム変更を通して確認する。繰り返し入退室後のCPU/GPUリソースとメモリ上限、iPhone Safari／Android Chromeでの操作・表示を検証する                                                               |

1完了後、Backendの匿名参加・profile・会場設定・ブラウザtransportは、Audienceの2〜3と並行して進められる。4は参加・Delivery側、5はRealtime側のBackend実装が利用可能になってから実接続する。実装するAPI・イベント・fixtureは同じ共有契約を使用する。

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

各段階を独立した機能単位でコミットする。契約追加は所有する`packages/contracts`／Backendで実装し、Audience専用schemaを共有契約として扱わない。PoCで確認した追跡動作の変更と、参加・素材・同期の追加を混在させない。

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
