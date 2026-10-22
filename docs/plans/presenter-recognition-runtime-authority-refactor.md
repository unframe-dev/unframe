# Presenter 認識・Runtime authority 移行計画

- 状態: 工程1・2を実装済み。工程3の Runtime 凍結表示と Unity adapter を実装し、Go と対象 dotnet 検証を実施。Unity EditMode は licensing 初期化失敗で未実行。工程4〜6は未着手。
- 計画の起点: `815ca9886ca8304d4164c067e2a66b7221ec458b`（2026-10-22、文書変更のみ）。実装基準は `origin/main` の `5219fa91` と rebase 後の #160（`af24157b`）。文書固有の変更は `22980438` に載せ替えた。
- 仕様の正本: [ADR-0027](../decisions/0027-presenter-recognition-and-runtime-authority.md)、[進行意味論](../packages/ARCHITECTURE.md#12-v1-presentation-progression-の意味論)、[データ契約](../packages/DATA_MODEL.md)、[配信・実行契約](../packages/CONTRACT_RUNTIME.md)。

## 範囲と移行方針

ADR-0027 全体を対象とする。Presenter が Gesture / Zone を認識し、割り当て済み Realtime が入力の有効性、Guard / Cue、Action、時間進行、Step 遷移を確定する。Pose は手追従などの連続演出に残す。

契約を先に固定し、生成物と consumer を揃えて一括切替する。旧入力方式への adapter、fallback、旧公開物・checkpoint の自動移行は追加しない。非対応データ・consumer は version / capability / schema 検証で拒否する。既存の認証、PublicationFence、assignment fencing、projection、checkpoint 確定後の公開順序を維持する。

共有契約は `packages/contracts` が所有する。Go と TypeScript の evaluator は各実行環境に残し、実装の共通化ではなく conformance fixture で意味を揃える。Control Plane と Realtime の実装共有は行わない。

Gesture 8種、腰位置で判定する一辺2mの Zone、認識開始時の入力文脈、server cooldown 廃止、全体 pause、到達済み Step の直近開始状態への復元は採用済み仕様として扱う。認識閾値は端末内部の調整値であり、ユーザー設定として公開しない。

既存の[汎用パッケージ改善計画](./unframe-packages-refactor.md)、[M6 未完了事項](./presentation-packages-implementation-plan.md)の全体解消、`pauseTimeout`、任意の未到達 Step への移動、Presenter 交代、Local Preview の tracking 対応追加は対象外とする。

## 統合基準時点の実装との対応

| 対象                 | 現在地と変更の起点                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts            | `definition.ts` は `motion` / `zoneEdge` と tracking subject、repeatable cooldown を持つ。`realtime.proto` の通常入力には Group / Step・入場世代・入力世代がない。            |
| Go Realtime          | `internal/runtimecore/v2_tracking*.go` が motion / Zone を認識する。`v2_session.go` / `v2_control.go` は Outcome 再利用と重複排除を持つが、時間・件数による eviction を行う。 |
| Snapshot / recovery  | `v2_recovery.go` は Outcome を recovery metadata に保存する。凍結 Anchor と Step 開始履歴は未対応。共有状態と recovery metadata の同一 cut を拡張する。                       |
| Unity                | `QuestPresentationEntry.cs` / `QuestPresentationInput.cs` が Pose、ボタン、Surface 入力を送る。端末側の Gesture / Zone 認識と入力世代同期を追加する。                         |
| TypeScript consumers | Core の `runtime/cue-executor.ts`、Authoring の型・Zod、Compiler の `lower-cues.ts` / Opaque 解決、Local Editor の Cue 表示が旧語彙・cooldown を参照する。                    |

## 実装順序と工程の完了条件

### 1. 契約と切替条件を固定する

2026-10-22 の契約確定内容は [Presenter authority contract v3](../packages/CONTRACT_PRESENTER_AUTHORITY.md) を正本とする。通常入力の input epoch と全コマンドの command epoch を分け、同期 ACK と同じ checkpoint で記録を整理する。Definition / Delivery / Runtime / Snapshot は v3、progression / projection は2とし、RenderBundle / AssetSet は2を維持する。

対象は `packages/contracts/src/presentation/`、`proto/unframe/`、生成・breaking 検査スクリプトと対応する仕様文書。

- Definition の Gesture / Zone、中心位置のみの Zone 定義、`repeatable`、runtime event、通常入力の文脈、全体操作、Presenter 向け認識設定を定義する。Gesture / Zone は専用の型付き入力として扱い、任意の logical input 文字列に埋め込まない。client から actor、Cue ID、変更後 state を指定できる形にしない。
- 通常入力の文脈は Group / Step、Step 入場世代、server 管理の入力世代とする。イベント ID と文脈・内容を fingerprint に含め、診断用時刻は含めない。追加の経過時間による入力有効期限を設けず、client 時刻による並べ替え・過去状態への遡及評価も行わない。全体操作には通常入力の Step 一致条件を課さない。
- 入力同期を、受付停止、確定状態と新世代の通知、client の途中認識・古い送信待ち操作の破棄、同期確認、受付再開として定義する。再接続・再校正もこの境界を利用する。通常の同一 ID 再送と、切断復旧時の未処理操作破棄を区別する。
- Outcome の確認方法、世代をまたぐ再送結果の扱い、安全な記録整理条件を固定する。未確認結果を時間・件数だけで削除せず、整理後も旧世代入力を新規実行しない。通常入力だけでなく全体操作の重複実行防止も定義する。
- Canonical / Projected Snapshot、入力同期情報、凍結 Anchor、Step 開始履歴、recovery metadata、Step 復元の atomic な配信表現を定義する。履歴全体と他 participant の Outcome を Viewer に配布しない。Presenter 用 Zone 配布は認識に必要な情報に限定する。
- 必須 field / variant の追加は既存規則に従い新 major にする。Definition、Delivery、Capability、protocol、progression、projection、catalog、Snapshot、checkpoint の version 対応表を作り、変更する値と据え置く値の理由を固定する。公開名・import・Protobuf namespace は [ADR-0024](../decisions/0024-canonical-presentation-contract-names.md) の正式名を維持する。
- 未確認 Outcome の件数・byte 上限、受付停止の閾値、同期 message の上限、履歴を含む checkpoint の容量制限と超過時の挙動を明記する。全到達 Step の履歴を黙って evict しない。数値は serialized fixture と既存 transport / persistence 制約で検証し、境界テストで固定する。

完了条件は、上記の field・状態遷移・拒否理由・version・上限値が仕様と正本 schema に定まり、旧入力・未知 variant・不正 snapshot を拒否するテストがあること。schema 変更は失敗する契約テストから進める。後工程に未定義の同期や容量 policy を持ち越さない。

JSON Schema、descriptor、静的 codec / wire types、fixture、Go / C# consumer、Unity の proto / C# コピーを既存 generator で再生成する。breaking baseline は旧 baseline との検出結果を確認したうえで、意図した major 切替として新 descriptor に更新する。breaking-report と型変更・削除の負例検査を揃え、検査の無効化で通さない。

最新 main と #160 の統合後、工程1の契約テスト60件、wire テスト13件、新 wire 6型の Go / C# 相互運用検証、contract / consumer / Unity 生成 drift 検査、breaking 負例検査、Contracts lint は成功した。旧 baseline との比較では cooldown、旧 Outcome retention、recent event IDs の削除5件を検出し、新 descriptor へ baseline を更新した。

`pnpm --filter @unframe/contracts typecheck` は未成功。Control Plane の OpenAPI generator から Core を型検査する依存があり、Core の旧 motion / cooldown / Snapshot 参照23件が残る。Core の移行は工程5で扱う。Control Plane と Unity media の固定 capability は version 値を揃え、API schema / C# client も再生成した。main の Model / Video と Local Preview の完全な Media / Model 状態を保持し、Cue 表示の対象は分離後の `app/local-editor/` とする。Runtime / Unity の実行側移行完了を意味しない。

`presentation/fixtures/wire/valid-delivery.json` は移行前の Compiler / Core が生成した v2 fixture であり、現在の Compiler 成果物を使った再生成・consumer 全体検証は未完了である。これを v3 の検証済み fixture として扱わず、工程5〜6で再生成する。今回の相互運用検証は新しい `presenter-authority.json` に限定した。リポジトリ全体の test / build と Unity Editor / Quest 検証は未実施で、一括切替の条件はまだ満たしていない。

### 2. Runtime の入力受付と復旧を整える

対象は Realtime の `internal/protocol/`、`internal/runtimecore/`、`internal/transport/grpc/`、checkpoint adapter。Control Plane は capability / Delivery と保存・再取得の接続箇所を更新する。

- 認証・Session 等の拘束、保存済み Outcome の検索、同 ID 異内容の拒否、新規入力の文脈・実行状態の検証、Cue 評価の順を固定する。
- Step 入場・再入場・選択、pause / resume、切断復旧、再校正で入力世代を更新する。新世代を確定状態と一貫した cut で通知し、同期前の入力を受け付けない。
- 全体操作は Presenter 権限と実行状態を検証する。running から pause、paused から resume、running / paused から end を実行し、同じ状態への pause / resume の NoOp は既存規則に従う。通常入力の Step 不一致だけで全体操作を拒否しない。終了済み Session の resume / Step 選択は拒否する。
- 上限前の受付停止、同期確認、記録整理を実装する。Outcome と共有状態を同じ checkpoint に保存してから公開し、保存失敗時に未確定結果を成功扱いしない。
- Gesture / Zone の成立イベントを Presenter 入力として評価し、server 側の物理再認識・滞在時間判定・cooldown を廃止する。Pose の admission、最新値保持、Anchor 投影を認識状態から分離する。
- 同時認識は独立イベントとして受理順に処理する。先の入力が Step を変えた場合、後続の旧文脈入力を拒否する。`transitioning` 中の通常入力は保留しない。

完了条件は、旧 Step / 世代、Viewer、client 起点 System event を拒否し、応答消失・checkpoint 復旧後の同一 ID 再送が二重実行されないこと。上限直前の同期と中断・再試行を含めて検証する。同じ Step / 世代で経過時間だけを増やしても入力が失効しないこと、全体操作の権限・状態遷移・NoOp・終了後の拒否、Step 不一致でも有効な全体操作を受理することをテストする。

工程2では、v3 の通常入力4種、全体操作の権限・状態検証、input / command epoch、同期 ACK、容量前 barrier、Outcome と共有状態の同時保存、process recovery を接続した。Pose の admission・最新値保持・Anchor 投影は残し、server の Gesture / Zone 認識と cooldown を削除した。Control Plane の callback / completion / bootstrap は v3 checkpoint と byte 上限を検証する。Step 選択の復元本体は工程4に残り、現時点では `STEP_NOT_REACHED`、終了後は `SESSION_ENDED` で拒否する。

検証は変更した Realtime の auth / protocol / persistence / runtimecore / gRPC / composition root に限定した test・race と、Go vet / lint、Control Plane の関連テスト、OpenAPI / C# consumer 生成 drift 検査を通した。`pnpm --filter @unframe/control-plane run typecheck` は工程5の Core 未移行に由来する既知23件で失敗する。旧 Compiler の Delivery fixture、Unity / Quest、repository 全体の test / build は未検証であり、一括切替はまだ完了していない。

### 3. Pause と Anchor の共有表示を実装する

対象は Runtime の Anchor / clock / projection / recovery、Unity の Snapshot / State 適用と描画 adapter。

- pause の確定時に有効な Anchor の表示状態を固定し、Snapshot / checkpoint と対応する Reliable 更新へ反映する。unavailable な対象に位置を作らない。
- Timeline、Timer、Media、手追従を同じ pause 境界で止める。HMD 視点と操作 UI は継続する。
- pause 中と resume 後の fresh Pose 待ちでは凍結表示を維持する。新しい有効 Pose で追従を再開した後は通常の freshness 規則に戻す。raw Pose 履歴は永続化しない。

完了条件は、pause 中の途中参加・replay・process recovery が同じ凍結表示へ収束し、Pose の経年だけで消えないこと。resume の fresh Pose 有無、pause 前からの unavailable、projection の不可視対象を検証する。

工程3では、有効な Anchor の許可成分だけを pause の checkpoint に保存し、`RuntimeViewReplaced` で可視範囲の共有表示を一括配信する。途中参加・replay・process recovery でも凍結状態を保持し、resume 後は有効な Pose による解除を checkpoint に保存してから通常の freshness に戻す。State 生成時の cut と Reliable 適用後の下限を照合し、古い frame が新しい共有表示を上書きしないようにした。Unity は Snapshot / frozen keyframe と一括置換を適用し、共有再生には pause-aware logical clock を使う。raw Pose は永続化しない。

検証は Realtime の protocol / runtimecore / gRPC / checkpoint adapter / composition root の対象 test・race、Go vet / lint、Unity の `dotnet run --project app/unity/Tests/PresentationRuntimeAdapter/PresentationRuntimeAdapter.csproj -- pause`、C# format と追加 `.meta` の整合性で実施した。Unity Editor の対象 EditMode は Licensing Client の CoreCLR 初期化失敗（`0x8007000E`）でテストに到達していない。既存 dotnet harness 全体の ModelClip Snapshot 整合性エラーも未解消。Unity の入力同期・command epoch と必要 capability は工程5に残り、実接続は拒否する。Quest 実機と全体 test / build は未実施。

### 4. Step 開始履歴と一括復元を実装する

対象は Runtime の Step entry、Run / deadline / owner、Snapshot / recovery / projection と、Unity の atomic な適用処理。

- 初期化完了後、最初の入力・時間評価前に、各 `(groupId, stepId)` の直近開始状態を保存する。再入場時はその Step の保存を置き換える。履歴は inactive Group の実行状態から分離して検証・保存する。
- Step 選択で現在の Run を取り消し、表示・変数・Surface / Media / Model・保存時点の Run 再生位置を一括復元して paused にする。未到達 Step と終了済み Session は拒否する。
- Step 入場世代・入力世代を進め、Cue 消費を初期化し、Timer を新しい入場時刻から再設定する。Run は新 ID と必要な owner epoch を付け、保存した再生位置を現在の logical clock へ rebase する。Run 参照、blocking 集合、完了予約を一括再構築する。
- Session clock、配信連番、Run allocator、重複排除記録、認証・校正は巻き戻さない。Anchor は選択時点で凍結し、過去の手位置を復元しない。

完了条件は、前 Step から継続していた Run、Group をまたぐ選択、同じ Step の再選択、Surface transition、Media / Model を含めて保存位置から再開できること。旧 Run 完了の遅着・重複は状態を変更せず、Timer・Cue 消費は新入場に属すること。復元途中の部分状態を公開しないこと。

### 5. Presenter 認識と各 consumer を接続する

工程1の契約固定後、Unity 認識器と Authoring / Compiler / Core の更新は独立に進められる。統合は工程2〜4の完了後に行う。

- Unity は入力文脈を認識開始時に捕捉し、成立まで保持する。Gesture は一動作一種類一通知、動作終了まで再受付せず、前後左右は開始時の頭の水平向き、上下は空間の鉛直を使う。閾値と複数候補の分類規則は認識器内部で固定し、決定的な Pose fixture で検証する。
- Zone は Presentation Space の中心と腰位置で判定する。新期間・追跡復帰は現在位置を無通知 seed し、追跡喪失を exit と扱わない。腰が取得できない間は停止する。
- ボタン・Surface も開始時の文脈を使用する。認識途中の世代変更、切断・再校正、同期中に操作を次期間へ付け替えない。全体操作 UI と到達済み Step の選択を接続する。
- Authoring の型・validation、Compiler の Structured / React Opaque lowering と producer 検査、Core evaluator / snapshot 検証、CLI serialization、Local Editor の Cue 表示を新語彙へ揃える。Core と Go は共通 fixture で Cue 選択順・once / repeatable・Timer / Run の関連規則を照合する。
- Local Preview の tracking 非対応を新語彙でも明示的に維持し、Gesture / Zone を対応済みとして表示・実行しない。既存の logical / semantic / Surface 操作に回帰がないことを確認する。

完了条件は、端末が Cue や共有状態を決定せず、新契約の成立イベントだけを送ること。旧 motion / tracking trigger・cooldown の実行経路と利用箇所が残らず、Pose による連続演出は動作すること。

### 6. 統合受入と文書更新

- 通常接続、pause 中の途中参加、応答消失後の再送、切断復旧、再校正、checkpoint 復旧、Step 復元を、生成 consumer を使う経路で確認する。
- Unity EditMode で認識・同期・凍結表示・Run 復元を確認する。Quest 実機では8種類の Gesture、頭の向き、両手競合、Zone 境界、腰 tracking 欠損・復帰を確認し、環境と結果を記録する。2m / 認識閾値の品質は Editor の成功だけで受入済みとしない。
- owning Architecture / README、DATA_MODEL、CONTRACT_RUNTIME、AUTHORING_CONTRACT の採用済み未実装表記を、検証済みの範囲に合わせて更新する。実装・初稿とは別の reviewer が文書を確認する。

## 検証と変更のまとめ方

各工程は対象を限定した失敗テスト、実装、回帰確認、責務整理の順で進める。契約テスト、Go の protocol / runtimecore / transport / persistence テスト、Unity EditMode、Authoring / Compiler / Core と Local Editor model の既存テストを変更境界に応じて選ぶ。生成物の手編集は行わない。

生成検査には `pnpm --filter @unframe/contracts run check:presentation`、各 `check:wire-*`、`nix run .#contracts-consumers -- check`、`nix run .#unity-proto -- check`、breaking 検査を使う。各コマンドの対象・副作用を確認し、実行前後に worktree / staged diff を確認する。

ローカルの test / build は変更の影響範囲に限定する。全体の `nix run .#check` は LP など対象外の test / build も含むため、この計画ではローカル実行を前提にしない。全体検証は remote CI/CD に委ね、Unity Editor / Quest 実機は別に実施する。未実行・実行不能な検証を成功扱いしない。

工程はレビュー単位であり、不整合な中間状態をリリースする境界ではない。source contract、生成物、consumer、fixture の整合が取れた状態で一括切替する。完了には工程1〜6の受入条件、生成 drift 検査、対象ローカル検証と remote CI の成功、残る実機制約の明示を必要とする。
