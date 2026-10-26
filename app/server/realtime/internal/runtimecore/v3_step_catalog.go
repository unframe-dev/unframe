package runtimecore

import (
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/proto"
)

// PresenterSynchronization captures private input and Step selection state under one lock.
func (s *V2Session) PresenterSynchronization() (*realtime.PresenterInputSynchronization, *realtime.PresenterStepSelectionCatalog) {
	s.mu.Lock()
	defer s.mu.Unlock()
	catalog := &realtime.PresenterStepSelectionCatalog{ReliableSequence: s.snapshot.ReliableSequence}
	for _, entry := range s.snapshot.StepStartHistory {
		catalog.ReachedSteps = append(catalog.ReachedSteps, &realtime.StepSelection{GroupId: entry.GroupId, StepId: entry.StepId})
	}
	return proto.Clone(s.inputSynchronization).(*realtime.PresenterInputSynchronization), catalog
}
