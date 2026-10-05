package runtimecore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
)

var (
	ErrV2PresenterRequired      = errors.New("v2 command requires presenter")
	ErrV2IdempotencyKeyReused   = errors.New("v2 command idempotency key reused with different input")
	ErrV2OriginMismatch         = errors.New("v2 command presentation origin mismatch")
	ErrV2ReplayUnavailable      = errors.New("v2 replay range is unavailable")
	ErrV2PersistenceUnavailable = errors.New("v2 runtime persistence unavailable")
)

type v2OutcomeRecord struct {
	fingerprint string
	outcome     *realtimev2.CommandOutcome
}

type V2CheckpointWriter interface {
	WriteCheckpoint(context.Context, *realtimev2.DurableCheckpointEnvelope) error
}

type V2Participant struct {
	UserID string
	Role   string
}
type V2CompletionWriter interface {
	CompleteCheckpoint(context.Context, *realtimev2.DurableCheckpointEnvelope, string, string, []V2Participant) error
}

// V2Session owns canonical progression and serializes command evaluation.
type V2Session struct {
	operationMu               sync.Mutex
	mu                        sync.Mutex
	definition                v2Definition
	rawDefinition             json.RawMessage
	snapshot                  *realtimev2.CanonicalRuntimeSnapshot
	events                    []*realtimev2.ProjectedReliableEvent
	eventTimes                []time.Time
	eventBytes                uint64
	outcomes                  map[string]v2OutcomeRecord
	order                     []string
	outcomeTimes              map[string]time.Time
	subscribers               map[chan *realtimev2.ProjectedReliableEvent]*v2Subscription
	checkpointWriter          V2CheckpointWriter
	checkpointMetadata        *realtimev2.DurableCheckpointEnvelope
	checkpointCatalog         *presentationv2.ProjectedRuntimeCatalog
	validationCatalog         *presentationv2.ProjectedRuntimeCatalog
	mediaSpecs                map[string]map[string]v2MediaSpec
	modelClips                map[string]map[string]v2ModelClipSpec
	tracking                  v2TrackingEvaluator
	completionWriter          V2CompletionWriter
	resumeValidator           func(context.Context) error
	lastTick                  time.Time
	lastCheckpointRuntimeTime uint64
	presence                  map[string]session.Role
	participants              map[string]session.Role
	startedAt                 time.Time
	faultGeneration           uint64
	committedRecovery         *realtimev2.RuntimeRecoveryMetadata
}

func (s *V2Session) ConfigureResumeValidation(validate func(context.Context) error) {
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.resumeValidator = validate
}

func (s *V2Session) ConfigureDurability(writer V2CheckpointWriter, metadata *realtimev2.DurableCheckpointEnvelope, catalog *presentationv2.ProjectedRuntimeCatalog) error {
	if writer == nil || metadata == nil || catalog == nil {
		return ErrV2RuntimeDefinition
	}
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := protocolv2.ValidateSnapshot(s.snapshot, catalog, metadata.AssignmentEpoch); err != nil {
		return err
	}
	s.checkpointWriter = writer
	s.checkpointMetadata = proto.Clone(metadata).(*realtimev2.DurableCheckpointEnvelope)
	s.checkpointCatalog = proto.Clone(catalog).(*presentationv2.ProjectedRuntimeCatalog)
	return nil
}

func (s *V2Session) RestoreCheckpoint(envelope *realtimev2.DurableCheckpointEnvelope) error {
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.checkpointWriter == nil || envelope == nil || len(s.events) != 0 || s.snapshot.ReliableSequence != 0 {
		return ErrV2RuntimeDefinition
	}
	restored, err := protocolv2.DecodeCheckpoint(envelope, s.checkpointMetadata, s.checkpointCatalog)
	if err != nil {
		return err
	}
	recovery, err := protocolv2.DecodeRecoveryMetadata(envelope)
	if err != nil {
		return err
	}
	if recovery == nil {
		return fmt.Errorf("%w: recovery metadata missing", ErrV2RuntimeDefinition)
	}
	if err := s.restoreV2Recovery(recovery); err != nil {
		return err
	}
	s.committedRecovery = recovery
	s.snapshot = restored
	s.lastCheckpointRuntimeTime = restored.Clock.RuntimeTimeMs
	s.lastTick = time.Now()
	s.checkpointMetadata.CheckpointSequence = envelope.CheckpointSequence
	return nil
}

