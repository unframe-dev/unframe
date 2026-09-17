# ADR-0008: Runtime transport、replay、Snapshot の v1 contract を定義する

- **Status**: Accepted
- **Date**: 2026-08-29
- **Deciders**: Unframe 開発チーム
- **関連**: [Presentation Architecture](../presentation/ARCHITECTURE.md), [Realtime Architecture](../../app/server/realtime/ARCHITECTURE.md), [Contracts Architecture](../../packages/contracts/ARCHITECTURE.md), [ADR-0007](./0007-timeline-runtime-run-wire-contract.md)

## Context

Reliable Event、Snapshot、State Stream の意味と atomic cut は Architecture に定義済みだが、exact envelope、field number、retention、catch-up failure、runtime microstep 上限が未確定である。このまま consumer を実装すると、Go、C#、Unity が異なる fence、gap、backpressure 規則を持ち得る。

本 ADR は M2 item 2 として transport contract を固定する。M2 では設計を Accepted にするだけとし、Protocol Buffers source、Go / C# generated artifact、cross-language fixture は M3 の semantic payload 確定後に M5 で一括実装する。現行 `realtime.proto` と単一 `Connect` RPC は foundation のままであり、ここに定義する二接続 protocol が実装済みであるとはみなさない。

## Decision

### Transport と共通 fence

v1 は gRPC 上に独立した Control Connection と State Connection を持つ。Control は reliable / ordered / replayable、State は latest-wins / non-replayable とする。両 connection は `connection_id` と一回使用の `state_connection_nonce` で同じ logical participant connection に束ねる。

```proto
message ControlClientItem {
  oneof item {
    ControlHandshake handshake = 1;
    ReplayRequest replay_request = 2;
    StateReady state_ready = 3;
    // 20..99: idempotent presenter command
  }
  reserved 4 to 19;
}

enum RuntimeCapability {
  RUNTIME_CAPABILITY_UNSPECIFIED = 0;
  RUNTIME_CAPABILITY_RUNTIME_TRANSPORT_V1 = 1;
  RUNTIME_CAPABILITY_TIMELINE_RUN_V1 = 2;
}

message ControlHandshake {
  string protocol_version = 1;
  uint32 progression_contract_version = 2;
  repeated RuntimeCapability supported_capabilities = 3;
}

message ControlConnected {
  string protocol_version = 1;
  uint32 progression_contract_version = 2;
  repeated RuntimeCapability required_capabilities = 3;
  string connection_id = 4;
}

message StateReady {
  uint64 applied_reliable_sequence = 1;
  uint64 presentation_origin_version = 2;
}

message StateConnectionNonce {
  bytes nonce = 1;
  uint32 expires_in_ms = 2;
}

message StateClientItem {
  oneof item {
    StateHandshake handshake = 1;
    // 20..99: Presenter tracking frame
  }
  reserved 2 to 19;
}

message StateHandshake {
  string protocol_version = 1;
  uint32 progression_contract_version = 2;
  repeated RuntimeCapability supported_capabilities = 3;
  string connection_id = 4;
  bytes state_connection_nonce = 5;
}
```

認証済み context が session、participant、role、Runtime assignment を所有し、client payload から identity を採用しない。`protocol_version` は `v1`、`progression_contract_version` は `1`、required capability は `RUNTIME_TRANSPORT_V1` と `TIMELINE_RUN_V1` とする。不一致またはrequired capability不足は最初のSnapshotを作る前に `FAILED_PRECONDITION` とする。clientが追加で送るunknown supported capabilityはauthorityやprojectionを拡張せず無視できるが、serverが返すunknown required capabilityはclientがfail closedにする。State handshakeはControlで選択済みのversion / capabilityと完全一致し、nonceは32 bytes、一回使用、30,000 ms以内でなければならない。M3 で追加する command / tracking payload はreserved rangeと衝突させない。

すべての projected event、Snapshot、State frame は次の fence を持つ。

```proto
message PublicationFence {
  string presentation_id = 1;
  uint64 publication_epoch = 2;
  string publication_manifest_hash = 3;
}

message RuntimeProjectionFence {
  string session_id = 1;
  PublicationFence publication = 2;
  uint64 assignment_epoch = 3;
  string projection_profile_id = 4;
  uint64 presentation_origin_version = 5;
}
```

required message presence、non-empty ID / hash、zero ではない publication / assignment epoch を検証する。`presentation_origin_version = 0` は初期versionとして有効である。不一致、空 message、unknown / `UNSPECIFIED` enum は適用せず Connection Resume を要求する。

