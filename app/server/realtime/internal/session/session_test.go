package session

import (
	"errors"
	"testing"
)

func TestCoordinatorFansOutServerSequencedPageChange(t *testing.T) {
	t.Parallel()

	coordinator := NewCoordinator()
	presenter := Identity{SessionID: "session-1", ParticipantID: "presenter-1", Role: RolePresenter}
	viewer := Identity{SessionID: "session-1", ParticipantID: "viewer-1", Role: RoleViewer}
	presenterConnection, err := coordinator.Connect(presenter)
	if err != nil {
		t.Fatalf("connect presenter: %v", err)
	}
	defer coordinator.Disconnect(presenterConnection)
	viewerConnection, err := coordinator.Connect(viewer)
	if err != nil {
		t.Fatalf("connect viewer: %v", err)
	}
	defer coordinator.Disconnect(viewerConnection)

	event, err := coordinator.ChangePage(presenterConnection, PageChangeCommand{MessageID: "command-1", PageIndex: 3})
	if err != nil {
		t.Fatalf("change page: %v", err)
	}
	if event.Sequence != 1 {
		t.Errorf("sequence = %d, want 1", event.Sequence)
	}

	for name, events := range map[string]<-chan ReliableEvent{"presenter": presenterConnection.Events(), "viewer": viewerConnection.Events()} {
		got := <-events
		if got != event {
			t.Errorf("%s event = %#v, want %#v", name, got, event)
		}
	}
}

func TestCoordinatorRejectsViewerAndDuplicateMessageID(t *testing.T) {
	t.Parallel()

	coordinator := NewCoordinator()
	presenter := Identity{SessionID: "session-1", ParticipantID: "presenter-1", Role: RolePresenter}
	viewer := Identity{SessionID: "session-1", ParticipantID: "viewer-1", Role: RoleViewer}
	presenterConnection, err := coordinator.Connect(presenter)
	if err != nil {
		t.Fatalf("connect presenter: %v", err)
	}
	defer coordinator.Disconnect(presenterConnection)
	viewerConnection, err := coordinator.Connect(viewer)
	if err != nil {
		t.Fatalf("connect viewer: %v", err)
	}
	defer coordinator.Disconnect(viewerConnection)

	if _, err := coordinator.ChangePage(viewerConnection, PageChangeCommand{MessageID: "viewer-command", PageIndex: 1}); !errors.Is(err, ErrForbidden) {
		t.Errorf("viewer command error = %v, want %v", err, ErrForbidden)
	}
	if _, err := coordinator.ChangePage(presenterConnection, PageChangeCommand{MessageID: "command-1", PageIndex: 1}); err != nil {
		t.Fatalf("first command: %v", err)
	}
	if _, err := coordinator.ChangePage(presenterConnection, PageChangeCommand{MessageID: "command-1", PageIndex: 2}); !errors.Is(err, ErrDuplicateMessageID) {
		t.Errorf("duplicate command error = %v, want %v", err, ErrDuplicateMessageID)
	}
}

func TestCoordinatorRejectsDuplicateActiveParticipant(t *testing.T) {
	t.Parallel()

	coordinator := NewCoordinator()
	identity := Identity{SessionID: "session-1", ParticipantID: "participant-1", Role: RoleViewer}
	connection, err := coordinator.Connect(identity)
	if err != nil {
		t.Fatalf("first connect: %v", err)
	}
	defer coordinator.Disconnect(connection)
	if _, err := coordinator.Connect(identity); !errors.Is(err, ErrParticipantActive) {
		t.Errorf("duplicate connect error = %v, want %v", err, ErrParticipantActive)
	}
}

