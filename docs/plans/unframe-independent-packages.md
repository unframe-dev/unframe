# Unframeの独立パッケージ化

## 方針

各責務を独立したworkspaceパッケージにする。subpathだけで層を分けず、各パッケージにmanifest、公開API、型検査、関連テストを持たせる。最終配布は`vp pack`を使う。

- 後方互換性を提供しない。旧exportのalias、旧schema parser、互換migrationは追加しない。
- Presentation系成果物・Capability・Runtime Snapshot・Deliveryと`unframe.lock`の`schemaVersion`はリリース確定まで`1`に固定する。protocol namespace、epoch、隔離policyのversionとは区別する。独立したAudience tracking/fiducialのschemaは対象外とする。
- schema変更と利用側・生成物の変更を同時に行う。旧番号や旧形式へのfallbackは設けない。
- `schemaVersion`をキャッシュキーや互換性の証明に使わない。Source・素材・依存・Compiler・Renderer・実行環境の内容identityをBuild入力に含める。
- 既存の`packages/unframe/*/ARCHITECTURE.md`は移行先の設計根拠にしない。

## 目標の所有者と公開境界

パッケージは`packages/unframe/<責務>/`に配置し、`@unframe/<責務>`として公開する。`contracts`とAPI clientは既存の配置を使用する。

| パッケージ     | 所有する責務・主な入出力                                       |
| -------------- | -------------------------------------------------------------- |
| contracts      | 永続化・HTTP・wireのschema、Local Editor向け要求・応答         |
| authoring      | 宣言schema、DSL、JSX、Component・Theme宣言                     |
| source         | 固定Source → 宣言・位置情報、編集命令 → 前提hash付きpatch      |
| presentation   | 解決済みモデル、意味的不変条件、共通Layout                     |
| compiler       | 宣言・素材情報 → 解決済みPresentation・Render/Media Plan       |
| artifacts      | 生成結果 → 正規化済み成果物、hash・素材・Manifestの整合性検証  |
| playback       | 現在状態・event・time → 次状態・参加者向け投影                 |
| delivery       | 許可済みrole・Capability・成果物 → 素材選択・Profile・配信計画 |
| workspace      | Source revision、依存固定、snapshot、保存transactionの規則     |
| author-service | Source解析・patch生成・Workspace保存の編集ユースケース         |
| build          | 固定Build入力、段階実行、進捗・取消・成果物commit              |
| preview        | 表示ArtifactとPlayback状態の所有・一括切替                     |
| publish        | 固定Artifactの公開、fence、公開結果の照会                      |
| workspace-node | Filesystem、directory FD、atomic保存、journal永続化            |
| render-browser | 固定BrowserでのStructured/Opaque描画、capture・geometry        |
| media-node     | PNG/GLB変換、動画検査と外部ツール接続                          |
| styles-node    | 固定Source・依存によるPostCSS実行                              |
| worker-host    | OS隔離、資源制御、期限・取消・後始末                           |
| cli            | 引数、TUI、ローカルHTTP、Adapterの組立、結果表示               |

`build`、`preview`、`publish`、`author-service`を一つの`toolchain`パッケージにまとめない。CLI固有の型をLocal Editorへexportしない。

SourceとCompilerは外部環境を再探索しない。描画・素材・CSS・保存・公開のportは、それを必要とするユースケースが所有し、Adapterを組み立てる入口から注入する。

## 状態と成立点

| 状態                         | 所有者              | 成立点                                             |
| ---------------------------- | ------------------- | -------------------------------------------------- |
| 編集Source・revision・lock   | workspace           | 前提revision/hashを確認した保存transactionのcommit |
| Build入力・進捗・取消        | buildのjob          | 完成Artifactの保存先commit                         |
| 完成Artifactと出力世代       | Artifact保存Adapter | expected generationを検査したatomic commit         |
| 表示Artifact・再生状態       | previewのsession    | Artifactと初期再生状態の一括交換                   |
| 送信対象・公開結果           | publishのjob        | サーバーのpublication receipt確認                  |
| 認可・公開状態・Access Grant | Control Plane       | サーバー側のtransaction                            |
| 正規のSession Runtime状態    | Realtime            | サーバー側Runtimeの状態遷移                        |

