package protocol

import (
	"errors"
	"strings"
	"testing"

	realtimev1 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v1"
)

func TestPageChangeCommandValidatesMessageID(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		messageID string
		wantErr   error
	}{
		{name: "missing", wantErr: ErrMessageIDRequired},
		{name: "maximum length", messageID: strings.Repeat("a", maxMessageIDBytes)},
		{name: "too long", messageID: strings.Repeat("a", maxMessageIDBytes+1), wantErr: ErrMessageIDTooLong},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			command, err := PageChangeCommand(&realtimev1.PageChangeCommand{MessageId: test.messageID, PageIndex: 3})
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("error = %v, want %v", err, test.wantErr)
			}
			if test.wantErr == nil && (command.MessageID != test.messageID || command.PageIndex != 3) {
				t.Errorf("command = %#v, want message ID %q and page 3", command, test.messageID)
			}
		})
	}
}
