# Presenter authority contract v3

状態: [ADR-0027](../decisions/0027-presenter-recognition-and-runtime-authority.md) の構造・意味・上限を固定する採用契約。Go / Unity / Authoring / Compiler / Core をこの契約に接続した。実装と検証の状況は[移行計画](../plans/presenter-recognition-runtime-authority-refactor.md)を参照する。旧 major の consumer とは接続しない。

構造の正本は [Definition](../../packages/contracts/src/presentation/definition.ts)、[Snapshot](../../packages/contracts/src/presentation/runtime-projection.ts)、[共通 Proto](../../packages/contracts/proto/unframe/presentation/runtime.proto)、[Realtime Proto](../../packages/contracts/proto/unframe/realtime/realtime.proto)。数値・wire 境界検証は [runtime-authority.ts](../../packages/contracts/src/presentation/runtime-authority.ts) を併読する。入力同期・復元・容量の詳細は本書を正本とする。

## Version と移行

| 対象                                         | 旧値   | 採用値 |
| -------------------------------------------- | ------ | ------ |
| Definition schema / contract                 | 2      | 3      |
| RenderBundle / AssetSet schema / contract    | 2      | 2      |
| BuildManifest / PublishedPresentation schema | 2      | 3      |
| Capability schema                            | 2      | 3      |
| Delivery schema / contract                   | 2      | 3      |
| Runtime protocol / contract                  | v2 / 2 | v3 / 3 |
| Progression contract                         | 1      | 2      |
| Projection contract                          | 1      | 2      |
| Projected runtime catalog contract           | 2      | 3      |
| Connection / Canonical Snapshot schema       | 2      | 3      |
| Durable checkpoint schema                    | 2      | 3      |
| Renderer / Model contract                    | 1      | 1      |
| Local Preview envelope schema                | 1      | 1      |

Definition の入力語彙、Delivery の Presenter 認識 catalog、進行・投影・保存状態を変更するため該当 major を更新する。Build / Publication / Capability も旧 version 組合せを受理しない schema に更新する。描画・素材形式と Local Preview envelope の構造は変えない。Local Preview は引き続き Gesture / Zone と Presenter Anchor を拒否する。変更しない envelope でも内包契約は上表と照合する。

公開 import、Protobuf package / service / namespace は [ADR-0024](../decisions/0024-canonical-presentation-contract-names.md) の正式名を維持する。旧 major、未知 enum / required capability、必須 oneof の未知 variant、上表にない組合せは補完せず拒否する。旧公開物・checkpoint の adapter / 自動移行・protocol downgrade は設けない。breaking baseline は旧 baseline との検出結果を確認して新 descriptor へ更新し、破壊的変更検査の負例を維持する。

RuntimeCapability は従来の1〜6を保持し、7=`PRESENTER_RECOGNITION`、8=`INPUT_SYNCHRONIZATION`、9=`FROZEN_ANCHORS`、10=`STEP_RESTORE` を追加する。全 v3 connection は8〜10を必須とし、Gesture / Zone を持つ Presentation の Presenter profile は7も要求する。6=`TRACKING` は Pose による連続演出用であり、認識の意味には使わない。Viewer に認識設定を渡さない。

## Definition と認識設定

- `gesture` Trigger は Presenter actor と Gesture 種類だけを持つ。種類は `swipeLeft / swipeRight / swipeDown / swipeUp / pushForward / pullBackward / spreadHands / closeHands`（wire enum 1〜8）。片手の左右指定・距離・速度・時間窓は Definition に持たない。
- `zoneEdge` Trigger は Presenter actor、Zone ID、enter / exit（wire enum 1 / 2）。Zone は ID・owner・center のみを定義し、Presentation Space の軸に平行な一辺2mの箱に固定する。腰以外を代用しない。dwell / hysteresis / motion / system-tracking Trigger は拒否する。
- fire policy は `oncePerStepEntry` とパラメーターなしの `repeatable`。server cooldown とその Snapshot state は廃止する。
- `ProjectedRuntimeCatalog.presenter_recognition` は Presenter 限定の `PresenterRecognitionCatalog`。Presentation に存在する Gesture 種類の集合と、参照する Zone の ID / center の集合だけを含める。Guard の成否を認識開始の条件にせず、Cue ID・Action・閾値を配らない。Gesture は enum 昇順・重複なし、Zone は ID 昇順・重複なしとする。
- private 同期 message の `recognition_catalog` は現在の Group / Step の候補だけに絞った同型の設定を必須とする。認識は同期済みの設定を使い、Step 入場・復元時に更新する。Viewer profile と Local Preview では `presenter_recognition` 自体を省略する。静的な Delivery 設定を現在 Step の認識開始許可として使わない。

