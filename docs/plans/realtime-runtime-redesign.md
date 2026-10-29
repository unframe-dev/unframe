# Realtime の非同期 checkpoint と複数 Session 管理

更新日: 2026-10-29。状態: 実装・ローカル結合検証済み。公開経路・実機・収容負荷は未検証。

本書は Realtime、Control Plane、Unity、Audience の実装担当者向けに、配信と保存の分離、Funnel 経由の Cloud Runtime の複数 Session 管理、障害復旧の変更を定義する。現行実装を説明する文書ではなく、以下の受け入れ条件を満たすための実装計画である。

## 確定方針

- Runtime が Session ごとに入力を検証し、状態・イベント順序・操作結果をメモリ上で確定してから、Presenter / Viewer へ保存を待たずに配信する。
- 通常の checkpoint は1秒間隔で非同期保存する。保存失敗・保存遅延だけを理由に、通常進行、入力受付、配信を停止しない。5秒などの保存遅延による自動 pause は設けない。
- クラッシュ後は最後に保存できた checkpoint へ巻き戻し、一時停止状態で復旧する。平常時は秒単位の巻き戻りを想定するが、保存障害中は巻き戻り幅に時間上限を保証しない。
- 1台の Host、1つの公開 endpoint、1つの常駐 Realtime プロセスで複数 Session を同時に扱う。Session ごとの子プロセス起動方式を置き換える。
- 実行状態を作り直すたびに新しい assignment epoch を取得する。同じ Session ID と参加コードは維持する。
- 復旧時の準備完了と発表終了は、保存の確定を必要とする境界として通常進行と区別する。

## 着手時の実装と変更範囲

着手時点ではイベントログを永続化しているのではなく、Canonical Snapshot と入力の重複排除履歴などをまとめた checkpoint を同期保存し、成功後に操作結果とイベントを公開している。replay はプロセス内のメモリに保持される。Cloud Host は単一の子プロセスを監督し、Control Plane の Host heartbeat / 割り当ても1 Host・1 Session を前提としている。

主な変更対象は次のとおりとする。生成物は正本の変更から再生成する。

| 所有範囲                                                                                 | 変更する責務                                                                      |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `app/server/realtime/internal/runtimecore/`                                              | メモリ上の確定、checkpoint cut の取得、保存結果と進行状態の分離                   |
| `app/server/realtime/internal/host/`、`cmd/`                                             | 常駐プロセス内の Session 管理、起動・復旧・停止                                   |
| `app/server/realtime/internal/transport/grpc/`、`internal/auth/`、`internal/assignment/` | 認証済み Session への振り分けと Session 単位の fencing                            |
| `app/server/realtime/internal/persistence/http/`                                         | 非同期保存、retry、completion の確定                                              |
| `app/server/control-plane/`                                                              | 複数割り当て、Host 起動世代、容量、Session ごとの readiness / lease、D1 migration |
| `packages/contracts/`                                                                    | 操作結果・保存・復旧の意味と Host 管理契約、必要な生成物                          |
| `app/unity/`、`app/web/audience/`                                                        | 新世代への再接続、旧操作破棄、Snapshot による置換                                 |
| `scripts/runtime-host/`、Realtime 運用文書                                               | 常駐構成、Funnel 接続・復旧の検証                                                 |

## Session ごとの確定と配信

```text
Presenter 入力 / Runtime のタイマー
  ↓
Session ごとの直列処理
  検証 → 状態更新 → Reliable sequence / 操作結果を確定
  ├→ Presenter / Viewer の配信キュー
  └→ checkpoint 対象を更新
         ↓
      保存 worker → Control Plane
```

入力、タイマー、pause / resume、Step 遷移は同じ Session 内で順序を確定する。異なる Session は独立して進行する。外部保存や個別クライアントへの送信を状態更新のクリティカルセクションに含めない。

操作の成功応答は「その実行世代の Runtime が適用済み」を意味し、保存完了を意味しない。入力の fingerprint、操作結果、状態変更は同じメモリ上の確定単位に含め、同じ実行世代内での再送による二重実行防止を維持する。入力同期の READY も通常進行中はメモリ上の確定後に公開し、保存待ちを残さない。

Reliable event は順序を保持する。Pose などの State 配信には既存の最新値への集約規則を適用し、全サンプルの保存キューを作らない。遅いクライアントは既存の配信容量・再同期規則に従い、その送信待ちで Session 全体や他 Session を止めない。

状態・参照の不整合、Runtime の容量違反、認証・権限違反、明示 pause、assignment lease の失効に対する停止・拒否は維持する。保存障害による停止の廃止と、これらの検証規則の緩和を混同しない。

## 非同期 checkpoint

