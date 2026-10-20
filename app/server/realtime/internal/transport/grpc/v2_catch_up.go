package grpc

import (
	"context"
	"time"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Preparation is discarded before sending any snapshot when its subscriber
// overflows. Once delivery begins, the normal slow-subscriber policy applies.
func (s *V2Service) prepareSnapshotCatchUp(ctx context.Context, now func() time.Time, prepare func(*realtimev2.CanonicalRuntimeSnapshot, *realtimev2.ProjectedPresenceState) error) (<-chan *realtimev2.ProjectedReliableEvent, func(), error) {
	limits := v2ProtocolLimits()
	deadline := now().Add(time.Duration(limits.SnapshotCatchUpTotalBudgetMs) * time.Millisecond)
	for attempt := uint32(0); attempt < limits.SnapshotCatchUpMaxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}
		if !now().Before(deadline) {
			break
		}
		snapshot, presence, events, unsubscribe, active := s.runtime.SnapshotPresenceAndSubscribe()
		if err := prepare(snapshot, presence); err != nil {
			unsubscribe()
			return nil, nil, err
		}
		if err := ctx.Err(); err != nil {
			unsubscribe()
			return nil, nil, err
		}
		if now().Before(deadline) && active() {
			return events, unsubscribe, nil
		}
		unsubscribe()
	}
	return nil, nil, status.Error(codes.ResourceExhausted, "snapshot_catch_up_exhausted")
}
