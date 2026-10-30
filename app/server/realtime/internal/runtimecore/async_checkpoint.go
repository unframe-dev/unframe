package runtimecore

import (
	"context"
	"errors"
	"fmt"
	"time"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"google.golang.org/protobuf/proto"
)

type CheckpointStatus struct {
	LastSuccess             time.Time
	SavedReliableSequence   uint64
	CurrentReliableSequence uint64
	Failures                uint64
	Retrying                bool
	InFlight                bool
	Pending                 bool
	LastError               string
}

type checkpointCompletion struct {
	envelope           *realtimev2.DurableCheckpointEnvelope
	snapshot           *realtimev2.CanonicalRuntimeSnapshot
	recovery           *realtimev2.RuntimeRecoveryMetadata
	tracking           v2TrackingEvaluator
	events             []*realtimev2.ProjectedReliableEvent
	startedAt, endedAt string
	participants       []V2Participant
}

type checkpointState struct {
	concurrency       chan struct{}
	completion        *checkpointCompletion
	io                chan struct{}
	revision          uint64
	version           uint64
	savedVersion      uint64
	savedRevision     uint64
	workerRunning     bool
	completing        bool
	completionBlocked bool
	status            CheckpointStatus
}

type checkpointCut struct {
	envelope *realtimev2.DurableCheckpointEnvelope
	revision uint64
	writer   V2CheckpointWriter
}

func (s *V2Session) CheckpointStatus() CheckpointStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := s.durability.status
	result.CurrentReliableSequence = s.snapshot.ReliableSequence
	return result
}

// checkpointCutLocked captures all recovery data under the same session lock.
func (s *V2Session) checkpointCutLocked() (checkpointCut, error) {
	if s.checkpointWriter == nil || s.durability.completing {
		return checkpointCut{}, ErrV2PersistenceUnavailable
	}
	metadata := proto.Clone(s.checkpointMetadata).(*realtimev2.DurableCheckpointEnvelope)
	s.durability.version++
	metadata.CheckpointSequence = s.durability.version
	recovery := s.v2Recovery()
	snapshot := proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
	catalog := s.checkpointCatalog
	cut := checkpointCut{revision: s.durability.revision, writer: s.checkpointWriter}
	s.mu.Unlock()
	var err error
	metadata.RecoveryPayload, err = proto.MarshalOptions{Deterministic: true}.Marshal(recovery)
	if err == nil {
		cut.envelope, err = protocolv2.EncodeCheckpoint(snapshot, metadata, catalog)
	}
	s.mu.Lock()
	return cut, err
}