func NewV2Session(raw json.RawMessage) (*V2Session, error) {
	return newV2Session(raw, nil, nil)
}

func NewV2SessionWithBundle(raw, bundle json.RawMessage) (*V2Session, error) {
	var definition v2Definition
	if err := json.Unmarshal(raw, &definition); err != nil {
		return nil, ErrV2RuntimeDefinition
	}
	mediaSpecs, err := buildV2MediaSpecs(definition, bundle)
	if err != nil {
		return nil, err
	}
	modelClips, err := buildV2ModelClips(definition, bundle)
	if err != nil {
		return nil, err
	}
	return newV2Session(raw, mediaSpecs, modelClips)
}

func newV2Session(raw json.RawMessage, mediaSpecs map[string]map[string]v2MediaSpec, modelClips map[string]map[string]v2ModelClipSpec) (*V2Session, error) {
	snapshot, err := newV2InitialSnapshot(raw, mediaSpecs, modelClips)
	if err != nil {
		return nil, err
	}
	var definition v2Definition
	if err := json.Unmarshal(raw, &definition); err != nil {
		return nil, ErrV2RuntimeDefinition
	}
	catalog, err := buildV2CanonicalCatalog(raw, mediaSpecs, modelClips)
	if err != nil {
		return nil, err
	}
	s := &V2Session{definition: definition, rawDefinition: append(json.RawMessage(nil), raw...), snapshot: snapshot, validationCatalog: catalog, mediaSpecs: mediaSpecs, modelClips: modelClips, outcomes: make(map[string]v2OutcomeRecord), outcomeTimes: make(map[string]time.Time), subscribers: make(map[chan *realtimev2.ProjectedReliableEvent]*v2Subscription), lastTick: time.Now(), presence: make(map[string]session.Role), participants: make(map[string]session.Role), startedAt: time.Now()}
	s.committedRecovery = s.v2Recovery()
	return s, nil
}

func BuildV2CanonicalCatalogWithBundle(raw, bundle json.RawMessage) (*presentationv2.ProjectedRuntimeCatalog, error) {
	var definition v2Definition
	if err := json.Unmarshal(raw, &definition); err != nil {
		return nil, ErrV2RuntimeDefinition
	}
	mediaSpecs, err := buildV2MediaSpecs(definition, bundle)
	if err != nil {
		return nil, err
	}
	modelClips, err := buildV2ModelClips(definition, bundle)
	if err != nil {
		return nil, err
	}
	return buildV2CanonicalCatalog(raw, mediaSpecs, modelClips)
}

func (s *V2Session) Snapshot() *realtimev2.CanonicalRuntimeSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
}

func (s *V2Session) FaultGeneration() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.faultGeneration
}

func (s *V2Session) SnapshotAndSubscribe() (*realtimev2.CanonicalRuntimeSnapshot, <-chan *realtimev2.ProjectedReliableEvent, func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	stream := make(chan *realtimev2.ProjectedReliableEvent, 1024)
	s.subscribers[stream] = &v2Subscription{}
	snapshot := proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
	var once sync.Once
	closeSubscription := func() {
		once.Do(func() {
			s.mu.Lock()
			defer s.mu.Unlock()
			if _, found := s.subscribers[stream]; found {
				delete(s.subscribers, stream)
				close(stream)
			}
		})
	}
	return snapshot, stream, closeSubscription
}

func (s *V2Session) Replay(after uint64) ([]*realtimev2.ProjectedReliableEvent, error) {
	return s.ReplayThrough(after, s.Snapshot().ReliableSequence)
}

