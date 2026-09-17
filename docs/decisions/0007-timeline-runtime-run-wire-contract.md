# ADR-0007: Timeline と Runtime Run の semantic wire contract を定義する

- **Status**: Accepted
- **Date**: 2026-08-29
- **Deciders**: Unframe 開発チーム
- **関連**: [Presentation Architecture](../presentation/ARCHITECTURE.md), [Realtime Architecture](../../app/server/realtime/ARCHITECTURE.md), [Contracts Architecture](../../packages/contracts/ARCHITECTURE.md), [ADR-0006](./0006-presentation-rendering-strategy.md)

## Context

Timeline の時間補間を全 client の State Stream へ毎 frame 配送すると、authority、replay、projection、帯域の責務が混在する。一方で client が Timeline 定義または Run lifecycle を知らなければ、pause-aware clock 上で同じ表示を補間できない。本 ADR は M2 item 1 の実装前 **semantic wire contract** を固定する。field number を含む transport contract は [ADR-0008](./0008-runtime-transport-contract.md) で固定し、現行 `realtime.proto` は foundation のままである。

## Decision

### Catalog、authority、State Stream

- `TimelineDefinition` は immutable `PresentationDefinition` catalog の一部とし、`PublishedPresentation` が固定する。Delivery は ProjectionProfileDescriptor で可視な Timeline の subset だけを送る。lifecycle event に定義全体を複製しない。
- Trigger、Cue、Run 作成・停止・完了、最終値 commit は割り当て済み **Runtime Core** だけが authority を持つ。client は Delivery 済み catalog、active Run、pause-aware logical runtime time から表示値を local interpolation する。
- State Stream は tracking 等の **Timeline 以外**の連続状態と bounded corrective keyframe に限定する。Timeline の毎 frame 値は送らず、keyframe は authority、completion source、replay source にしない。

### Runtime Run と lifecycle

field number は ADR-0008を正本とし、message の意味と presence は次に固定する。

```proto
message RuntimeRunId {
  uint64 assignment_epoch = ...;
  uint64 run_sequence = ...;
}
message RuntimeRunOwner { oneof scope { PresentationRunOwner presentation = ...; GroupRunOwner group = ...; } }
message PresentationRunOwner {}
message GroupRunOwner { string group_id = ...; uint64 group_entry_epoch = ...; }
message RuntimeRunCause {
  string cue_id = ...;
  string cause_event_id = ...;
  string group_id = ...;
  uint64 group_entry_epoch = ...;
  string step_id = ...;
  uint64 step_entry_epoch = ...;
}
enum RunCompletion { RUN_COMPLETION_UNSPECIFIED = 0; RUN_COMPLETION_BLOCKING = ...; RUN_COMPLETION_NON_BLOCKING = ...; }
enum TimelineCancelReason { TIMELINE_CANCEL_REASON_UNSPECIFIED = 0; EXPLICIT_STOP = ...; GROUP_EXIT = ...; PRESENTATION_ENDED = ...; }
message TimelineStarted { RuntimeRunId run_id = ...; string timeline_id = ...; RuntimeRunOwner owner = ...; RuntimeRunCause cause = ...; RunCompletion completion = ...; uint64 started_at_runtime_time_ms = ...; }
message TimelineCompleted { RuntimeRunId run_id = ...; string timeline_id = ...; }
message TimelineCanceled { RuntimeRunId run_id = ...; string timeline_id = ...; TimelineCancelReason reason = ...; }
message TimelineRunSnapshot { RuntimeRunId run_id = ...; string timeline_id = ...; RuntimeRunOwner owner = ...; RuntimeRunCause cause = ...; RunCompletion completion = ...; uint64 started_at_runtime_time_ms = ...; }
```

`RuntimeRunId` は session / assignment scoped であり、`run_sequence` は assignment 内で単調増加する。logical runtime time は pause-aware な非負 `uint64` milliseconds であり、`0` は有効である。`TimelineCompleted` / `TimelineCanceled` の completion / cancel 時刻は Reliable Event envelope の `occurredAtRuntimeTimeMilliseconds` を正本とし、payload に重複させない。`TimelineRunSnapshot` は Started 相当の active fields だけを持つ。required message は presence、string ID は non-empty を要求し、assignment epoch / run sequence の zero、`UNSPECIFIED` enum、空 oneof は invalid とする。

`TimelineCanceled.reason` は次の明示 stop reason のいずれかを持つ。

- `explicitStop`
- `groupExit`
- `presentationEnded`