取消要求と取消完了を分ける。commit成功後に成功を取消へ上書きしない。公開成立が通信断で不明な場合は`outcome-unknown`と操作参照を返し、照会で確認する。

検証済みArtifactは不変bytesを所有するか、読出しごとにhashとサイズを検証してそのbytesを使用する。型のbrandやhash付きhandleだけでは将来読み込むbytesや公開権限を保証しない。

## 実装順と受け入れ条件

### 1. 契約と純粋処理の分離（実装済み）

- [x] 旧coreをpresentation/artifacts/playback/deliveryの4パッケージへ実体移動する。
- [x] 旧root exportを削除し、全利用側を新しい所有者の公開APIへ接続する。
- [x] 独立manifest・型検査・テストと、パッケージ間の循環・内部ファイル参照を検査する。
- [x] `packages/unframe/*`をworkspace登録し、利用側依存・lockfile・公式scriptsのfilterを更新する。
- [x] 対象schemaVersionを1に揃え、生成物と各言語の利用側、lockの読込・生成・旧番号拒否を同期する。
- [x] wire fixtureの正規生成に必要な宣言Project fixtureをgenerator管理下に用意する。欠落したexamplesへの依存を外し、生成物を手編集しない。
- [x] 4パッケージを`vp pack`で生成し、workspaceのSourceへ依存しない利用環境で出力の公開APIを実行する。

この段階では残るAuthoring/Compiler/CLI等の配置と既存API名は移行前であり、全体の独立化完了とは扱わない。移したAPIの旧名への互換exportは残さない。

### 2. Source・Compiler・Authoring

- [x] authoringを独立パッケージにし、標準Componentを移す。
- [x] sourceの静的解析・Source位置・patch生成をCompilerから分離する。
- [x] Compiler出力を解決済みPresentationとRender/Media Planに限定する。
- [x] 関数単位の既存APIを提案済み公開APIへ移行し、CLI内の同等処理を撤去する。

受け入れ条件は、固定Sourceから宣言と計画を生成でき、Browser/Filesystemを起動せず検証が完結すること。編集patchは未対応編集を拒否し、基準snapshotと対象hashを保持する。

実装結果: Authoring・Source・Compilerを独立化し、標準Component、固定Source解析とsnapshot付きpatch、Presentation解決とRender/Media Planを各所有者へ移した。Build実行と依存固定は現段階ではCLIに接続している。独立レビューのsnapshot照合と公開境界の指摘を修正した。

検証: Authoring 79件、Source 158件、Compiler 78件と関連型検査・lint・pack、隔離環境の公開API・型宣言・固定Sourceからの計画生成が成功。CLI unitは通常環境で575成功・105失敗のうち、102件が削除済み `examples/presentation`、1件が欠落動画、2件が動画ツールの環境未設定だった。後者2件を含む動画関連11件は固定Nix環境で成功した。実CLI入力用ProjectとFixed Browser受け入れの復旧は第4段階で行う。第3段階はWorkspaceと独立ユースケースを扱う。

### 3. Workspaceと独立ユースケース

- [x] workspaceとworkspace-nodeへ編集・保存・依存固定の規則とI/Oを分離する。
- [x] author-service、build、preview、publishを個別パッケージとして実装する。
- [x] Source/lock同時保存、Build世代の競合、Preview切替、取消/commit競合を公開APIで検証する。
- [x] Local EditorをcontractsのAuthor HTTP契約へ接続する。
- [x] API clientのControl Planeアプリ型依存をHTTP契約へ置き換える。