## 通常入力と全体操作

通常入力は `LogicalInputCommand`、`SurfaceInteractionCommand`、`GestureInputCommand`、`ZoneInputCommand` の4種。すべて認識開始時の `InputContext`（input epoch、Group ID / 入場 epoch、Step ID / 入場 epoch）、command epoch、client event ID、origin version を持つ。capture 時刻は任意の診断情報である。client は actor / role / Cue / 共有状態を指定しない。

`input_epoch` は Session の正の単調増加整数。Step 入場・再入場・選択、pause / resume、切断復旧、再校正で更新する。途中認識は破棄し、送信時の Step へ付け替えない。Gesture は新動作を待ち、Zone は現在位置を無通知 seed する。追跡喪失は exit とせず、復帰も無通知 seed とする。経過時間による追加 TTL、client 時刻による並べ替え、遡及評価を設けない。

全体操作は `RuntimeControlCommand` の pause / resume / end / selectStep / recalibrate（kind 1〜5）。`InputContext` を持たず、selectStep のみ `StepSelection { group_id, step_id }` を必須とし、他 kind への付与は禁止する。認証済み Presenter と実行状態を検証し、Step 不一致を理由に拒否しない。running→pause、paused→resume、running / paused→end を実行する。同状態への pause / resume は NoOp、terminating での扱いは既存の不可逆終了規則に従う。終了済み Session の resume / Step 選択は禁止する。

`command_epoch` は固定 Presenter の正の単調増加整数であり、Step 遷移では更新しない。重複排除記録の整理、接続・復旧時の同期でのみ次値へ進める。すべての通常入力・全体操作をこの世代に拘束する。これにより Step に依存しない操作も、記録整理後に遅着した旧操作として拒否できる。

`client_event_id` は `<command_epoch の正規10進表記>:<小文字 UUID v4>` に固定する。例: `4:550e8400-e29b-41d4-a716-446655440000`。ID prefix と command epoch が一致しなければ protocol error とする。世代を付け替えて同じ ID を再利用できず、過去の全 ID を無期限に保存する必要がない。idempotency key は引き続き Session / participant / client event ID である。

### 受付順序と結果

1. message 構造・認証・Presenter 権限・Session / Publication / assignment / origin fence を検証する。
2. 同じ key の記録があれば fingerprint を比較する。一致なら保存済み Outcome を返し、Step / 入力世代の現在値で再判定しない。異内容は `INVALID_ARGUMENT / idempotency_key_reused`。
3. 記録がない場合は command epoch を照合する。古い値は `COMMAND_EPOCH_STALE`、未来値は protocol error。記録整理後の旧コマンドを新規処理しない。
4. 通常入力は同期 READY、running / stable、現在の入力文脈を検証する。その後に resource / Cue を探索する。全体操作は通常入力の同期・Step 検査を省き、操作固有の権限・状態・容量を検証する。
5. 新規処理の Outcome と共有状態を同じ checkpoint に保存し、保存成功後にのみ応答・event を公開する。同じ ID の再送は ingress / sequence / Cue 消費を増やさない。

同期中、stale context / epoch、容量超過など新規処理前の admission 拒否は状態・Outcome 記録を増やさない。採用した処理の accepted / rejected / NoOp は結果を記録する。構造・認証・fence 違反を通常の Cue 不採用へ丸めない。