func TestCoordinatorExpiresMessageIDsOutsideBoundedWindow(t *testing.T) {
	t.Parallel()

	coordinator := NewCoordinator()
	presenter := Identity{SessionID: "session-1", ParticipantID: "presenter-1", Role: RolePresenter}
	connection, err := coordinator.Connect(presenter)
	if err != nil {
		t.Fatalf("connect presenter: %v", err)
	}
	defer coordinator.Disconnect(connection)

	for index := 0; index < messageIDWindowCapacity; index++ {
		if _, err := coordinator.ChangePage(connection, PageChangeCommand{MessageID: string(rune(index + 1)), PageIndex: uint32(index)}); err != nil {
			t.Fatalf("command %d: %v", index, err)
		}
		<-connection.Events()
	}
	if _, err := coordinator.ChangePage(connection, PageChangeCommand{MessageID: "next", PageIndex: 0}); err != nil {
		t.Fatalf("advance message ID window: %v", err)
	}
	<-connection.Events()
	if _, err := coordinator.ChangePage(connection, PageChangeCommand{MessageID: string(rune(1)), PageIndex: 0}); err != nil {
		t.Errorf("reused expired message ID error = %v, want nil", err)
	}
}

func TestCoordinatorDisconnectsSlowParticipantWithoutBlockingSessionProgress(t *testing.T) {
	t.Parallel()

	coordinator := NewCoordinator()
	presenter := Identity{SessionID: "session-1", ParticipantID: "presenter-1", Role: RolePresenter}
	viewer := Identity{SessionID: "session-1", ParticipantID: "viewer-1", Role: RoleViewer}
	presenterConnection, err := coordinator.Connect(presenter)
	if err != nil {
		t.Fatalf("connect presenter: %v", err)
	}
	defer coordinator.Disconnect(presenterConnection)
	viewerConnection, err := coordinator.Connect(viewer)
	if err != nil {
		t.Fatalf("connect viewer: %v", err)
	}
	defer coordinator.Disconnect(viewerConnection)

	for sequence := 0; sequence < reliableQueueCapacity; sequence++ {
		if _, err := coordinator.ChangePage(presenterConnection, PageChangeCommand{MessageID: string(rune(sequence + 1)), PageIndex: uint32(sequence)}); err != nil {
			t.Fatalf("fill viewer queue at sequence %d: %v", sequence, err)
		}
		<-presenterConnection.Events()
	}
	event, err := coordinator.ChangePage(presenterConnection, PageChangeCommand{MessageID: "overflow", PageIndex: 99})
	if err != nil {
		t.Fatalf("command after viewer queue fills: %v", err)
	}
	if event.Sequence != reliableQueueCapacity+1 {
		t.Errorf("sequence after slow participant disconnect = %d, want %d", event.Sequence, reliableQueueCapacity+1)
	}
	if got := <-presenterConnection.Events(); got != event {
		t.Errorf("presenter event = %#v, want %#v", got, event)
	}
	for sequence := 0; sequence < reliableQueueCapacity; sequence++ {
		if _, ok := <-viewerConnection.Events(); !ok {
			t.Fatalf("viewer queue closed before buffered event %d", sequence)
		}
	}
	if _, ok := <-viewerConnection.Events(); ok {
		t.Error("slow viewer remained connected after reliable queue filled")
	}
}

func TestCoordinatorRejectsCommandFromBackpressureDisconnectedPresenter(t *testing.T) {
	t.Parallel()

	coordinator := NewCoordinator()
	presenter := Identity{SessionID: "session-1", ParticipantID: "presenter-1", Role: RolePresenter}
	connection, err := coordinator.Connect(presenter)
	if err != nil {
		t.Fatalf("connect presenter: %v", err)
	}
	defer coordinator.Disconnect(connection)

	for sequence := 0; sequence <= reliableQueueCapacity; sequence++ {
		if _, err := coordinator.ChangePage(connection, PageChangeCommand{MessageID: string(rune(sequence + 1)), PageIndex: uint32(sequence)}); err != nil {
			t.Fatalf("command %d: %v", sequence, err)
		}
	}
	if _, err := coordinator.ChangePage(connection, PageChangeCommand{MessageID: "after-disconnect", PageIndex: 100}); !errors.Is(err, ErrConnectionInactive) {
		t.Errorf("disconnected presenter command error = %v, want %v", err, ErrConnectionInactive)
	}
}