### Control item と Reliable Event

server-to-client の ordered Control item は次に固定する。

```proto
message ControlServerItem {
  oneof item {
    ControlConnected connected = 1;
    ConnectionSnapshotEnvelope connection_snapshot = 2;
    ProjectedReliableEvent reliable_event = 3;
    ProjectionAdvance projection_advance = 4;
    CommandOutcome command_outcome = 5;
    StateConnectionNonce state_connection_nonce = 6;
    ResyncRequired resync_required = 7;
  }
}

message ProjectedReliableEvent {
  uint64 sequence = 1;
  string event_id = 2;
  optional string cause_event_id = 3;
  uint64 occurred_at_runtime_time_ms = 4;
  RuntimeProjectionFence fence = 5;
  oneof payload {
    RuntimeStatusChanged runtime_status_changed = 20;
    // 21..99: Runtime lifecycle / fault
    // 100..199: Progression / Cue
    // 200..299: Surface / Node / Variable
    TimelineStarted timeline_started = 300;
    TimelineCompleted timeline_completed = 301;
    TimelineCanceled timeline_canceled = 302;
    // 303..399: Runtime Run / Media
    // 400..499: Presence / session lifecycle
  }
  reserved 6 to 19;
  reserved 500 to 999;
}

message ProjectionAdvance {
  RuntimeProjectionFence fence = 1;
  uint64 from_exclusive = 2;
  uint64 through_sequence = 3;
}
```

`sequence` は canonical session-global sequence であり、projected item ごとに採番し直さない。`ProjectionAdvance` は直前に client が適用済みの sequence と `from_exclusive` が一致し、`through_sequence > from_exclusive` の場合だけ適用する。marker は不可視 event の payload、件数以外の属性、個別時刻を持たない。不可視範囲だけでは送信せず、次の可視 event の直前に最大一件へ集約する。

payload に `google.protobuf.Any`、JSON、opaque bytes を使用しない。M3 で確定する各 semantic payload は上記 range に named message として追加する。ADR-0007 の Runtime status / Timeline lifecycle は対応する range に割り当て、required payload variant を解釈できない consumer は fail closed とする。

ADR-0007 で semantic shape を決めた message の field number は次に固定する。

```proto
message RuntimeRunId { uint64 assignment_epoch = 1; uint64 run_sequence = 2; }
message RuntimeRunOwner { oneof scope { PresentationRunOwner presentation = 1; GroupRunOwner group = 2; } }
message PresentationRunOwner {}
message GroupRunOwner { string group_id = 1; uint64 group_entry_epoch = 2; }
message RuntimeRunCause { string cue_id = 1; string cause_event_id = 2; string group_id = 3; uint64 group_entry_epoch = 4; string step_id = 5; uint64 step_entry_epoch = 6; }
enum RunCompletion { RUN_COMPLETION_UNSPECIFIED = 0; RUN_COMPLETION_BLOCKING = 1; RUN_COMPLETION_NON_BLOCKING = 2; }
enum TimelineCancelReason { TIMELINE_CANCEL_REASON_UNSPECIFIED = 0; TIMELINE_CANCEL_REASON_EXPLICIT_STOP = 1; TIMELINE_CANCEL_REASON_GROUP_EXIT = 2; TIMELINE_CANCEL_REASON_PRESENTATION_ENDED = 3; }
message TimelineStarted { RuntimeRunId run_id = 1; string timeline_id = 2; RuntimeRunOwner owner = 3; RuntimeRunCause cause = 4; RunCompletion completion = 5; uint64 started_at_runtime_time_ms = 6; }
message TimelineCompleted { RuntimeRunId run_id = 1; string timeline_id = 2; }
message TimelineCanceled { RuntimeRunId run_id = 1; string timeline_id = 2; TimelineCancelReason reason = 3; }
message TimelineRunSnapshot { RuntimeRunId run_id = 1; string timeline_id = 2; RuntimeRunOwner owner = 3; RuntimeRunCause cause = 4; RunCompletion completion = 5; uint64 started_at_runtime_time_ms = 6; }
message RuntimeStatusChanged { oneof status { Running running = 1; Paused paused = 2; Terminating terminating = 3; } }
message Running {}
message Paused { PauseReason reason = 1; }
message Terminating { TerminationReason reason = 1; }
enum PauseReason { PAUSE_REASON_UNSPECIFIED = 0; PAUSE_REASON_PRESENTER_DISCONNECTED = 1; PAUSE_REASON_ASSIGNMENT_LEASE_EXPIRED = 2; PAUSE_REASON_PROCESS_RECOVERED = 3; PAUSE_REASON_INVARIANT_VIOLATION = 4; PAUSE_REASON_ATOMIC_COMMIT_FAILED = 5; PAUSE_REASON_MICROSTEP_LIMIT_EXCEEDED = 6; PAUSE_REASON_RECOVERY_GAP = 7; }
enum TerminationReason { TERMINATION_REASON_UNSPECIFIED = 0; TERMINATION_REASON_EXPLICIT_END = 1; TERMINATION_REASON_CONTROL_PLANE_ENDED = 2; TERMINATION_REASON_PAUSE_TIMEOUT = 3; }
```

