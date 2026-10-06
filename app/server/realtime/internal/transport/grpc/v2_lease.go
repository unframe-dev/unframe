package grpc

import (
	"context"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
)

type v2OperationResult[T any] struct {
	value T
	err   error
}

// Lease renewal may move the deadline while a gRPC operation is blocked.
func v2BeforeLeaseExpiry[T any](ctx context.Context, deadline func() (time.Time, error), operation func() (T, error)) (T, error) {
	var zero T
	until, err := deadline()
	if err != nil {
		return zero, assignmentError(err)
	}
	if !time.Now().Before(until) {
		return zero, assignmentError(assignment.ErrLeaseExpired)
	}
	result := make(chan v2OperationResult[T], 1)
	go func() {
		value, err := operation()
		result <- v2OperationResult[T]{value, err}
	}()
	for {
		remaining := time.Until(until)
		if remaining <= 0 {
			return zero, assignmentError(assignment.ErrLeaseExpired)
		}
		timer := time.NewTimer(remaining)
		select {
		case received := <-result:
			timer.Stop()
			until, err = deadline()
			if err != nil {
				return zero, assignmentError(err)
			}
			if !time.Now().Before(until) {
				return zero, assignmentError(assignment.ErrLeaseExpired)
			}
			return received.value, received.err
		case <-timer.C:
			until, err = deadline()
			if err != nil {
				return zero, assignmentError(err)
			}
		case <-ctx.Done():
			timer.Stop()
			return zero, ctx.Err()
		}
	}
}
