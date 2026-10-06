package grpc

import (
	"context"
	"testing"
	"time"
)

func TestV2StateFramesReportRuntimeTime(t *testing.T) {
	c := newV2LifecycleConnection(t, false, nil)
	select {
	case item := <-c.stateOutput:
		if item.GetStateFrame() == nil {
			t.Fatalf("initial State frame: %v", item)
		}
	case <-time.After(1500 * time.Millisecond):
		t.Fatal("initial State frame timed out")
	}
	if _, err := c.service.runtime.AdvanceTo(context.Background(), 123); err != nil {
		t.Fatal(err)
	}
	select {
	case item := <-c.stateOutput:
		frame := item.GetStateFrame()
		if frame == nil || frame.ProducedAtRuntimeTimeMs != 123 {
			t.Fatalf("State frame at runtime time 123: %v", item)
		}
	case <-time.After(1500 * time.Millisecond):
		t.Fatal("State frame timed out")
	}
}