### Replay と resync

```proto
message ReplayRequest {
  uint64 after_sequence = 1;
}

message ResyncRequired {
  ResyncReason reason = 1;
  uint64 newest_reliable_sequence = 2;
}

enum ResyncReason {
  RESYNC_REASON_UNSPECIFIED = 0;
  RESYNC_REASON_REPLAY_RANGE_UNAVAILABLE = 1;
  RESYNC_REASON_PROJECTION_CHANGED = 2;
  RESYNC_REASON_PUBLICATION_FENCE_CHANGED = 3;
  RESYNC_REASON_PRESENTATION_ORIGIN_CHANGED = 4;
  RESYNC_REASON_SNAPSHOT_CATCH_UP_EXHAUSTED = 5;
}
```

Replay は `after_sequence + 1` から contiguous に返す。範囲外、fence変更、payload compatibility failure では推測した sequence へ進めず `ResyncRequired` 後に live delivery を停止する。client は同じ connection で部分的な replay と新しい Snapshot を混在させず、新しい Connection Resume を開始する。`after_sequence = 0` と Snapshot の `reliable_sequence = 0` はevent未発生のcutとして有効だが、Reliable Event自身の `sequence = 0` はinvalidとする。

### Connection Snapshot と durable checkpoint

```proto
message ConnectionSnapshotEnvelope {
  uint32 schema_version = 1;
  string connection_id = 2;
  RuntimeProjectionFence fence = 3;
  ProjectionInstance projection_instance = 4;
  ProjectedPresenceState presence_at_cut = 5;
  uint64 reliable_sequence = 6;
  ProjectedRuntimeSnapshot snapshot = 7;
}

message DurableCheckpointEnvelope {
  uint32 schema_version = 1;
  uint64 checkpoint_sequence = 2;
  string session_id = 3;
  string runtime_id = 4;
  RuntimeKind runtime_kind = 5;
  uint64 assignment_epoch = 6;
  PublicationFence publication = 7;
  string definition_hash = 8;
  string render_bundle_hash = 9;
  uint64 reliable_sequence = 10;
  string canonical_snapshot_hash = 11;
  bytes canonical_snapshot_payload = 12;
}
```

`schema_version` の現在値は `1` とする。Connection Snapshot は projected state と presence を持つ派生物で、durable restore に使用しない。Durable checkpoint のfield 12はM3で定義するnamed `CanonicalRuntimeSnapshot` messageのprotobuf wire bytesであり、任意application payloadではない。participant、connection、projection、presence、tracking sampleを含めない。`canonical_snapshot_hash` は受信したfield 12のbyte列そのものに対するSHA-256 lowercase hexとし、hashを検証してから同じschema versionの`CanonicalRuntimeSnapshot`としてparseし、semantic invariantを検証する。writerはunknown fieldを含めずdeterministic serializationを使用し、M5のbinary fixtureを正本にする。consumerは検証のためにparse / reserializeしたbytesをhash sourceにしない。

Connection envelopeのfield 6は`ProjectedRuntimeSnapshot.reliable_sequence`と、Durable envelopeのfield 10はparse後の`CanonicalRuntimeSnapshot.reliable_sequence`と必ず一致する。不一致はSnapshot全体をfail closedにし、外側または内側の値を選んで継続しない。外側sequenceはpayloadを適用する前のreplay cursor検査、内側sequenceはsnapshot invariantとportable fixtureに使用する。

Snapshot は `reliable_sequence = S` の immutable cut と `S + 1` subscriber 登録を同じ critical section で確定する。projection / serialization 中の event は bounded catch-up queue に保持する。queue overflow 時は生成物と subscriber を破棄して新しい cut から再試行し、部分 Snapshot を公開しない。

