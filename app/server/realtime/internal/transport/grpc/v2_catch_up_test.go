package grpc

import (
	"context"
	"fmt"
	"testing"
	"time"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/runtimecore"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestSnapshotCatchUpReplacesOverflowedCut(t *testing.T) {
	core, err := runtimecore.NewV2Session([]byte(`{"schemaVersion":2,"presentationId":"p","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"g","groups":{"g":{"id":"g","initialStepId":"s","steps":{"s":{"id":"s","cues":[]}}}},"variables":{},"timelines":{}}}`))
	if err != nil {
		t.Fatal(err)
	}
	service := &V2Service{runtime: core}
	attempts := 0
	var sequence uint64
	events, closeSub, err := service.prepareSnapshotCatchUp(context.Background(), func() time.Time { return time.Unix(0, 0) }, func(snapshot *realtimev2.CanonicalRuntimeSnapshot, _ *realtimev2.ProjectedPresenceState) error {
		attempts++
		sequence = snapshot.ReliableSequence
		if attempts == 1 {
			for i := 0; i < 1025; i++ {
				if err := core.JoinParticipant(context.Background(), session.Identity{ParticipantID: fmt.Sprintf("v-%d", i), Role: session.RoleViewer}); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	defer closeSub()
	if attempts != 2 || sequence != 1025 {
		t.Fatalf("attempts=%d sequence=%d", attempts, sequence)
	}
	if err := core.JoinParticipant(context.Background(), session.Identity{ParticipantID: "after", Role: session.RoleViewer}); err != nil {
		t.Fatal(err)
	}
	if event := <-events; event.Sequence != 1026 {
		t.Fatalf("event=%v", event)
	}
}

func TestSnapshotCatchUpStopsAtAttemptAndTimeLimits(t *testing.T) {
	for _, test := range []struct {
		name     string
		overflow bool
	}{{"attempts", true}, {"timeout", false}} {
		t.Run(test.name, func(t *testing.T) {
			core, err := runtimecore.NewV2Session([]byte(`{"schemaVersion":2,"presentationId":"p","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"g","groups":{"g":{"id":"g","initialStepId":"s","steps":{"s":{"id":"s","cues":[]}}}},"variables":{},"timelines":{}}}`))
			if err != nil {
				t.Fatal(err)
			}
			service := &V2Service{runtime: core}
			attempts := 0
			now := time.Unix(0, 0)
			_, _, err = service.prepareSnapshotCatchUp(context.Background(), func() time.Time { return now }, func(_ *realtimev2.CanonicalRuntimeSnapshot, _ *realtimev2.ProjectedPresenceState) error {
				attempts++
				if test.overflow {
					for i := 0; i < 1025; i++ {
						if err := core.JoinParticipant(context.Background(), session.Identity{ParticipantID: fmt.Sprintf("v-%d-%d", attempts, i), Role: session.RoleViewer}); err != nil {
							return err
						}
					}
				} else {
					now = now.Add(250 * time.Millisecond)
				}

				return nil
			})
			if status.Code(err) != codes.ResourceExhausted || status.Convert(err).Message() != "snapshot_catch_up_exhausted" {
				t.Fatalf("error=%v", err)
			}
			stream := &reasonTrailerStream{}
			setV2ReasonTrailer(stream, err)
			if got := stream.trailer.Get("unframe-reason"); len(got) != 1 || got[0] != "snapshot_catch_up_exhausted" {
				t.Fatalf("trailer=%v", stream.trailer)
			}
			if test.overflow && attempts != 3 {
				t.Fatalf("attempts=%d", attempts)
			}
		})
	}
}