新規 rejection は Proto enum の `INPUT_CONTEXT_STALE / COMMAND_EPOCH_STALE / INPUT_SYNCHRONIZATION_REQUIRED / STEP_NOT_REACHED / SESSION_ENDED / RUNTIME_CAPACITY_EXCEEDED`。Gesture / Zone の accepted event は専用の `GestureInputAccepted / ZoneInputAccepted` とし、通常入力と同じ Cue evaluation を返す。独立イベントを受理順に処理し、最初の処理で Step が変われば後続の旧文脈を拒否する。`transitioning` 中の通常入力を保留しない。

### Fingerprint

SHA-256 の入力は ASCII `unframe-command-v3`、NUL、ControlClientItem の oneof field 名（`logical_input / surface_interaction / gesture_input / zone_input / runtime_control` のいずれか）、NUL、以下の順の値とする。message 型名は使わない。string は uint32 big-endian byte length + UTF-8、uint64 は8-byte big-endian、enum は4-byte big-endian。capture 時刻は含めない。

1. 全 command 共通: client event ID、command epoch、origin version（uint64）。
2. 通常入力のみ: input epoch、Group ID、group entry epoch、Step ID、step entry epoch。
3. payload: Logical は logical event name、Surface は surface ID / interaction ID、Gesture は enum、Zone は Zone ID / edge enum、Control は kind enum と selectStep の場合だけ Group ID / Step ID。

未知 field は fingerprint に含めず、required field / enum / oneof は補完しない。digest は `sha256:` + 小文字64桁 hex。input context と command epoch が異なれば同じ動作種類でも異なる fingerprint になる。

## 同期と記録整理

同期状態は private な `PresenterInputSynchronization` で送る。phase（REQUIRED / READY）、reason、単調増加する synchronization revision、InputContext、現在の command epoch、任意の next command epoch、Reliable cut を含む。入力文脈は Canonical state と同じ cut で作る。Step 更新だけの同期は command epoch を変えず、記録整理・再接続・process recovery では next epoch を設定する。next は現在値+1であり、Ready では持たない。整数が最大値に達した場合は wrap せず fail closed とする。

1. server は通常入力の受付を止め、旧 Outcome を保持したまま新しい revision / 入力世代 / 同期状態を checkpoint に確定する。切断・process recovery では先に paused を確定する。
2. server は対応する Snapshot / replay / catalog と REQUIRED を送る。client は cut まで適用し、途中認識と古い送信待ち操作を破棄する。未処理操作を新 epoch へ付け替えない。
3. client は `InputSynchronizationAck` に revision、InputContext、対象 command epoch（next があれば next）、applied reliable sequence、`pending_commands_discarded=true` を返す。
4. server はそれらが現行同期の値と一致することを検証する。next がある場合は epoch 更新と旧 Outcome 全件の整理を同じ checkpoint に確定する。READY もその checkpoint に保存し、成功後に READY を送って通常入力の同期 barrier を解く。runtime lifecycle が paused / transitioning なら通常入力は引き続き受け付けない。

ACK は保存する通常 command ではなく、現在の同期状態に対する冪等な制御 message とする。同じ ACK の再送には保存済み READY を返す。stale ACK は無効化し現行 REQUIRED / READY を再送する。cut は同期開始時の値であり、無関係な後続 event の発生だけでは ACK を失効させない。入力文脈・認識設定を変える更新は revision を進めて以前の ACK を無効化する。

ACK 前の全体操作は現在の command epoch で受理できる。状態・入力文脈が変わった場合は新 revision の同期へ置き換える。次 epoch は READY 受信まで新規 command に使わない。入力受付中に通常の Outcome 応答を確認しただけでは記録を消さず、同期 ACK を整理の境界とする。

ACK 消失では旧記録と REQUIRED を維持する。READY 消失では durable な新 epoch / READY を再送できる。checkpoint 保存失敗時は epoch 更新・整理・受付再開を公開しない。再接続時は古い操作を再実行せず確定状態へ同期し、より新しい revision で barrier を作る。process recovery は保存した epoch / allocator / 同期状態を復元し、新しい pause / 同期を checkpoint に保存してから受付を始める。