実装結果: WorkspaceとNode adapter、4つのユースケースを独立化し、CLIとLocal Editorを公開境界へ接続した。Source/lock保存と復旧の排他、Build世代の比較、Preview切替、取消とcommitの競合、公開結果不明の照会を実装した。独立レビューで見つかった保存・lease競合と結果伝播の不備を修正した。

検証: Workspace関連61件、ユースケース・CLI関連108件中107件、Local Editor 99件、HTTP 12件、API client 32件、型検査・関連lint・各packageのpack、隔離環境での6 package公開API・型宣言が成功。残る1件とCLI Authorの19件は既存の欠落動画・`examples/presentation`に依存する。通常の一時ディレクトリでは保存テストの一部が5秒でタイムアウトしたが、メモリ上の一時領域では12件成功した。PreviewとAuthor Serviceのpackには8GBのNode heapを使用する。実ブラウザ・実Control Plane接続とnative helperの配布は第4段階で確認する。

### 4. Adapterと配布

- [ ] render-browser、media-node、styles-node、worker-hostを独立パッケージにする。
- [ ] `render-browser`内にChromiumの薄いラッパーを設け、Browser/Pageの生成・終了、HTML・素材の読み込み、描画準備待機、capture・geometry取得、失敗・取消時の後始末をまとめる（[#227](https://github.com/unframe-dev/unframe/issues/227)）。描画計画と成果物の生成判断はラッパーの外側に置く。
- [ ] 描画処理で繰り返すChromium操作だけをラッパーに集約し、Playwrightの全APIを包み直さない。正常終了・失敗・取消時にリソースが解放されることを検証する。
- [ ] CLIには操作入口とcompositionのみを残す。
- [ ] SDK・CLI・隔離workerを別entryとして`vp pack`で生成する。
- [ ] Local EditorのWeb UIを`vp build`で生成し、ビルド済み静的ファイルを配布可能な独立パッケージにする。CLIはパッケージの公開入口から配信対象を取得し、repository内の`app/web/local-editor/dist`への相対参照を撤去する。
- [ ] 埋め込み用Unity Preview Playerを提供側でWeb向けに事前ビルドし、loader・framework・Wasm・dataと必要な追加アセットをLocal Editorの配布物に同梱する。UI・Player・通信契約の対応を配布時に固定し、利用者によるUnityのインストールやPlayerのビルドを不要にする。
- [ ] repositoryのSourceや`.unframe/unity-preview`、Unity Editorが存在しない環境で、配布パッケージからLocal Editorを起動し、同梱Playerへの成果物読込・表示・再生を検証する。
- [ ] 内部workspace依存の同梱、型宣言、dynamic import、native helper・素材の配置を確定する。
- [ ] pack成果物と明示した外部依存だけを持つ利用環境でCLIからworkerを起動し、代表Build・Preview・公開adapter接続を検証する。実CLIへの入力にはSource・config・lockを備えた専用Projectを用意する。宣言Project fixtureだけではCLIの受け入れ検証を満たさない。
- [ ] 移行済みの親manifest、旧entry、古い運用文書・タスク設定を整理する。

Chromiumの別サーバー化は今回の範囲に含めない。利用者環境へのChrome導入回避、描画環境の共有、描画処理の独立したスケーリングが必要になった時点で判断する。その場合も同じラッパーをサーバー内部で利用する。

Webアプリ本体は`vp build`を使う。Node不要の単一実行ファイル化はこの計画に含めない。

## 検証範囲

各段階で公開境界の回帰テストを先に失敗させ、移行後に関連する型検査・テスト・packを実行する。テスト/buildは変更の影響範囲に限定し、リポジトリ全体の実行はCIに任せる。

生成物は所有するgeneratorで更新し、driftを確認する。Unityの静的検証とEditor実行は区別し、未実行の検証を成功扱いしない。

既存のCLIテストとFixed Browser gateには、削除済みの`examples/presentation`・`examples/media-presentation`を読む処理が残る。基礎パッケージの検証成功とは区別し、これらの受け入れ検証は専用Source Projectを用意する段階で復旧する。