func (s *V2Session) ReplayThrough(after, through uint64) ([]*realtimev2.ProjectedReliableEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.evictV2Events(time.Now())
	latest := s.snapshot.ReliableSequence
	if through > latest || after > through || (len(s.events) == 0 && after < through) || (len(s.events) != 0 && after < s.events[0].Sequence-1) {
		return nil, ErrV2ReplayUnavailable
	}
	if through-after > 1024 {
		return nil, ErrV2ReplayUnavailable
	}
	result := make([]*realtimev2.ProjectedReliableEvent, 0, through-after)
	bytes := 0
	for _, event := range s.events {
		if event.Sequence > after && event.Sequence <= through {
			bytes += proto.Size(event)
			if bytes > 1<<20 {
				return nil, ErrV2ReplayUnavailable
			}
			result = append(result, proto.Clone(event).(*realtimev2.ProjectedReliableEvent))
		}
	}
	if uint64(len(result)) != through-after {
		return nil, ErrV2ReplayUnavailable
	}
	return result, nil
}

func (s *V2Session) LogicalInput(identity session.Identity, command *realtimev2.LogicalInputCommand) (*realtimev2.CommandOutcome, []*realtimev2.ProjectedReliableEvent, error) {
	return s.LogicalInputContext(context.Background(), identity, command)
}

func (s *V2Session) LogicalInputContext(ctx context.Context, identity session.Identity, command *realtimev2.LogicalInputCommand) (*realtimev2.CommandOutcome, []*realtimev2.ProjectedReliableEvent, error) {
	if err := protocolv2.ValidateMessage(command); err != nil {
		return nil, nil, err
	}
	return s.acceptInput(ctx, identity, v2Input{kind: "logicalInput", clientEventID: command.ClientEventId, logicalEventName: command.LogicalEventName, originVersion: command.PresentationOriginVersion})
}

func (s *V2Session) SurfaceInteraction(identity session.Identity, command *realtimev2.SurfaceInteractionCommand) (*realtimev2.CommandOutcome, []*realtimev2.ProjectedReliableEvent, error) {
	return s.SurfaceInteractionContext(context.Background(), identity, command)
}

func (s *V2Session) SurfaceInteractionContext(ctx context.Context, identity session.Identity, command *realtimev2.SurfaceInteractionCommand) (*realtimev2.CommandOutcome, []*realtimev2.ProjectedReliableEvent, error) {
	if err := protocolv2.ValidateMessage(command); err != nil {
		return nil, nil, err
	}
	return s.acceptInput(ctx, identity, v2Input{kind: "surfaceInteraction", clientEventID: command.ClientEventId, surfaceID: command.SurfaceId, interactionID: command.InteractionId, originVersion: command.PresentationOriginVersion})
}

type v2Input struct {
	kind             string
	clientEventID    string
	logicalEventName string
	surfaceID        string
	interactionID    string
	originVersion    uint64
}

