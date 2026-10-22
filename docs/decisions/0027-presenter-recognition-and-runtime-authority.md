# ADR-0027: Presenter の入力認識と Runtime の共有状態確定を分離する

## Status

Accepted — 2026-10-21。設計の採用であり、実装・Zod / Protobuf・生成物の変更は未着手。

## Context

現行実装は Presenter の Tracking Pose を Realtime に送り、Runtime が motion と Zone を認識する。認識用 sample と手追従用 Anchor sample が結び付いており、入力には認識対象の Step と受付期間を拘束する契約がない。端末で調整する認識処理を共有進行から分離し、遅着・再送・復旧が別の Step を発火させないようにする。

## Decision

### 認識と共有状態の責務

- Presenter client が Gesture と Zone の出入りを認識する。Runtime は認証済み Presenter の成立イベントを受け、入力の有効性、Guard、Cue の選択、Action、Timeline / Timer の進行・完了、Step 遷移を確定する。Viewer は確定状態を適用し、Timeline をローカル補間する。
- Gesture は `swipeLeft`、`swipeRight`、`swipeUp`、`swipeDown`、`pushForward`、`pullBackward`、`spreadHands`、`closeHands` の8種類。片手動作は左右どちらでも同じ種類とし、一動作を一種類に分類する。上下は空間の鉛直、前後左右は動作開始時の頭の水平向きを基準にする。距離・速度・時間窓・終了判定は client 内部の調整値とし、Definition のユーザー設定にしない。client は種類を送り、Cue や変更後の共有状態を指定しない。
- Zone の初期標準は Presentation Space の軸に平行な一辺2mの箱とし、ユーザーが設定するのは中心位置だけとする。client へ Zone ID と位置を配布し、Body tracking の腰位置で内外を判定する。形状・寸法は現行判定とテスト値を基にした採用値であり、実機の妥当性検証済み値ではない。腰位置を取得できない間は認識を停止し、別の部位へ代替しない。境界の揺れ対策は client 内部に置き、server で再認識・滞在時間の再計測をしない。
- 各認識結果は別のイベント ID で送る。同時成立 batch は作らず、Runtime の受理順にその時点の状態で評価する。同じ Step で両方が有効ならそれぞれ実行し、先のイベントで Step が変われば後続の旧入力を拒否する。一イベント内の Cue 候補は既存の優先順位・order・ID 順で一つ選ぶ。`transitioning` 中の通常入力は受け付けず、後回しにもしない。
- server cooldown を廃止する。client は一動作一通知とし、動作終了後に次の動作を受け付ける。固定の待ち時間や不採用動作の新 ID による再発行は設けない。Cue の `oncePerStepEntry` と `repeatable` は残し、通常は前者、繰り返しが必要な Cue は後者を明示する。

### 入力の受付期間と復旧

- Gesture・Zone・ボタン・Surface 入力は、認識開始時の Group / Step、Step 入場世代、server 管理の入力世代、イベント ID に結び付ける。送信時に現在の Step へ付け替えない。送信者は認証情報から Runtime が設定し、client 起点の System event は許可しない。
- Step 入場・再入場・選択、pause / resume、切断からの復旧、再校正で入力世代を更新し、途中の認識を破棄する。再校正は server と世代を同期してから認識を再開する。新期間では Gesture の新しい動作を待ち、Zone は現在位置を無通知で seed する。追跡喪失は exit とせず、復帰も無通知で seed する。Zone 内で開始した場合、外へ出て改めて入るまで enter は発生しない。
- 追加の経過時間による入力有効期限は設けない。新規入力は現在の Step・世代・実行状態を検証し、古いものを採用しない。client 時刻で並べ替えたり過去の共有状態へ遡って評価したりしない。
- 通常再送は同じ ID と内容を使う。認証と Session 等の拘束を検証した後、保存済み結果を現在の Step に対する新規入力判定より先に返し、二重実行しない。同じ ID の異なる内容は拒否する。未確認の処理結果を保持し、保持上限に達する前に入力受付を止め、状態同期・世代更新・client の古い送信待ち操作の破棄を確認してから旧記録を整理する。記録の消去だけを理由に古いイベントを新規実行しない。
- 切断からの復旧では、未処理操作を持ち越さず server の確定状態へ同期する。長時間切断に対する厳密な再送期限は設けない。必要なら Presenter が到達済み Step の開始状態へ戻してやり直す。
- pause / resume / end / Step 選択は全体操作とし、Step 不一致では拒否しない。Presenter 権限と現在の実行状態を検証する。終了済み Session では再開・Step 選択を許可しない。