## 凍結表示と Step 復元

`FrozenAnchorDisplayState` は Node ID と任意の position / rotation を持ち、少なくとも一成分を必須とする。Node の follow 指定で許された成分だけを保存・投影し、raw Pose / tracking 時刻・履歴は含めない。pause 前から unavailable の対象に値を作らない。pause 中と resume 後の fresh Pose 待ちでは凍結表示を期限で消さない。

pause / Step 復元の共有表示変更は `RuntimeViewReplaced` の完全な ParticipantRuntimeView を一つの Reliable event として適用する。profile ごとの visible closure だけを含め、base reliable sequence はその event sequence に一致させる。履歴・Outcome・private 同期情報は含めない。新 view の適用時に古い Timeline / Surface / Media / Model の再生と Anchor 表示を一括置換し、古い State frame は新 cut より前の状態を上書きしない。

resume は最新の有効 Pose があればそれを用い、なければ凍結表示を保持する。`ProjectedAnchorBindingPatch` は `unavailable / sample / frozen` の oneof とし、frozen の Node ID は外側の Node ID と一致させる。新 cut に属する sample で凍結を解除し、以後は通常の500ms freshness を適用する。解除後の unavailable も凍結を除去する。最初の sample が latest-wins 配信で失われても、次の keyframe / unavailable で通常状態に収束する。resume 待ちの keyframe は frozen を明示し、未取得を unavailable に置き換えない。server は解除を canonical checkpoint にも反映する。HMD 視点と操作 UI は停止しない。

Presenter にだけ private な `PresenterStepSelectionCatalog` を送る。`reached_steps` は履歴にある Group / Step ID の組を重複なし・Group / Step 順で列挙し、`reliable_sequence` まで適用してから選択 UI に反映する。入力同期と同じ Runtime lock で取得し、Control item の1 MiB上限を適用する。開始状態や他 participant の結果を含めず、Viewer には送らない。

`StepStartState` は Group / Step ID と保存時の入場 epoch、capture logical time、Node / Surface / Media / Model / Variable state、active Run を持つ非再帰の開始状態。global clock / 配信連番 / allocator / 認証 / 校正 / Anchor は含めない。Canonical の実行中 resource と履歴 resource は別の owner / epoch 文脈で検証する。各 `(groupId, stepId)` は直近一件だけとし、並び順は Group ID、Step ID の UTF-16 code-unit 順。

初期化完了後、最初の入力・時間評価より前に履歴を保存する。Step 選択は保存状態を復元して paused にし、明示 resume まで進めない。新しい Step / input epoch、Cue 消費初期化、入場時刻基準の Timer、新 Run ID・owner epoch・時計 rebase と Run 参照 / 完了予約の再構築を同じ変更で行う。旧 completion を無効化し、Session 時計・sequence・allocator・重複排除記録を巻き戻さない。前 Step から続く Run も保存位置へ戻す。Anchor は選択時点の値を凍結する。

Canonical Snapshot は input epoch / 凍結表示 / 開始履歴を保持する。participant view には凍結表示だけを投影する。RuntimeRecoveryMetadata は参加者履歴、command epoch、同期状態、participant / client event ID / fingerprint / Outcome の記録を持ち、TTL 用の記録時刻・Canonical 内の recent event IDs は廃止する。両 payload を同じ immutable cut で checkpoint 化する。

## 容量と超過時の動作

| 対象                                   |                           上限 / 同期開始値 |
| -------------------------------------- | ------------------------------------------: |
| Control item                           |                             1,048,576 bytes |
| State item                             |                               262,144 bytes |
| 一つの command record                  |                                 1,024 bytes |
| command history hard limit             |                      1,024件、262,144 bytes |
| 通常入力の受付停止・同期開始           | 1,000件、245,760 bytes のどちらかへの到達前 |
| input sync / ACK                       |                                 4,096 bytes |
| 一つの StepStartState                  |                                65,536 bytes |
| 全 Step 開始履歴                       |                               524,288 bytes |
| Canonical Snapshot 全体                |                               786,432 bytes |
| Recovery metadata 全体                 |                               262,144 bytes |
| 保存 checkpoint envelope の UTF-8 JSON |                             1,572,864 bytes |