func (s *V2Session) acceptInput(ctx context.Context, identity session.Identity, input v2Input) (*realtimev2.CommandOutcome, []*realtimev2.ProjectedReliableEvent, error) {
	if identity.Role != session.RolePresenter {
		return nil, nil, ErrV2PresenterRequired
	}
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.evictV2Outcomes(time.Now())
	if input.originVersion != s.snapshot.PresentationOrigin.Version {
		return nil, nil, ErrV2OriginMismatch
	}
	key := identity.ParticipantID + "\x00" + input.clientEventID
	fingerprint := v2CommandFingerprint("logical_input", []string{input.logicalEventName}, realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_UNSPECIFIED, input.originVersion)
	if input.kind == "surfaceInteraction" {
		fingerprint = v2CommandFingerprint("surface_interaction", []string{input.surfaceID, input.interactionID}, realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_UNSPECIFIED, input.originVersion)
	}
	if stored, found := s.outcomes[key]; found {
		if stored.fingerprint != fingerprint {
			return nil, nil, ErrV2IdempotencyKeyReused
		}
		return proto.Clone(stored.outcome).(*realtimev2.CommandOutcome), nil, nil
	}
	if s.snapshot.Clock.GetRunning() == nil || s.snapshot.Progression.GetTransitioning() != nil {
		outcome := &realtimev2.CommandOutcome{ClientEventId: input.clientEventID, Result: &realtimev2.CommandOutcome_Rejected{Rejected: &realtimev2.CommandRejected{Reason: realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_RUNTIME_NOT_ACCEPTING_INPUT}}}
		if err := s.commitV2Outcome(ctx, key, fingerprint, outcome); err != nil {
			return nil, nil, err
		}
		return proto.Clone(outcome).(*realtimev2.CommandOutcome), nil, nil
	}
	group := s.definition.Flow.Groups[s.snapshot.Progression.CurrentGroupId]
	step := group.Steps[s.snapshot.Progression.CurrentStepId]
	if input.kind == "surfaceInteraction" {
		surface, found := s.definition.Scene.Surfaces[input.surfaceID]
		var state struct {
			EnabledInteractionIDs []string `json:"enabledInteractionIds"`
		}
		if !found || !surfaceInteractionVisible(s.definition, s.snapshot, input.surfaceID) || json.Unmarshal(surface.States[surfaceStateID(s.snapshot, input.surfaceID)], &state) != nil || !containsV2(state.EnabledInteractionIDs, input.interactionID) {
			outcome := &realtimev2.CommandOutcome{ClientEventId: input.clientEventID, Result: &realtimev2.CommandOutcome_Rejected{Rejected: &realtimev2.CommandRejected{Reason: realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_INTERACTION_UNAVAILABLE}}}
			if err := s.commitV2Outcome(ctx, key, fingerprint, outcome); err != nil {
				return nil, nil, err
			}
			return proto.Clone(outcome).(*realtimev2.CommandOutcome), nil, nil
		}
	}
	var candidates []v2Cue
	inputAvailable := false
	for _, cue := range step.Cues {
		matches := input.kind == "logicalInput" && cue.Trigger.Kind == "logicalInput" && cue.Trigger.Action == input.logicalEventName || input.kind == "surfaceInteraction" && cue.Trigger.Kind == "surfaceInteraction" && cue.Trigger.SurfaceID == input.surfaceID && cue.Trigger.InteractionID == input.interactionID
		if !matches {
			continue
		}
		inputAvailable = true
		if cue.FirePolicy.Kind == "oncePerStepEntry" && containsV2(s.snapshot.StepExecution.ConsumedCueIds, cue.ID) {
			continue
		}
		if !v2GuardPasses(cue, s.snapshot, nil) {
			continue
		}
		if cue.FirePolicy.Kind != "oncePerStepEntry" && cue.FirePolicy.Kind != "repeatable" {
			return nil, nil, ErrV2RuntimeDefinition
		}
		if cue.Next.Kind == "step" {
			if _, found := group.Steps[cue.Next.StepID]; !found {
				return nil, nil, ErrV2RuntimeDefinition
			}
		}
		candidates = append(candidates, cue)
	}
	if !inputAvailable && input.kind == "logicalInput" {
		outcome := &realtimev2.CommandOutcome{ClientEventId: input.clientEventID, Result: &realtimev2.CommandOutcome_Rejected{Rejected: &realtimev2.CommandRejected{Reason: realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_INPUT_UNAVAILABLE}}}
		if err := s.commitV2Outcome(ctx, key, fingerprint, outcome); err != nil {
			return nil, nil, err
		}
		return proto.Clone(outcome).(*realtimev2.CommandOutcome), nil, nil
	}
	previous := proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Priority != candidates[j].Priority {
			return candidates[i].Priority > candidates[j].Priority
		}
		if candidates[i].Order != candidates[j].Order {
			return candidates[i].Order < candidates[j].Order
		}
		return candidates[i].ID < candidates[j].ID
	})
	inputEvent := &realtimev2.ProjectedReliableEvent{}
	if input.kind == "logicalInput" {
		inputEvent.Payload = &realtimev2.ProjectedReliableEvent_LogicalInputAccepted{LogicalInputAccepted: &realtimev2.LogicalInputAccepted{LogicalEventName: input.logicalEventName}}
	} else {
		inputEvent.Payload = &realtimev2.ProjectedReliableEvent_SurfaceInteractionAccepted{SurfaceInteractionAccepted: &realtimev2.SurfaceInteractionAccepted{SurfaceId: input.surfaceID, InteractionId: input.interactionID}}
	}
	inputEvent = s.nextEvent(inputEvent)
	outcome := &realtimev2.CommandOutcome{ClientEventId: input.clientEventID, Result: &realtimev2.CommandOutcome_Accepted{Accepted: &realtimev2.CommandAccepted{CanonicalEventId: inputEvent.EventId, ReliableSequence: inputEvent.Sequence}}}
	events := []*realtimev2.ProjectedReliableEvent{inputEvent}
	if len(candidates) == 0 {
		outcome.GetAccepted().CueEvaluation = &realtimev2.CommandAccepted_CueNotSelected{CueNotSelected: &realtimev2.CueNotSelected{}}
	} else {
		cueEvents, rejection, err := s.applySelectedV2Cue(candidates[0], inputEvent.EventId)
		if err != nil {
			s.snapshot = previous
			return nil, nil, err
		}
		if rejection != nil {
			outcome.GetAccepted().CueEvaluation = &realtimev2.CommandAccepted_CueBatchRejected{CueBatchRejected: rejection}
		} else {
			outcome.GetAccepted().CueEvaluation = &realtimev2.CommandAccepted_CueCommitted{CueCommitted: &realtimev2.CueCommitted{CueId: candidates[0].ID}}
			events = append(events, cueEvents...)
		}
	}
	s.rememberOutcome(key, fingerprint, outcome)
	var err error
	if s.snapshot.Clock.GetTerminating() != nil {
		err = s.commitV2Completion(ctx, previous, events)
	} else {
		err = s.commitV2Mutation(ctx, previous, events)
	}
	if err != nil {
		return nil, nil, err
	}
	return proto.Clone(outcome).(*realtimev2.CommandOutcome), cloneV2Events(events), nil
}