`active RuntimeRunSnapshot` は Snapshot と projected active-run view に含め、Run ID、Timeline ID、owner / cause epoch、completion、開始 logical time を表す。duration / track は immutable catalog から解決する。Run lifetime 全体を一つの commit とせず、開始は Run 追加・blocking set 更新・`TimelineStarted` を一つの mutation とする。normal completion は最終値 commit・Run 除去・blocking set 更新・`TimelineCompleted`・派生 progression transition を一つの mutation とする。`explicitStop` / `groupExit` は停止時の現在値 commit・Run 除去・`TimelineCanceled` を一つの mutation とする。`presentationEnded` は値を commit せず、run ID 順の `TimelineCanceled` 後に `PresentationEnded` を確定する。completion は Runtime Core の logical deadline だけが source であり、stale Run ID、owner epoch 不一致、重複 completion は state / event を変更しない。completion event はその completion が解除する派生 Group / Step event より先に投影する。

### Runtime status と fault

```proto
message RuntimeStatusChanged {
  oneof status { Running running = ...; Paused paused = ...; Terminating terminating = ...; }
}
message Running {}
message Paused { PauseReason reason = ...; }
message Terminating { TerminationReason reason = ...; }
enum PauseReason { PAUSE_REASON_UNSPECIFIED = 0; PRESENTER_DISCONNECTED = ...; ASSIGNMENT_LEASE_EXPIRED = ...; PROCESS_RECOVERED = ...; INVARIANT_VIOLATION = ...; ATOMIC_COMMIT_FAILED = ...; MICROSTEP_LIMIT_EXCEEDED = ...; RECOVERY_GAP = ...; }
enum TerminationReason { TERMINATION_REASON_UNSPECIFIED = 0; EXPLICIT_END = ...; CONTROL_PLANE_ENDED = ...; PAUSE_TIMEOUT = ...; }
```

Runtime fault は terminating ではなく `paused` とし、`PauseReason` で invariant violation、atomic commit failure、microstep overflow、recovery gap を区別する。`terminating` は `explicitEnd`、`controlPlaneEnded`、`pauseTimeout` の不可逆終了だけに用いる。recovery で `running` を暗黙再開せず、`processRecovered` の `paused` として復元する。

### Projection と compatibility

Projection は hidden Timeline / Run / target ID を event、snapshot、State Stream に漏らさない。Timeline と全 target が同じ profile visibility closure を満たさない PublishedPresentation は session 開始前の build / Delivery validation error とする。partial projection と auto split は v1 で禁止し、split は将来 contract version の work とする。

Delivery / handshake target contract は `progressionContractVersion = 1` と required capability `TIMELINE_RUN_V1` を必須化する。unsupported major、unknown required capability は `FAILED_PRECONDITION` とし downgrade fallback を許可しない。proto3 の unknown optional field は許容して無視できるが、semantic required field の追加は version / capability を必須にする。unknown / `UNSPECIFIED` enum と未知の required event variant は fail closed で Connection Resume を要求する。

### Consumer responsibility

| Consumer                        | Responsibility                                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| TypeScript contracts / Compiler | catalog、visibility closure、version / required capability を検証し、portable fixture を提供する                             |
| Go Realtime                     | Runtime Core authority、atomic commit、Run allocator、stale completion reject、projection を実装する                         |
| C# generated client             | protobuf version / enum を fail closed に decode し、Delivery / Runtime projection のみを公開する                            |
| Unity Runtime                   | catalog と projected Run を検証し local interpolation する。Timeline completion や corrective keyframe を authority としない |

## Consequences

- Timeline の帯域は Run lifecycle と Snapshot に収束し、表示の連続性は local interpolation が担う。
- Runtime / Delivery / client の clock と completion source が分離される。
- protobuf、cross-language fixture、capability negotiation、recovery implementation は M5 以降で追加する。本 ADR 自体は proto / code を変更しない。

## Alternatives Considered

### Timeline frame を State Stream で配送する

帯域と replay を増やし、keyframe を authority と誤認する境界を作るため採用しない。

### audience ごとの Timeline auto split

同じ PublishedPresentation の意味と ID を配信時に変えるため v1 では採用しない。

## Follow-ups

- M2 item 2 の field number、Reliable Event envelope、retention / replay、runtime microstep 上限は [ADR-0008](./0008-runtime-transport-contract.md) で Accepted とした。
- canonical event-kind、stable target ID、Run ID 順の同一 logical time ordering と、`presentationEnded` が Timeline cancel を先に確定する順序は Presentation Architecture の既存規則を適用する。