Control は外側 oneof を含む `ControlClientItem / ControlServerItem` 全体、State は `StateClientItem / StateServerItem` 全体で測る。gRPC の圧縮前 payload に適用し、submessage だけで上限判定しない。bytes は unknown field を含めない deterministic Protobuf encoding で数える。history 集合は親の repeated field の tag / length を含む serialized contribution、record 単体は submessage 自身の bytes とする。総履歴に加え Canonical 全体の上限も満たす必要がある。件数は Definition の Group / Step key 数を超えてはならず、固定の任意件数で到達履歴を捨てない。

新規 command は結果の最悪サイズ1,024 bytesと繰返し field overhead を予約して admission 判定する。通常入力が同期開始値へ達する前に barrier を開始し、hard limit までの余裕は同期中の全体操作と metadata に使う。全体操作も hard limit を超える見込みなら実行せず capacity reject とする。拒否のために記録を増やしたり、未確認結果を TTL / LRU で evict したりしない。同期 ACK 自体は記録容量を消費しない。

開始履歴の初期保存・置換、Action、Step 遷移、Step 復元を preflight し、各上限を超える変更は部分 commit しない。入場に必要な履歴が保存できない場合は入場を取り消し、元の履歴を保って paused / runtime capacity fault とする。失敗した候補の単一開始状態・履歴集合・Canonical 全体の byte 長は、任意の `RuntimeRecoveryMetadata.capacity_fault` に保存し、再接続や保存失敗による pause 理由の変更後も保持する。通常の checkpoint では省略する。容量 fault に対する resume は記録した byte 長を現行上限と照合し、修復せず同じ遷移を進めない。Step 復元・resume・終了の確定時に fault を解除する。通常の Action batch capacity reject は元の状態を保持する。履歴を黙って削除したり Control item を無断で分割したりしない。

Control Plane は envelope JSON の UTF-8 byte 長を保存前に照合し、超過は `413 / checkpoint_payload_too_large` で拒否する。DB schema 変更は必要ないが、callback body と bootstrap 読込の両境界で同じ制約を適用する。completion が内包する checkpoint も同じ検証を使う。

容量は現行の「deterministic bytes を base64 化した proto JSON を D1 TEXT に保存する」経路を基準にした。D1 の string / BLOB / row 上限は [公式制限](https://developers.cloudflare.com/d1/platform/limits/) の2,000,000 bytes。Canonical + Recovery は合計1 MiBであり、base64 後は1,398,104 bytes、ID・hash等の envelope metadata を含めても1.5 MiB以内に収め、DB row の他 column にも余裕を残す。JSON byte 長の最終検査は省略しない。これらは認識品質や性能の実測値ではなく、serialization と保存制約に基づく採用上限である。

Reliable log / Replay / catch-up、State buffer、microstep、tracking rate / freshness、snapshot retry の上限は v2 の数値を据え置く。command Outcome の15分 / 1,024件 eviction だけを廃止し、上表の barrier と hard limit に置換する。checkpoint 行数の長期保持 policy はこの一行容量契約には含めない。

## 契約工程と実行側の検証境界

契約テストは新旧 major、Gesture / Zone と通常入力の文脈、command ID の epoch 拘束、同期 ACK の構造、履歴・凍結表示の presence と投影隔離、serialized byte 境界、生成 drift と breaking 負例を検証する。

Go / Unity / Authoring の移行では、保存済み Outcome の先返し、同期の中断・重複 ACK・READY 消失、同一 epoch process recovery と lease 失効後の新 assignment epoch での復元、容量 preflight の rollback、到達履歴の不正参照・Run rebase・旧完了拒否、pause / fresh Pose の State 順序、非対応 profile 拒否を統合テストする。これらの動的処理と Quest 認識品質は、schema / codec テストの成功だけで実装済みと扱わない。
