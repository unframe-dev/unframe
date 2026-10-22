package grpc

import (
	"errors"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"testing"
)

type reasonTrailerStream struct {
	grpcgo.ServerStream
	trailer metadata.MD
}

func (s *reasonTrailerStream) SetTrailer(md metadata.MD) { s.trailer = md }

func TestAssignmentFailuresDistinguishUnavailableFromInactive(t *testing.T) {
	for _, tt := range []struct {
		name   string
		err    error
		code   codes.Code
		reason string
	}{
		{"unavailable", errors.New("assignment backend unavailable"), codes.Unavailable, "runtime_assignment_unavailable"},
		{"inactive", assignment.ErrInvalidAssignment, codes.FailedPrecondition, "assignment_inactive"},
		{"expired", assignment.ErrLeaseExpired, codes.FailedPrecondition, "assignment_lease_expired"},
		{"fence", assignment.ErrAssignmentEpochMismatch, codes.PermissionDenied, "assignment_fence_mismatch"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			err := assignmentError(tt.err)
			stream := &reasonTrailerStream{}
			setV2ReasonTrailer(stream, err)
			if status.Code(err) != tt.code || len(stream.trailer.Get("unframe-reason")) != 1 || stream.trailer.Get("unframe-reason")[0] != tt.reason {
				t.Fatalf("error=%v trailer=%v", err, stream.trailer)
			}
		})
	}
}