- 変更のある Session を1秒間隔で保存対象にする。送信中や retry 待ちである場合に、要求を無制限に追加しない。
- Canonical Snapshot、Reliable sequence、入力世代、操作結果、Run allocator、Step 履歴などの復旧情報を同一時点の immutable cut として取得する。送信中の cut を書き換えない。
- Session ごとの保存 worker は、送信中の1件と未送信の最新候補までを保持する。新しい完全な checkpoint で未送信の古い候補を置き換え、保存障害中もメモリ使用量をイベント数に比例させない。
- 同じ Session の保存要求は直列化する。checkpoint version は候補ごとに増加させ、同一要求の retry では payload・version・idempotency key を維持する。古い候補を破棄した場合の version の欠番は許容する。
- timeout などで適用結果が不明な要求は冪等に再確認・再試行する。新しい cut に切り替えても、遅れて到着した古い要求が新しい保存結果を上書きできない単調性検証を Control Plane に残す。
- 通信障害などの一時的失敗は backoff 付きで retry する。保存成功まで Runtime の状態を過去へ戻さず、操作結果を保存エラーへ変更しない。保存 callback の権限・世代違反は無条件に retry せず、assignment の有効性と障害原因を確認する。
- Host 全体の同時保存数にも上限を設け、1 Session の retry が他 Session の保存を占有しないようにする。既存の checkpoint サイズ上限と状態変更前の容量検証は維持する。

最終保存成功時刻、保存済み Reliable sequence、現在の Reliable sequence、保存失敗と retry 状態を Session ごとに観測可能にする。ログへ資格情報や checkpoint 本文を出力しない。

1秒は保存を試みる間隔であり、復旧可能なデータの古さの保証ではない。checkpoint が一度も保存されていなければ、クラッシュ前の進行は復元できない。保存結果にかかわらず、同一プロセスが生存している間の再接続には現在のメモリ状態を使い、保存済みの古い状態へ戻さない。

## 複数 Session を収容する Cloud Runtime

```text
Presenter / Viewer
  ↓
Funnel TCP 443 → Caddy TLS → Realtime 共通 listener
                                ↓ 認証済み Session ID
                          Session Manager
                          ├→ Session A の実行・配信・保存
                          └→ Session B の実行・配信・保存
```

Funnel / Caddy は公開経路と TLS を担当する。Session ごとの公開ポートや Funnel 設定は作らない。native gRPC は検証済み JWT、ブラウザ WebSocket は最初の認証メッセージを検証した結果から Session を選択する。未検証の Session ID や任意の要求から実行状態を作成しない。Control Plane の有効な割り当てを取得した Session だけを読み込む。

| 単位               | 責務と寿命                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Session            | Control Plane が発表の識別子、参加者、固定 publication、終了状態を保持する。Runtime の再起動をまたいで維持する                 |
| RuntimeAssignment  | Control Plane が Session の担当 Host、assignment epoch、lease を確定する。1 Session の同時実行 authority は一つとする          |
| Session の実行単位 | 状態、入力・タイマー処理、接続、nonce、replay、保存 worker、assignment guard を個別に保持する                                  |
| Host               | 安定した Runtime ID と公開 endpoint を持ち、容量と稼働 Session を報告する。Host 起動世代で古いプロセスからの管理要求を区別する |

Host の受付可否・収容上限と、既存 Session の lease 更新を分離する。満員または drain 中でも、担当中 Session の lease を受付停止だけで失効させない。収容上限は配備設定で明示し、上限なしの受付は行わない。1 Session の既存参加者数上限は変更しない。

Host heartbeat は稼働 Session と各 assignment epoch、準備状態を報告し、Control Plane は担当する割り当て一覧を返す。Host の生存と各 Session の readiness を分ける。lease は Session ごとに検証・更新し、別 Session の失敗でまとめて失効させない。Host の古い起動世代からの heartbeat、readiness、lease 更新は拒否する。

Session の実行状態は未起動、起動中、復旧中、準備完了、停止処理中、異常を区別する。Control Plane の既存の Session 状態 `Waiting / Presenting / Ended` と、Runtime の実行状態を同一の状態変数にしない。明示的な準備要求で割り当て・起動し、復旧中も含めて準備できた Session だけを ready として報告する。

本計画の実装では、接続者がゼロになったことだけでは Session を自動終了・アンロードしない。後続の [Room 管理と参加導線](console-room-participation.md) で無人状態が10分続いた場合の終了を追加する。終了、明示的な割り当て解放、Host の停止では対象 Session の実行資源を解放する。接続切断時の既存の pause / 入力同期規則は維持する。Host のプロセスクラッシュでは収容中の全 Session が復旧対象になる。

## 復旧と実行世代

