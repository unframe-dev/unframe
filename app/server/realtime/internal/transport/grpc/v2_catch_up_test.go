package grpc

import (
	"context"
	"fmt"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"io"
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
	}, func(begin func() error) error { return begin() })
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
		name         string
		overflow     bool
		startTimeout bool
	}{{name: "attempts", overflow: true}, {name: "preparation timeout"}, {name: "delivery timeout", startTimeout: true}} {
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
				} else if !test.startTimeout {
					now = now.Add(250 * time.Millisecond)
				}

				return nil
			}, func(begin func() error) error {
				if test.startTimeout {
					now = now.Add(250 * time.Millisecond)
				}
				return begin()
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

type catchUpDeliveryAssignment struct {
	allowAllAssignment
	beforeDelivery func() error
}

func (a *catchUpDeliveryAssignment) ReliableDeliveryDeadline(claim assignment.AssignmentClaim) (time.Time, error) {
	if a.beforeDelivery != nil {
		if err := a.beforeDelivery(); err != nil {
			return time.Time{}, err
		}
	}
	return a.allowAllAssignment.ReliableDeliveryDeadline(claim)
}

func TestV2ControlCatchUpAtSnapshotSend(t *testing.T) {
	for _, test := range []struct {
		name                 string
		overflowEveryAttempt bool
		resume               bool
		overflowAfterStart   bool
		wantResync           bool
		wantCut              uint64
		wantReason           string
		wantAttempts         int
	}{
		{name: "retries before send", wantCut: 1026, wantAttempts: 2},
		{name: "resume rechecks replay range after overflow", resume: true, wantResync: true, wantAttempts: 1},
		{name: "exhausts before send", overflowEveryAttempt: true, wantReason: "snapshot_catch_up_exhausted", wantAttempts: 3},
		{name: "slow after send starts", overflowAfterStart: true, wantCut: 1, wantReason: "reliable_subscriber_slow", wantAttempts: 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			assignments := &catchUpDeliveryAssignment{}
			service, profile := newV2LeaseTestService(t, assignments)
			handshake := &realtimev2.ControlHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities}
			var priorConnection string
			var resumeCursor *realtimev2.ResumeCursor
			if test.resume {
				first := true
				initial := &v2LeaseStream[realtimev2.ControlClientItem, realtimev2.ControlServerItem]{ctx: context.Background(), receive: func() (*realtimev2.ControlClientItem, error) {
					if first {
						first = false
						return &realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_Handshake{Handshake: handshake}}, nil
					}
					return nil, io.EOF
				}, send: func(item *realtimev2.ControlServerItem) error {
					if connected := item.GetConnected(); connected != nil {
						priorConnection = connected.ConnectionId
					}
					if cut := item.GetConnectionSnapshot(); cut != nil {
						resumeCursor = &realtimev2.ResumeCursor{PriorConnectionId: priorConnection, AppliedReliableSequence: cut.ReliableSequence, Fence: cut.Fence}
					}
					return nil
				}}
				if err := service.ConnectControl(initial); err != nil {
					t.Fatal(err)
				}
				handshake.Resume = resumeCursor
			}
			expectedRetryCut := service.runtime.Snapshot().ReliableSequence + 1026
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			first := true
			var snapshotCut, resyncCut uint64
			attempts := 0
			var previous *v2Control
			viewerConnected := false
			flood := func() error {
				viewer := session.Identity{ParticipantID: "viewer", Role: session.RoleViewer}
				for i := 0; i < 1025; i++ {
					var err error
					if !viewerConnected {
						err = service.runtime.JoinParticipant(ctx, viewer)
					} else {
						err = service.runtime.LeaveParticipant(ctx, viewer)
					}
					if err != nil {
						return err
					}
					viewerConnected = !viewerConnected
				}
				return nil
			}

			assignments.beforeDelivery = func() error {
				service.mu.Lock()
				var current *v2Control
				for _, control := range service.controls {
					current = control
				}
				service.mu.Unlock()
				if current == nil || current == previous {
					return nil
				}
				previous = current
				attempts++
				if !test.overflowAfterStart && (attempts == 1 || test.overflowEveryAttempt) {
					return flood()
				}
				return nil
			}
			stream := &v2LeaseStream[realtimev2.ControlClientItem, realtimev2.ControlServerItem]{ctx: ctx, receive: func() (*realtimev2.ControlClientItem, error) {
				if first {
					first = false
					return &realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_Handshake{Handshake: handshake}}, nil
				}
				if test.wantReason != "" {
					<-ctx.Done()
					return nil, ctx.Err()
				}
				return nil, io.EOF
			}, send: func(item *realtimev2.ControlServerItem) error {
				if resync := item.GetResyncRequired(); resync != nil {
					resyncCut = resync.NewestReliableSequence
					if !test.wantResync || resync.Reason != realtimev2.ResyncReason_RESYNC_REASON_REPLAY_RANGE_UNAVAILABLE {
						t.Errorf("unexpected resync: %v", resync)
					}
				}
				if snapshot := item.GetConnectionSnapshot(); snapshot != nil {
					snapshotCut = snapshot.ReliableSequence
					if test.overflowAfterStart {
						return flood()
					}
				}
				return nil
			}}
			err := service.ConnectControl(stream)
			if test.wantReason == "" {
				if err != nil {
					t.Fatalf("ConnectControl: %v", err)
				}
			} else if status.Code(err) != codes.ResourceExhausted || status.Convert(err).Message() != test.wantReason {
				t.Fatalf("ConnectControl: %v, want %s", err, test.wantReason)
			}
			if snapshotCut != test.wantCut || attempts != test.wantAttempts {
				t.Fatalf("snapshot cut=%d attempts=%d, want %d/%d", snapshotCut, attempts, test.wantCut, test.wantAttempts)
			}
			if test.wantResync && resyncCut != expectedRetryCut {
				t.Fatalf("resync cut=%d, want %d", resyncCut, expectedRetryCut)
			}
			if len(service.controls) != 0 {
				t.Fatalf("controls retained: %d", len(service.controls))
			}
			if priorConnection != "" {
				delete(service.resumeRecords, priorConnection)
			}
			wantRecords := 1
			if test.wantReason == "snapshot_catch_up_exhausted" || test.wantResync {
				wantRecords = 0
			}
			if len(service.resumeRecords) != wantRecords {
				t.Fatalf("resume records=%d, want %d", len(service.resumeRecords), wantRecords)
			}
		})
	}
}