### Pause と Pose

- Pose は認識の正本にせず、手追従など連続演出に必要な用途で latest-wins 送信を続ける。Pose の保持・投影を認識状態から分離する。
- pause は Timeline・Timer・Media・手追従を含む共有演出全体を停止する。停止時に有効な Anchor 位置を共有の凍結表示状態として確定し、Snapshot / checkpoint に含める。Pose の経年だけで非表示にしない。pause 前から unavailable の対象に架空の位置は与えない。HMD の視点更新と操作 UI は継続する。
- resume 後は最新の有効 Pose から追従する。まだ有効 Pose がない対象は凍結位置を維持し、取得後に再開する。通常の running 状態の追跡欠損・freshness 規則と、この再開待ちを区別する。raw Pose 履歴や認識器の内部状態は保存しない。

### Step 開始状態への復元

- Session 内の `(groupId, stepId)` ごとに、直近の入場開始状態を1件保存する。未到達 Step の選択は許可しない。初期化完了後、最初の入力・時間経過を評価する前の表示・変数・Surface / Media / Model・進行中の Run を保存する。開始状態の履歴も checkpoint 対象にする。
- Step 選択は現在の演出を取り消し、対象の開始状態を一つの状態変更として復元して paused にする。明示的 resume まで進行しない。開始時に前 Step から続いていた演出も保存時の再生位置から復元する。
- Step 入場世代・入力世代を更新し、Cue 消費を初期化、Timer を新しい入場時刻基準で再設定する。復元 Run は新しい ID と必要な owner epoch を持ち、再生位置を現在の server 時計へ対応付ける。Run 参照・完了予約も一括で再構築し、取り消した Run の完了通知を無効化する。
- Session 時計、配信連番、Run 採番、重複排除記録、認証、実空間の校正は巻き戻さない。過去の手位置も復元せず、Step 選択時点の Anchor を凍結する。過去の開始状態は実行中の inactive Group state と分け、Viewer へ履歴全体を配布しない。

## Alternatives

- **Runtime で Pose から認識する**: 現行方式。端末の認識調整と共有進行が結び付き、認識のためにも Pose 送信が必要になるため採用しない。
- **Presenter が共有進行も確定し、server は配信する**: 成立する方式だが、端末だけが進んだ状態と保存・配信済み状態の復旧調停が必要になる。今回は Runtime に進行と保存の確定点を集約する。
- **同時認識 batch・server cooldown**: 入力単位と再受付の規則を増やすため採用しない。独立イベントの受理順と client の動作終了判定を使う。
- **任意 Step / 全入場履歴への移動**: 未到達状態の生成や履歴選択を必要とするため採用しない。

## Consequences

認識を端末で調整しながら、Cue 採用・進行・復旧の正本を Runtime に保てる。認識結果の品質は client に依存し、Runtime は物理動作の成立を再検証しない。入力世代と復元履歴、凍結 Anchor の保存が追加され、既存の command / Snapshot / checkpoint と consumer を一緒に更新する必要がある。

## Adoption and Exceptions

本変更は文書のみ。現行 Zod / Protobuf と生成物は従来方式のままであり、新 field や新 protocol version が実装済みとは扱わない。実装時は Definition・Delivery・Control・Snapshot / checkpoint の構造と意味規則を整合させ、Core、Runtime、Unity、Author の利用箇所を更新する。旧認識方式との互換 fallback は設けず、非対応 consumer を契約の version / capability 検証で拒否する。

関連仕様は [Presentation Architecture](../packages/ARCHITECTURE.md)、[Data model](../packages/DATA_MODEL.md)、[Delivery / Runtime contract](../packages/CONTRACT_RUNTIME.md)、[Realtime Architecture](../../app/server/realtime/ARCHITECTURE.md) に反映する。実装レビューでは旧 Step・旧世代入力、応答消失後の再送、同時成立の独立処理、Zone の無通知初期化、pause 中の途中参加、Step 復元と旧 Run 完了、checkpoint 復旧を検証する。Gesture と2m Zone の認識品質は Quest 実機で別途確認する。例外はリポジトリの設計レビューで本 ADR の更新または後継 ADR として承認・記録する。
