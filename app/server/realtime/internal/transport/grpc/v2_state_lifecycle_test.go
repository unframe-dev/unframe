package grpc

import (
	"context"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"sync"
	"testing"
	"time"
)

type v2LifecycleConnection struct {
	service       *V2Service
	identity      session.Identity
	controlInput  chan *realtimev2.ControlClientItem
	controlOutput chan *realtimev2.ControlServerItem
	stateOutput   chan *realtimev2.StateServerItem
	cut           *realtimev2.ConnectionSnapshotEnvelope
}

func newV2LifecycleConnection(t *testing.T, initiallyPaused bool, sendGate func(*realtimev2.ControlServerItem)) *v2LifecycleConnection {
	t.Helper()
	service, profile := newV2LeaseTestService(t, allowAllAssignment{})
	identity, err := service.identities.Resolve(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	c := &v2LifecycleConnection{service: service, identity: identity, controlInput: make(chan *realtimev2.ControlClientItem, 4), controlOutput: make(chan *realtimev2.ControlServerItem, 32), stateOutput: make(chan *realtimev2.StateServerItem, 32)}
	if initiallyPaused {
		c.runtimeControl(t, "pause-initial", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	c.controlInput <- &realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_Handshake{Handshake: &realtimev2.ControlHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities}}}
	controlStream := &v2LeaseStream[realtimev2.ControlClientItem, realtimev2.ControlServerItem]{ctx: ctx, receive: func() (*realtimev2.ControlClientItem, error) {
		select {
		case item := <-c.controlInput:
			return item, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}, send: func(item *realtimev2.ControlServerItem) error {
		if sendGate != nil {
			sendGate(item)
		}
		select {
		case c.controlOutput <- item:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}}
	controlDone := make(chan error, 1)
	go func() { controlDone <- service.ConnectControl(controlStream) }()
	t.Cleanup(func() {
		cancel()
		select {
		case <-controlDone:
		case <-time.After(time.Second):
			t.Error("Control did not close")
		}
	})
	var nonce *realtimev2.StateConnectionNonce
	var connectionID string
	for nonce == nil {
		select {
		case item := <-c.controlOutput:
			if connected := item.GetConnected(); connected != nil {
				connectionID = connected.ConnectionId
			}
			if cut := item.GetConnectionSnapshot(); cut != nil {
				c.cut = cut
			}
			nonce = item.GetStateConnectionNonce()
		case err := <-controlDone:
			t.Fatalf("Control closed during handshake: %v", err)
		case <-time.After(time.Second):
			t.Fatal("Control handshake timed out")
		}
	}
	stateInput := make(chan *realtimev2.StateClientItem, 1)
	stateInput <- &realtimev2.StateClientItem{Item: &realtimev2.StateClientItem_Handshake{Handshake: &realtimev2.StateHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities, ConnectionId: connectionID, StateConnectionNonce: nonce.Nonce}}}
	stateStream := &v2LeaseStream[realtimev2.StateClientItem, realtimev2.StateServerItem]{ctx: ctx, receive: func() (*realtimev2.StateClientItem, error) {
		select {
		case item := <-stateInput:
			return item, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}, send: func(item *realtimev2.StateServerItem) error {
		select {
		case c.stateOutput <- item:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}}
	stateDone := make(chan error, 1)
	go func() { stateDone <- service.ConnectState(stateStream) }()
	t.Cleanup(func() {
		cancel()
		select {
		case <-stateDone:
		case <-time.After(time.Second):
			t.Error("State did not close")
		}
	})
	select {
	case item := <-c.stateOutput:
		if item.GetConnected() == nil {
			t.Fatalf("State handshake: %v", item)
		}
	case <-time.After(time.Second):
		t.Fatal("State handshake timed out")
	}
	c.controlInput <- &realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_StateReady{StateReady: &realtimev2.StateReady{AppliedReliableSequence: c.cut.ReliableSequence, PresentationOriginVersion: c.cut.Fence.PresentationOriginVersion}}}
	return c
}

func (c *v2LifecycleConnection) runtimeControl(t *testing.T, id string, kind realtimev2.RuntimeControlKind) {
	t.Helper()
	if _, _, err := c.service.runtime.RuntimeControl(context.Background(), c.identity, &realtimev2.RuntimeControlCommand{ClientEventId: id, PresentationOriginVersion: c.service.runtime.Snapshot().PresentationOrigin.Version, Kind: kind}); err != nil {
		t.Fatal(err)
	}
}

func TestV2PausedStateWaitsForResumeKeyframe(t *testing.T) {
	c := newV2LifecycleConnection(t, true, nil)
	select {
	case item := <-c.stateOutput:
		t.Fatalf("paused Runtime sent State frame: %v", item)
	case <-time.After(1100 * time.Millisecond):
	}
	c.runtimeControl(t, "resume", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME)
	select {
	case item := <-c.stateOutput:
		if frame := item.GetStateFrame(); frame == nil || frame.Kind != realtimev2.StateFrameKind_STATE_FRAME_KIND_KEYFRAME || frame.FrameSequence != 1 {
			t.Fatalf("resume keyframe: %v", item)
		}
	case <-time.After(1500 * time.Millisecond):
		t.Fatal("resume did not send fresh keyframe")
	}
}

func TestV2StateWaitsForVisibleReliableSendCompletion(t *testing.T) {
	blocked := make(chan struct{})
	gate := make(chan struct{})
	var release sync.Once
	defer release.Do(func() { close(gate) })
	c := newV2LifecycleConnection(t, true, func(item *realtimev2.ControlServerItem) {
		if item.GetReliableEvent().GetRuntimeStatusChanged().GetRunning() != nil {
			close(blocked)
			<-gate
		}
	})
	c.runtimeControl(t, "resume", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME)
	select {
	case <-blocked:
	case <-time.After(time.Second):
		t.Fatal("running event was not sent")
	}
	select {
	case item := <-c.stateOutput:
		t.Fatalf("State preceded visible reliable send completion: %v", item)
	case <-time.After(1100 * time.Millisecond):
	}
	release.Do(func() { close(gate) })
	var resumeSequence uint64
	for resumeSequence == 0 {
		select {
		case item := <-c.controlOutput:
			if event := item.GetReliableEvent(); event.GetRuntimeStatusChanged().GetRunning() != nil {
				resumeSequence = event.Sequence
			}
		case <-time.After(time.Second):
			t.Fatal("running event delivery timed out")
		}
	}
	select {
	case item := <-c.stateOutput:
		frame := item.GetStateFrame()
		if frame == nil || frame.Kind != realtimev2.StateFrameKind_STATE_FRAME_KIND_KEYFRAME || frame.FrameSequence != 1 || frame.BaseReliableSequence < resumeSequence {
			t.Fatalf("post-resume keyframe: %v", item)
		}
	case <-time.After(1500 * time.Millisecond):
		t.Fatal("no keyframe after running event")
	}
}

func TestV2PresenterSnapshotIncludesEnabledLogicalInputs(t *testing.T) {
	c := newV2LifecycleConnection(t, false, nil)
	inputs := c.cut.Snapshot.RuntimeView.EnabledLogicalInputs
	if len(inputs) != 1 || inputs[0] != "next" {
		t.Fatalf("presenter enabled logical inputs = %v, want [next]", inputs)
	}
}

func TestV2RunningStateFallsSilentUntilFreshResumeKeyframe(t *testing.T) {
	c := newV2LifecycleConnection(t, false, nil)
	var firstSequence uint64
	select {
	case item := <-c.stateOutput:
		frame := item.GetStateFrame()
		if frame == nil || frame.Kind != realtimev2.StateFrameKind_STATE_FRAME_KIND_KEYFRAME {
			t.Fatalf("initial running keyframe: %v", item)
		}
		firstSequence = frame.FrameSequence
	case <-time.After(time.Second):
		t.Fatal("initial running keyframe timed out")
	}
	c.runtimeControl(t, "pause-after-frame", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE)
	paused := false
	for !paused {
		select {
		case item := <-c.controlOutput:
			paused = item.GetReliableEvent().GetRuntimeStatusChanged().GetPaused() != nil
		case <-time.After(time.Second):
			t.Fatal("pause reliable event timed out")
		}
	}
	select {
	case item := <-c.stateOutput:
		t.Fatalf("State kept sending after visible pause: %v", item)
	case <-time.After(1100 * time.Millisecond):
	}
	c.runtimeControl(t, "resume-after-pause", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME)
	var resumedSequence uint64
	for resumedSequence == 0 {
		select {
		case item := <-c.controlOutput:
			if event := item.GetReliableEvent(); event.GetRuntimeStatusChanged().GetRunning() != nil {
				resumedSequence = event.Sequence
			}
		case <-time.After(time.Second):
			t.Fatal("resume reliable event timed out")
		}
	}
	select {
	case item := <-c.stateOutput:
		frame := item.GetStateFrame()
		if frame == nil || frame.Kind != realtimev2.StateFrameKind_STATE_FRAME_KIND_KEYFRAME || frame.FrameSequence != firstSequence+1 || frame.BaseReliableSequence < resumedSequence {
			t.Fatalf("fresh keyframe after later pause/resume: %v", item)
		}
	case <-time.After(1500 * time.Millisecond):
		t.Fatal("fresh resume keyframe timed out")
	}
}