func (s *V2Session) commitV2Mutation(ctx context.Context, previous *realtimev2.CanonicalRuntimeSnapshot, events []*realtimev2.ProjectedReliableEvent, previousTracking ...v2TrackingEvaluator) error {
	recovery := s.v2Recovery()
	if s.checkpointWriter != nil {
		candidate := s.snapshot
		candidateTracking := s.tracking
		metadata := proto.Clone(s.checkpointMetadata).(*realtimev2.DurableCheckpointEnvelope)
		metadata.CheckpointSequence++
		metadata.RecoveryPayload, _ = proto.MarshalOptions{Deterministic: true}.Marshal(recovery)
		catalog := proto.Clone(s.checkpointCatalog).(*presentationv2.ProjectedRuntimeCatalog)
		writer := s.checkpointWriter
		s.snapshot = previous
		if len(previousTracking) != 0 {
			s.tracking = previousTracking[0]
		}
		s.mu.Unlock()
		checkpoint, encodeErr := protocolv2.EncodeCheckpoint(candidate, metadata, catalog)
		var writeErr error
		if encodeErr == nil {
			writeErr = writer.WriteCheckpoint(ctx, checkpoint)
		}
		s.mu.Lock()
		if encodeErr != nil {
			s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION)
			return encodeErr
		}
		if writeErr != nil {
			s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_ATOMIC_COMMIT_FAILED)
			return fmt.Errorf("%w: %v", ErrV2PersistenceUnavailable, writeErr)
		}
		s.snapshot = candidate
		if len(previousTracking) != 0 {
			s.tracking = candidateTracking
		}
		s.checkpointMetadata.CheckpointSequence = checkpoint.CheckpointSequence
		s.lastCheckpointRuntimeTime = candidate.Clock.RuntimeTimeMs
	}
	s.committedRecovery = recovery
	s.publishV2Events(events)
	return nil
}

func (s *V2Session) rollbackV2Fault(previous *realtimev2.CanonicalRuntimeSnapshot, reason realtimev2.PauseReason) {
	s.snapshot = previous
	if s.committedRecovery != nil {
		_ = s.restoreV2Recovery(s.committedRecovery)
	}
	s.snapshot.Clock.Status = &realtimev2.RuntimeClockSnapshot_Paused{Paused: &realtimev2.Paused{Reason: reason}}
	s.lastTick = time.Now()
	s.faultGeneration++
}