func acquireCheckpointSlot(ctx context.Context, slot chan struct{}) error {
	if slot == nil {
		return nil
	}
	select {
	case slot <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *V2Session) writeCheckpoint(ctx context.Context, writer V2CheckpointWriter, envelope *realtimev2.DurableCheckpointEnvelope, concurrency chan struct{}) error {
	s.mu.Lock()
	if concurrency == nil {
		concurrency = s.durability.concurrency
	}
	s.mu.Unlock()
	if err := acquireCheckpointSlot(ctx, s.durability.io); err != nil {
		return err
	}
	if s.durability.io != nil {
		defer func() { <-s.durability.io }()
	}
	if err := acquireCheckpointSlot(ctx, concurrency); err != nil {
		return err
	}
	if concurrency != nil {
		defer func() { <-concurrency }()
	}
	s.mu.Lock()
	if envelope.CheckpointSequence <= s.durability.savedVersion || s.durability.completing {
		s.mu.Unlock()
		return nil
	}
	s.durability.status.InFlight = true
	s.mu.Unlock()
	err := writer.WriteCheckpoint(ctx, envelope)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.durability.status.InFlight = false
	if err != nil {
		s.durability.status.Failures++
		s.durability.status.LastError = err.Error()
	} else {
		s.durability.savedVersion = envelope.CheckpointSequence
		s.durability.status.LastSuccess = time.Now()
		s.durability.status.SavedReliableSequence = envelope.ReliableSequence
		s.durability.status.LastError = ""
		s.checkpointMetadata.CheckpointSequence = envelope.CheckpointSequence
	}
	return err
}

func (s *V2Session) saveCut(ctx context.Context, cut checkpointCut, concurrency chan struct{}) error {
	err := s.writeCheckpoint(ctx, cut.writer, cut.envelope, concurrency)
	if err == nil {
		s.mu.Lock()
		if cut.revision > s.durability.savedRevision {
			s.durability.savedRevision = cut.revision
		}
		s.mu.Unlock()
	}
	return err
}

// FlushCheckpoint makes one bounded attempt. It never rolls back live state.
func (s *V2Session) FlushCheckpoint(ctx context.Context) error {
	s.operationMu.Lock()
	s.mu.Lock()
	if s.durability.completion != nil {
		err := s.tryCompletionLocked(ctx)
		s.mu.Unlock()
		s.operationMu.Unlock()
		return err
	}
	cut, err := s.checkpointCutLocked()
	s.mu.Unlock()
	s.operationMu.Unlock()
	if err != nil {
		return err
	}
	return s.saveCut(ctx, cut, nil)
}

// RunCheckpointWorker retains one retry and one replaceable, complete cut.
func (s *V2Session) RunCheckpointWorker(ctx context.Context, concurrency chan struct{}) error {
	return s.runCheckpointWorker(ctx, concurrency, time.Second)
}

func (s *V2Session) runCheckpointWorker(ctx context.Context, concurrency chan struct{}, interval time.Duration) error {
	s.mu.Lock()
	if s.durability.workerRunning || s.checkpointWriter == nil {
		s.mu.Unlock()
		return ErrV2RuntimeDefinition
	}
	s.durability.workerRunning = true
	s.durability.concurrency = concurrency
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.durability.workerRunning = false
		s.durability.status.Pending = false
		s.durability.status.Retrying = false
		s.mu.Unlock()
	}()
	workerCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	pending := make(chan checkpointCut, 1)
	producerDone := make(chan struct{})
	go func() {
		defer close(producerDone)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		var captured uint64
		for {
			select {
			case <-workerCtx.Done():
				return
			case <-ticker.C:
				s.operationMu.Lock()
				s.mu.Lock()
				if s.durability.completion != nil && !s.durability.completionBlocked {
					attempt, stop := context.WithTimeout(workerCtx, 5*time.Second)
					_ = s.tryCompletionLocked(attempt)
					stop()
				}
				if s.durability.completing || s.durability.revision == captured || s.durability.revision <= s.durability.savedRevision {
					s.mu.Unlock()
					s.operationMu.Unlock()
					continue
				}
				cut, err := s.checkpointCutLocked()
				if err == nil {
					captured = cut.revision
					s.durability.status.Pending = true
				}
				s.mu.Unlock()
				s.operationMu.Unlock()
				if err != nil {
					continue
				}
				select {
				case <-pending:
				default:
				}
				select {
				case pending <- cut:
				case <-workerCtx.Done():
					return
				}
			}
		}
	}()
	defer func() { cancel(); <-producerDone }()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case cut := <-pending:
			s.mu.Lock()
			s.durability.status.Pending = false
			s.mu.Unlock()
			delay := 100 * time.Millisecond
			for {
				attempt, cancelAttempt := context.WithTimeout(ctx, 5*time.Second)
				err := s.saveCut(attempt, cut, concurrency)
				cancelAttempt()
				s.mu.Lock()
				s.durability.status.Retrying = err != nil
				s.mu.Unlock()
				if err == nil {
					break
				}
				var permanent interface{ Retryable() bool }
				if errors.As(err, &permanent) && !permanent.Retryable() {
					return fmt.Errorf("checkpoint rejected: %w", err)
				}
				timer := time.NewTimer(delay)
				select {
				case <-ctx.Done():
					timer.Stop()
					return ctx.Err()
				case <-timer.C:
				}
				if delay < 5*time.Second {
					delay *= 2
					if delay > 5*time.Second {
						delay = 5 * time.Second
					}
				}
			}
		}
	}
}

// RecoverWithoutCheckpoint distinguishes a lost execution from first startup.
func (s *V2Session) RecoverWithoutCheckpoint(ctx context.Context) error {
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.snapshot.ReliableSequence != 0 || s.checkpointWriter == nil {
		return ErrV2RuntimeDefinition
	}
	previous := proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
	s.snapshot.Clock.Status = &realtimev2.RuntimeClockSnapshot_Paused{Paused: &realtimev2.Paused{Reason: realtimev2.PauseReason_PAUSE_REASON_PROCESS_RECOVERED}}
	s.lastTick = time.Now()
	if err := s.requireV3Synchronization(realtimev2.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_PROCESS_RECOVERED, true); err != nil {
		return err
	}
	return s.commitV2MutationVisible(ctx, proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot), nil, previous)
}