### State Stream

```proto
enum StateFrameKind {
  STATE_FRAME_KIND_UNSPECIFIED = 0;
  STATE_FRAME_KIND_KEYFRAME = 1;
  STATE_FRAME_KIND_DELTA = 2;
}

message ElementStateFrame {
  RuntimeProjectionFence fence = 1;
  uint64 frame_sequence = 2;
  uint64 produced_at_runtime_time_ms = 3;
  uint64 oldest_change_at_runtime_monotonic_ms = 4;
  uint64 base_reliable_sequence = 5;
  StateFrameKind kind = 6;
  repeated ElementStatePatch elements = 7;
  repeated ProjectedAnchorBindingPatch anchor_bindings = 8;
  uint64 produced_at_runtime_monotonic_ms = 9;
}

message CoordinateVector3 { double x = 1; double y = 2; double z = 3; }
message CoordinateQuaternion { double x = 1; double y = 2; double z = 3; double w = 4; }
message AnchorBindingUnavailable {}
message ProjectedAnchorBindingSample {
  uint64 tracking_frame_sequence = 1;
  uint64 observed_at_runtime_monotonic_ms = 2;
  optional CoordinateVector3 position = 3;
  optional CoordinateQuaternion rotation = 4;
}
message ProjectedAnchorBindingPatch {
  string node_id = 1;
  oneof state {
    AnchorBindingUnavailable unavailable = 2;
    ProjectedAnchorBindingSample sample = 3;
  }
}
```

`ElementStatePatch` の具体 field は M3 の Node / Media state contract と同時に確定する。patch は explicit presence を持つ scalar / message field を使用し、`active` と `visible` を別 field として保持する。`field_mask` と値の矛盾、duplicate element ID、profile 外 resource を拒否する。Timeline-owned property、crossfade weight、interaction enabled state は含めない。

`anchor_bindings`はraw Presenter poseのcatalogではなく、profile内のvisible Nodeが直接参照するAnchor parentをNode IDごとにprojectしたephemeral stateである。Nodeの`followPosition`がtrueの場合だけ`position`をrequired、falseなら禁止し、`followRotation`も同様に扱う。両方falseのAnchor parentはbuild errorとする。followしないposition成分はzero translation、followしないrotation成分はidentity Quaternionとしてparent matrixを構成し、その後にNode local matrixを乗じる。別Node、profile外Node、参照されないAnchor targetのposeを含めず、target名をState wireへ重複しない。`KEYFRAME`はvisibleな全Anchor-bound Nodeをexactly once、`DELTA`は変更sampleまたは`unavailable` tombstoneだけを含む。duplicate Node ID、空oneof、profile外Node、follow fieldの過不足、non-canonical Quaternionを拒否する。

`anchorSampleMaxAgeMilliseconds`は下表のAnchor binding sample ageであり、`500`に固定する。Runtimeはframe生成時、clientは同期済みRuntime monotonic timeでそれぞれageを検査する。超過、tracking unavailable、Origin version不一致では`unavailable`へ収束し、次のfresh sampleまで該当Nodeを描画もhit-testもしない。`observed_at_runtime_monotonic_ms`はRuntime受理時刻であり、client申告のcapture時刻をfreshness authorityにしない。

State frame は保存・replayしない。server はconnectionごとにsingle-slot mailboxを持ち、Element patchはelement / field単位、Anchor bindingはNode ID単位のsample / tombstone全体でlatest-wins mergeする。同じAnchor sampleのposition / rotationを別tracking frameから合成しない。dequeueは一つのcritical sectionでElement map、Anchor map、最古monotonic change、logical runtime time、Runtime monotonic time、reliable / Origin fenceをimmutable frameへfreezeし、その後に`frame_sequence`を採番する。keyframe生成も同じcutでcurrent Element / projected Anchor binding mapをfreezeする。送信中のframeは変更せず、後続変更は次のmailboxへmergeする。Runtimeが`Running`の場合だけ、初回と再接続時に`KEYFRAME`一件を適用してから`DELTA`を受理する。`Paused`中はState Connectionだけを確立してframeを送らず、`RuntimeStatusChanged(running)`の適用後に`KEYFRAME`一件を送る。gap、stale fence、古い `base_reliable_sequence`、buffer overflow では delta を補完せず State Connection を再確立する。Control Connection と他 participant は停止しない。

### RuntimeProtocolLimits v1