func (s *V2Session) publishV2Events(events []*realtimev2.ProjectedReliableEvent) {
	s.events = append(s.events, events...)
	now := time.Now()
	for _, event := range events {
		s.eventTimes = append(s.eventTimes, now)
		s.eventBytes += uint64(proto.Size(event))
	}
	s.evictV2Events(now)
	for subscriber, queue := range s.subscribers {
	delivery:
		for _, event := range events {
			queue.discardConsumed(len(subscriber))
			size := proto.Size(event)
			if queue.bytes+size > 1<<20 {
				delete(s.subscribers, subscriber)
				close(subscriber)
				break delivery
			}
			select {
			case subscriber <- proto.Clone(event).(*realtimev2.ProjectedReliableEvent):
				queue.sizes = append(queue.sizes, size)
				queue.bytes += size
			default:
				delete(s.subscribers, subscriber)
				close(subscriber)
				break delivery
			}
		}
	}
}

func (s *V2Session) evictV2Events(now time.Time) {
	for len(s.events) > 0 && (len(s.events) > 4096 || s.eventBytes > 8<<20 || now.Sub(s.eventTimes[0]) > 15*time.Minute) {
		s.eventBytes -= uint64(proto.Size(s.events[0]))
		s.events = s.events[1:]
		s.eventTimes = s.eventTimes[1:]
	}
}

func (s *V2Session) nextEvent(event *realtimev2.ProjectedReliableEvent) *realtimev2.ProjectedReliableEvent {
	s.snapshot.ReliableSequence++
	sequence := s.snapshot.ReliableSequence
	event.Sequence = sequence
	event.EventId = fmt.Sprintf("event-%d", sequence)
	event.OccurredAtRuntimeTimeMs = s.snapshot.Clock.RuntimeTimeMs
	return event
}

func (s *V2Session) rememberOutcome(key, fingerprint string, outcome *realtimev2.CommandOutcome) {
	now := time.Now()
	s.outcomes[key] = v2OutcomeRecord{fingerprint: fingerprint, outcome: proto.Clone(outcome).(*realtimev2.CommandOutcome)}
	s.order = append(s.order, key)
	s.outcomeTimes[key] = now
	s.evictV2Outcomes(now)
}

func (s *V2Session) evictV2Outcomes(now time.Time) {
	for len(s.order) > 1024 || len(s.order) > 0 && now.Sub(s.outcomeTimes[s.order[0]]) > 15*time.Minute {
		delete(s.outcomes, s.order[0])
		delete(s.outcomeTimes, s.order[0])
		s.order = s.order[1:]
	}
}

func containsV2(values []string, value string) bool {
	for _, entry := range values {
		if entry == value {
			return true
		}
	}
	return false
}

func surfaceStateID(snapshot *realtimev2.CanonicalRuntimeSnapshot, surfaceID string) string {
	for _, state := range snapshot.SurfaceStates {
		if state.SurfaceId == surfaceID && state.TransitionRunId == nil {
			return state.StateId
		}
	}
	return ""
}

func surfaceInteractionVisible(definition v2Definition, snapshot *realtimev2.CanonicalRuntimeSnapshot, surfaceID string) bool {
	if surfaceStateID(snapshot, surfaceID) == "" {
		return false
	}
	surface, found := definition.Scene.Surfaces[surfaceID]
	if !found {
		return false
	}
	id := surface.HostNodeID
	visited := make(map[string]struct{})
	for id != "" {
		if _, duplicate := visited[id]; duplicate {
			return false
		}
		visited[id] = struct{}{}
		active := false
		for _, state := range snapshot.NodeStates {
			if state.NodeId == id {
				active = state.Active && state.Visible
				break
			}
		}
		if !active {
			return false
		}
		node, found := definition.Scene.Nodes[id]
		if !found {
			return false
		}
		if node.Parent.Kind == "stage" || node.Parent.Kind == "" {
			return true
		}
		if node.Parent.Kind != "node" {
			return false
		}
		id = node.Parent.NodeID
	}
	return false
}

func cloneV2Events(events []*realtimev2.ProjectedReliableEvent) []*realtimev2.ProjectedReliableEvent {
	clones := make([]*realtimev2.ProjectedReliableEvent, len(events))
	for i, event := range events {
		clones[i] = proto.Clone(event).(*realtimev2.ProjectedReliableEvent)
	}
	return clones
}