Session の実行状態を作り直す場合は、旧 lease が残っていても同じ assignment epoch を再利用しない。

1. Control Plane が現在の割り当てと Host 起動世代を確認し、旧割り当ての lease 更新を止める。同じ Host で旧実行の停止を確認できる場合は、新しい assignment epoch を予約する。停止を確認できない場合は、更新を止めた時点の確定した旧 lease の失効を待ってから予約する。heartbeat の途絶や Control Plane 側の epoch 更新だけを停止確認の代わりにしない。旧 Host の遅延要求が割り当てを取り戻すことも防ぐ。
2. 現行の検証に従い、固定 publication、checkpoint の hash・保存元・version・sequence を確認する。保存済み checkpoint が破損している場合に初期状態へ代替しない。checkpoint が存在しない場合だけ初期状態を使う。
3. 保存済みの進行位置・時計・再生位置・履歴を新世代へ復元する。停止していた実時間は進行に加算せず、`Paused / processRecovered` とする。checkpoint が未作成の復旧も初期状態を `Paused / processRecovered` として構築し、明示 Resume を要求する。新規 Session の初回起動は通常の初期化と区別する。既存の invariant violation による停止理由は維持する。
4. 新しい fence の復旧 checkpoint を保存してから ready を報告する。ここでの保存失敗は復旧中として扱い、通常進行中の保存障害とは区別する。
5. Presenter / Viewer は再 bootstrap し、旧 Resume cursor と未確認の操作を破棄する。新しい Snapshot で状態を全置換し、Presenter の入力同期と明示 Resume 後に進行する。

未保存の操作結果や入力世代も失われ得るため、旧操作を新世代へ自動再送しない。配信済みの Reliable sequence が復旧後に小さくなることは、新しい assignment epoch 内でのみ許容する。同じ fence 内での sequence 後退・イベント ID の再利用は許可しない。旧世代の資格、イベント、checkpoint、completion は拒否する。

Control Plane の障害時に旧 lease の上限を超えて進行したり、ローカル判断で新世代を作ったりしない。保存経路だけが故障している間は進行を継続するが、assignment が更新できず lease が失効した場合は既存どおり停止する。

## 終了・停止

発表終了は通常の checkpoint 集約に混ぜない。Runtime は新たな進行を止め、先行する保存要求との順序を確定した上で最終 checkpoint を含む completion を送る。Control Plane が最終状態の保存、Session の `Ended` 化、割り当て解放を一体で適用し、成功後に終了完了を公開する。

completion が失敗・timeout した場合は、終了要求中として保持して同じ要求を冪等に再試行する。保存障害による自動 pause とは別の、利用者による終了要求の処理とする。終了確定前にプロセスを失った場合は未終了として復旧し得るが、確定していない終了を完了と通知しない。Console からの明示終了は既存の Control Plane 側の終了・解放経路を維持し、Runtime は失効検出後に停止する。

Host の graceful shutdown は新規受付を止め、担当 Session の停止と保存を試みる。既存の10秒の停止期限を上限とし、保存不能によって無期限に終了を待たない。強制終了で未保存分が失われることは通常のクラッシュと同じ復旧規則で扱う。終了していない Session の自動復旧は、現在の担当 Host と履歴が確定できる場合だけ行い、終了済み・明示解放済み・別 Host へ移動済みの割り当てを取り戻さない。

## 実装順序と受け入れ条件

各項目は探索 → Red → Green → Refactor で進め、実装と関連検証を同じ担当範囲で行う。全項目が完了するまでは、この構成を実装済み・公開環境検証済みと記載しない。

1. **契約と保存方式**: 操作結果と入力同期 READY が保存を保証しないこと、同一世代内の重複排除、世代をまたぐ巻き戻りを契約に反映する。通常 mutation の保存待ちを外し、保存 worker と immutable cut を実装する。
   - 保存要求を意図的にブロック・失敗させても、5秒を超えて入力、時計、配信が継続する。
   - 保存失敗で適用済み操作の rollback、エラーへの変更、入力同期の停止が起きない。
   - 保存 worker の保持件数・同時要求数が上限内に収まり、cut の整合、集約、retry の冪等性、version / sequence の単調性を確認する。
2. **複数 Session と Host 管理**: Session Manager、認証後の振り分け、Host heartbeat、割り当て・readiness・lease の複数化を実装する。D1 schema は新しい migration で変更する。
   - 同一 endpoint へ二つ以上の Session を接続し、入力、状態、nonce、replay、保存、終了が混ざらない。
   - 1 Session の slow viewer、保存障害、起動失敗、lease 失効が、他 Session の進行・保存を止めない。
   - 満員時の新規受付拒否、drain 中の既存 lease 更新、同時準備要求時の過剰割り当て防止を確認する。
