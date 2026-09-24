package state

import (
	"testing"
	"time"
)

func TestMailboxMergesElementChangesByField(t *testing.T) {
	t.Parallel()

	mailbox := NewMailbox()
	oldest := time.Date(2026, time.August, 20, 14, 0, 0, 0, time.UTC)
	if err := mailbox.Merge(oldest, []ElementChange{
		{ElementID: "element-1", Changed: FieldPosition, Position: Vector3{X: 1, Y: 2, Z: 3}},
		{ElementID: "element-2", Changed: FieldActive, Active: true},
	}); err != nil {
		t.Fatalf("first Merge(): %v", err)
	}
	if err := mailbox.Merge(oldest.Add(time.Millisecond), []ElementChange{
		{ElementID: "element-1", Changed: FieldActive, Active: true},
		{ElementID: "element-1", Changed: FieldPosition, Position: Vector3{X: 4, Y: 5, Z: 6}},
	}); err != nil {
		t.Fatalf("second Merge(): %v", err)
	}

	producedAt := oldest.Add(2 * time.Millisecond)
	frame, ok := mailbox.Take(7, producedAt, 11, 3)
	if !ok {
		t.Fatal("Take() ok = false, want merged frame")
	}
	if frame.FrameSequence != 7 || frame.BaseReliableSequence != 11 || frame.PresentationOriginVersion != 3 {
		t.Fatalf("frame metadata = %#v", frame)
	}
	if !frame.OldestChangeAt.Equal(oldest) || !frame.ProducedAt.Equal(producedAt) {
		t.Fatalf("frame times = %#v", frame)
	}
	if len(frame.Elements) != 2 {
		t.Fatalf("elements = %#v, want 2", frame.Elements)
	}
	first := frame.Elements[0]
	if first.ElementID != "element-1" || first.Changed != FieldPosition|FieldActive || first.Position != (Vector3{X: 4, Y: 5, Z: 6}) || !first.Active {
		t.Fatalf("merged element = %#v", first)
	}
	if _, ok := mailbox.Take(8, producedAt, 11, 3); ok {
		t.Fatal("empty Take() ok = true")
	}
}

func TestMailboxKeepsInFlightFrameImmutable(t *testing.T) {
	t.Parallel()

	mailbox := NewMailbox()
	now := time.Date(2026, time.August, 20, 14, 0, 0, 0, time.UTC)
	if err := mailbox.Merge(now, []ElementChange{{
		ElementID:      "element-1",
		Changed:        FieldAnimationState,
		AnimationState: "started",
	}}); err != nil {
		t.Fatalf("first Merge(): %v", err)
	}
	first, ok := mailbox.Take(1, now, 1, 1)
	if !ok {
		t.Fatal("first Take() ok = false")
	}
	if err := mailbox.Merge(now.Add(time.Millisecond), []ElementChange{{
		ElementID:      "element-1",
		Changed:        FieldAnimationState,
		AnimationState: "completed",
	}}); err != nil {
		t.Fatalf("second Merge(): %v", err)
	}
	second, ok := mailbox.Take(2, now.Add(2*time.Millisecond), 2, 1)
	if !ok {
		t.Fatal("second Take() ok = false")
	}
	if first.Elements[0].AnimationState != "started" {
		t.Fatalf("in-flight frame mutated to %q", first.Elements[0].AnimationState)
	}
	if second.Elements[0].AnimationState != "completed" {
		t.Fatalf("next frame animation = %q", second.Elements[0].AnimationState)
	}
}

func TestMailboxRejectsInvalidChangesWithoutLosingPendingState(t *testing.T) {
	t.Parallel()

	mailbox := NewMailbox()
	now := time.Date(2026, time.August, 20, 14, 0, 0, 0, time.UTC)
	if err := mailbox.Merge(now, []ElementChange{{ElementID: "element-1", Changed: FieldVisible, Visible: true}}); err != nil {
		t.Fatalf("valid Merge(): %v", err)
	}
	if err := mailbox.Merge(now, []ElementChange{{ElementID: "", Changed: FieldPosition}}); err == nil {
		t.Fatal("invalid Merge() error = nil")
	}
	frame, ok := mailbox.Take(1, now, 1, 1)
	if !ok || len(frame.Elements) != 1 || frame.Elements[0].ElementID != "element-1" {
		t.Fatalf("pending state after rejected merge = %#v, %v", frame, ok)
	}
}