上限は protocol version `v1` の interoperability contract とし、server 設定で緩和・拡張しない。deployment固有のresource不足はSession assignment前に admission error とし、接続後により小さいlimitへ暗黙変更しない。

| Limit                            |                                    v1 value | Rule                                                                           |
| -------------------------------- | ------------------------------------------: | ------------------------------------------------------------------------------ |
| reliable event log               |         4,096 events, 8 MiB, and 900,000 ms | canonical eventのcount、wire bytes、ageの先に達した境界より古いeventをeviction |
| one replay response              |    1,024 Control items and 1 MiB serialized | 超える場合は `RESYNC_REASON_REPLAY_RANGE_UNAVAILABLE` で Snapshotへ切替        |
| per-connection catch-up queue    |    1,024 Control items and 1 MiB serialized | どちらか超過で current Snapshot attempt を破棄                                 |
| Connection Snapshot attempts     |                3 attempts including initial | attemptごとに新しい canonical cut を取得                                       |
| Connection Snapshot total budget |                    250 ms monotonic elapsed | 超過で `RESYNC_REASON_SNAPSHOT_CATCH_UP_EXHAUSTED`                             |
| idempotency outcome window       |                    1,024 IDs and 900,000 ms | session / participant ごと。どちらかの境界で eviction                          |
| State dependency buffer          |       4,096 element-field values and 500 ms | 超過で State Connection を再確立                                               |
| Anchor binding sample age        |                                      500 ms | Runtime / clientで失効し`unavailable`へ収束                                    |
| runtime microsteps               | 1,024 per external input or due-event drain | 次の microstep を適用せず Runtime を pause                                     |

MiB は `1,048,576` bytes、serialized size は protobuf message の wire sizeで計測する。event log の age は event の logical runtime time ではなく server monotonic retention age であり、Runtime Pause 中も eviction を継続する。durable checkpoint の保存期間・頻度は deployment policyであり、この replay retention から導出しない。

microstep は canonical mutation の結果として同じ drain 内に生成され、次の Cue / zero-duration completion / progression transition を評価する一回を指す。外部 input または logical deadline batch ごとに `0` から開始し、goroutine yield、Snapshot、network write で reset しない。1,024回目までに確定した atomic mutation は保持し、1,025回目は評価も適用もせず、`paused / microstepLimitExceeded` と fault event を一つの atomic mutationとして確定する。

### Compatibility と consumer responsibility

- additive unknown optional protobuf field は保持または無視できる。
- unknown enum、unknown required oneof variant、schema major、required capability は fail closed とする。
- field number と意味を再利用しない。削除した field / enum number は `reserved` にする。
- Control item、Snapshot、State frame は同じ `progressionContractVersion = 1` と required capability set に拘束する。streamごとの downgradeを許可しない。
- Go Realtime は limits、atomic cut、projection、replay、mailbox、microstep fault の authorityを持つ。
- TypeScript contracts / Compiler は Publication / Projection closure と required capabilities を検証する。
- generated C# client は envelope / enum / gap / fence を検証し、Unity adapter は Snapshot → replay → keyframe の適用順を守る。

## Consequences

- reliable / projected / latest-wins state の順序と failure が consumer 間で一致する。
- Snapshot serialization は型付き protobuf に固定され、opaqueな application snapshotを transport contract として固定しない。
- retention と microstep の bounded behavior を fixture と fault testで検証できる。
- M5 では foundation protocol を target protocolへ置換する breaking changeになる。未完成の旧 `v1` を互換維持する bridge は追加しない。

## Alternatives Considered

### event を participant ごとに連番化する

projection後の番号では canonical cut と replay位置を共有できず、不可視 event の存在を扱う別の正本が必要になるため採用しない。

### Snapshot payload を任意 JSON / untyped bytes にする

cross-language drift、required field、unknown variantをgeneratorで検出できないため採用しない。Durable envelopeのfield 12はnamed protobuf messageのwire bytesに限定し、exact hash sourceを保持するための型付きencodingである。

### unbounded replay または State queue

slow clientがsession memoryとlatencyを支配するため採用しない。

## Follow-ups

- M3 で semantic payload、`ProjectedRuntimeSnapshot`、`CanonicalRuntimeSnapshot`、`ElementStatePatch` を各縦断sliceと同時に確定する。
- M5 で `.proto`、Go / C# generation、breaking-change report、cross-language binary fixtureを実装する。
- `stateWriteBlockTimeout`、server-to-client message size、Tracking rateは実機計測を伴うRealtime implementationで別途固定する。