3. **新世代への復旧と終了**: 同じ Host の再起動や Session 再生成でも新 epoch を予約し、旧要求を fencing する。Unity / Audience の再 bootstrap、旧操作破棄、Snapshot 置換を接続する。
   - 配信済み・未保存の操作を作ってクラッシュさせ、新 epoch の Snapshot へ巻き戻り、paused と明示 Resume、旧操作の拒否を確認する。
   - lease が残った再起動、lease 失効後の再起動、checkpoint 未作成時も paused と明示 Resume になること、破損 checkpoint、旧 Host の遅延 heartbeat / callback を検証する。旧 Runtime が分断中も生存する場合は、停止確認または旧 lease 失効まで新 Runtime が接続・入力・配信を開始せず、同時に二つの authority が進行しない。
   - 最終保存・completion の失敗、応答消失、遅延 checkpoint と終了の競合を検証し、終了確定済み Session を復活させない。
4. **運用と結合検証**: 同じ Funnel URL で複数 Session の native gRPC / WSS、途中参加、切断復帰、Host 再起動を確認する。Session ごとの保存遅延を観測できるようにする。
   - 代表的な Session 数・参加台数で配信遅延と保存負荷を測定し、Host の収容上限を設定する。Funnel の帯域制限を含め、ローカルテストから収容数を推定して確定しない。
   - Contracts の生成・drift、Control Plane、Realtime、Unity / Audience の変更範囲のテストを実施する。Unity の挙動変更は対象 EditMode、同期・復旧は利用可能な licensed Editor で `nix run .#realtime-e2e -- --unity --race` を実施する。
   - 全体の test / build は remote CI に任せる。ローカルで対象を絞れない場合は報告し、全体実行へ切り替えない。実機・Funnel 経由で未検証の範囲を残す。

## 実装・検証状況

- 非同期 checkpoint、複数 Session Host、起動世代・epoch の fencing、復旧・終了の保存境界、Unity / Audience の再 bootstrap を実装した。
- Control Plane の migration `0015_runtime_host_sessions.sql` と OpenAPI / C# 生成物を同期した。Venue Edge は起動 ID の一回限りの bind で同 epoch の別プロセス起動を拒否する。
- 変更範囲の Go race / vet / lint / build、契約テスト、Control Plane と Audience の対象テスト、Unity EditMode を実行した。全体の test / build は実行していない。
- `nix run .#realtime-e2e -- --unity --race` は5シナリオ成功。複数 Session の native gRPC / WSS 隔離、Unity / Audience の同期・描画、旧 lease の失効待ち、新 epoch の paused 復旧と明示 Resume、終了後の再入場拒否を確認した。Funnel 経由・Quest 実機・代表負荷の測定結果は未取得であり、公開環境の収容上限を確定していない。

## 関連文書との整合と対象外

以下の契約・文書を実装に合わせて更新した。公開環境の検証状況は実装状況と分けて記載する。

- [Presenter authority 契約](../packages/CONTRACT_PRESENTER_AUTHORITY.md): 保存成功後だけ Outcome / event / READY を公開する規則を、通常進行のメモリ上の確定へ変更する。
- [配信・実行契約](../packages/CONTRACT_RUNTIME.md): checkpoint 以降の全イベントを復元する前提と `recoveryGap` の扱いを、新世代への巻き戻り許容と区別する。現在の永続化は独立したイベントログを持たない。
- [ADR-0029](../decisions/0029-session-recovery-across-assignment-epochs.md): lease 失効を伴わない再生成でも epoch を更新すること、非同期保存時の損失範囲、複数 Session の担当復旧を反映する。復旧結果の保存後に ready とする境界は維持する。
- [Realtime Architecture](../../app/server/realtime/ARCHITECTURE.md)、[README](../../app/server/realtime/README.md)、[Funnel 手順](../../app/server/realtime/ops/funnel.md): Fly.io を中心とした目標構成と、着手時点の単一 Session の Host / 子プロセス管理を、本計画の構成と区別して更新する。
- [AGENTS.md](../../AGENTS.md): 共有契約を将来の境界とする記述、Runtime の状態・ロジックを `internal/session/` に置く記述を、既存の契約生成と `internal/runtimecore/` の実装に合わせる。Control Plane C# client の未接続と、Unity で利用中の Realtime Protobuf 生成 client は区別する。

永続イベントログや WAL、配信済み操作のゼロ損失、プロセス間の Session 分離、live migration、Fly.io の自動配備、Venue Edge Agent の新規実装、無参加 Session の TTL / 自動終了は対象外とする。Cloud の複数 Session 管理を Venue Edge に自動適用せず、共通 Runtime Core と既存の fencing を維持する。
