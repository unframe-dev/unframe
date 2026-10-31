package main

import (
	"testing"
)

func TestOperationCommandsRejectInvalidArgumentsBeforeSideEffects(t *testing.T) {
	for _, args := range [][]string{
		{"release"},
		{"prepare-funnel", "--root", "/repository", "/output"},
		{"setup-updater", "relative"},
		{"setup-updater", "/output", "--unknown"},
		{"serve-funnel", "--config", "relative"},
		{"update", "--config", "relative"},
		{"update", "--config", "/config", "--force", "--check"},
		{"update", "--config", "/config", "unexpected"},
		{"funnel-hostname", "unexpected"},
		{"funnel-vacant", "unexpected"},
	} {
		t.Run(args[0], func(t *testing.T) {
			handled, err := runOperation(args)
			if !handled || err == nil {
				t.Fatalf("accepted invalid arguments: %v, handled=%v, err=%v", args, handled, err)
			}
		})
	}
}

func TestDeploymentControlArgumentsRemainOwnedByControlCommand(t *testing.T) {
	handled, err := runOperation([]string{"--deployment", "/Funnel", "activity", "release"})
	if handled || err != nil {
		t.Fatalf("operation command intercepted host control: handled=%v, err=%v", handled, err)
	}
}
