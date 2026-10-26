package runtimecore

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
	"sync"
)

var v3TestContexts sync.Map

func v3TestEventID(id string) string {
	digest := sha256.Sum256([]byte(id))
	digest[6] = digest[6]&15 | 64
	digest[8] = digest[8]&63 | 128
	return fmt.Sprintf("1:%x-%x-%x-%x-%x", digest[:4], digest[4:6], digest[6:8], digest[8:10], digest[10:16])
}
func v3TestInput(s *V2Session, id string) *realtimev2.InputContext {
	s.mu.Lock()
	defer s.mu.Unlock()
	// These regression fixtures begin after the initial Presenter handshake.
	s.inputSynchronization.InputContext = s.currentV3InputContext()
	s.inputSynchronization.Phase = realtimev2.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_READY
	key := struct {
		core *V2Session
		id   string
	}{s, id}
	value, _ := v3TestContexts.LoadOrStore(key, proto.Clone(s.currentV3InputContext()).(*realtimev2.InputContext))
	return proto.Clone(value.(*realtimev2.InputContext)).(*realtimev2.InputContext)
}
func v3TestLogicalInput(s *V2Session, c *realtimev2.LogicalInputCommand) *realtimev2.LogicalInputCommand {
	c.CommandEpoch = 1
	c.InputContext = v3TestInput(s, c.ClientEventId)
	c.ClientEventId = v3TestEventID(c.ClientEventId)
	return c
}
func v3TestSurfaceInteraction(s *V2Session, c *realtimev2.SurfaceInteractionCommand) *realtimev2.SurfaceInteractionCommand {
	c.CommandEpoch = 1
	c.InputContext = v3TestInput(s, c.ClientEventId)
	c.ClientEventId = v3TestEventID(c.ClientEventId)
	return c
}
func v3TestRuntimeControl(_ *V2Session, c *realtimev2.RuntimeControlCommand) *realtimev2.RuntimeControlCommand {
	c.CommandEpoch = 1
	c.ClientEventId = v3TestEventID(c.ClientEventId)
	return c
}

func newV3RegressionSession(raw json.RawMessage) (*V2Session, error) {
	s, err := NewV2Session(raw)
	if err == nil {
		s.participants["presenter-1"] = session.RolePresenter
		s.committedRecovery = s.v2Recovery()
	}
	return s, err
}

func newV3RegressionSessionWithBundle(raw, bundle json.RawMessage) (*V2Session, error) {
	s, err := NewV2SessionWithBundle(raw, bundle)
	if err == nil {
		s.participants["presenter-1"] = session.RolePresenter
		s.committedRecovery = s.v2Recovery()
	}
	return s, err
}

func v3TestCopyInputContext(from, to *V2Session, id string) {
	key := struct {
		core *V2Session
		id   string
	}{from, id}
	if value, ok := v3TestContexts.Load(key); ok {
		v3TestContexts.Store(struct {
			core *V2Session
			id   string
		}{to, id}, value)
	}
}
