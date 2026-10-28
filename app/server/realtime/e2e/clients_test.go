package e2e

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/coder/websocket"
	delivery "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/delivery"
	presentation "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	grpc "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

type peerState struct {
	connectionID      string
	view              *realtime.ParticipantRuntimeView
	fence             *presentation.RuntimeProjectionFence
	sequence          uint64
	readySequence     uint64
	readyOrigin       uint64
	readySet          bool
	stateSequence     uint64
	stateBaseSequence uint64
	nonce             []byte
	synchronization   *realtime.PresenterInputSynchronization
	outcomes          map[string][]*realtime.CommandOutcome
	controlError      error
	stateError        error
	controlClosed     bool
	stateClosed       bool
	stateConnected    bool
}

type peer struct {
	f                 *fixture
	apiCredential     string
	runtimeCredential string
	manifest          *delivery.DeliveryManifest
	cancel            context.CancelFunc
	closeTransport    func()
	finishControl     func() error
	sendControl       func(*realtime.ControlClientItem) error
	sendState         func(*realtime.StateClientItem) error
	mu                sync.Mutex
	sendMu            sync.Mutex
	state             peerState
}

type bootstrap struct {
	Endpoint   string `json:"endpoint"`
	Credential string `json:"credential"`
	ExpiresAt  string `json:"expiresAt"`
}

var errBrowserFrame = errors.New("invalid browser protobuf frame")

func (f *fixture) prepare(credential, capability string) (*delivery.DeliveryManifest, bootstrap) {
	f.t.Helper()
	data := f.request(http.MethodPost, "/sessions/"+f.env.SessionID+"/delivery", credential, map[string]any{"capabilityProfileId": capability}, http.StatusOK)
	manifest := new(delivery.DeliveryManifest)
	if err := proto.Unmarshal(data, manifest); err != nil {
		f.t.Fatal("decode Delivery:", err)
	}
	if manifest.SessionId != f.env.SessionID || manifest.ProjectionProfile == nil || manifest.ProjectionInstance == nil || len(manifest.AssetAccess) == 0 {
		f.t.Fatal("Delivery missing Session, projection, or assets")
	}
	response := decodeJSON[bootstrap](f.t, f.request(http.MethodPost, "/sessions/"+f.env.SessionID+"/bootstrap", credential, map[string]any{}, http.StatusOK))
	if response.Endpoint != f.env.RuntimeEndpoint || response.Credential == "" {
		f.t.Fatal("bootstrap does not identify this Runtime")
	}
	for _, asset := range manifest.AssetAccess {
		req, err := http.NewRequestWithContext(f.ctx, http.MethodGet, asset.Url, nil)
		if err != nil {
			f.t.Fatal("invalid Asset URL")
		}
		parsed, err := url.Parse(asset.Url)
		if err != nil || parsed.Scheme != "https" || parsed.Hostname() != "localhost" {
			f.t.Fatal("E2E Assets must use the isolated HTTPS origin")
		}
		req.Header.Set("Origin", f.env.AudienceOrigin)
		result, err := f.client.Do(req)
		if err != nil {
			f.t.Fatalf("Asset request failed (URL omitted): %T", err)
		}
		bytes, readErr := io.ReadAll(io.LimitReader(result.Body, 32<<20))
		_ = result.Body.Close()
		if readErr != nil || result.StatusCode != http.StatusOK {
			f.t.Fatal("Asset request did not succeed")
		}
		if result.Header.Get("Access-Control-Allow-Origin") != f.env.AudienceOrigin {
			f.t.Fatal("Asset CORS origin mismatch")
		}
		if uint64(len(bytes)) != asset.EncodedSizeBytes || fmt.Sprintf("sha256:%x", sha256.Sum256(bytes)) != asset.Checksum {
			f.t.Fatal("downloaded Asset does not match Delivery checksum/size")
		}
	}
	return manifest, response
}

func (f *fixture) connectNative(previous *peerState) *peer {
	f.t.Helper()
	manifest, bootstrap := f.prepare(f.env.PresenterCredential, "quest-presentation-v2")
	ctx, cancel := context.WithCancel(f.ctx)
	ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+bootstrap.Credential)
	endpoint, _ := url.Parse(bootstrap.Endpoint)
	connection, err := grpc.NewClient(endpoint.Host, grpc.WithTransportCredentials(credentials.NewTLS(f.tls.Clone())))
	if err != nil {
		cancel()
		f.t.Fatal("create native gRPC connection:", err)
	}
	client := realtime.NewRealtimeServiceClient(connection)
	control, err := client.ConnectControl(ctx)
	if err != nil {
		cancel()
		_ = connection.Close()
		f.t.Fatal("native Control:", err)
	}
	state, err := client.ConnectState(ctx)
	if err != nil {
		cancel()
		_ = connection.Close()
		f.t.Fatal("native State:", err)
	}
	p := &peer{f: f, apiCredential: f.env.PresenterCredential, runtimeCredential: bootstrap.Credential, manifest: manifest, cancel: cancel, closeTransport: func() { _ = connection.Close() }, finishControl: control.CloseSend, sendControl: control.Send, sendState: state.Send, state: peerState{outcomes: map[string][]*realtime.CommandOutcome{}}}
	f.owner.Cleanup(p.close)
	var cursor *realtime.ResumeCursor
	if previous != nil {
		cursor = &realtime.ResumeCursor{PriorConnectionId: previous.connectionID, AppliedReliableSequence: previous.sequence, Fence: previous.fence}
		p.state.view = proto.Clone(previous.view).(*realtime.ParticipantRuntimeView)
		p.state.sequence = previous.sequence
		p.state.fence = proto.Clone(previous.fence).(*presentation.RuntimeProjectionFence)
	}
	go p.readControl(control.Recv)
	go p.readState(state.Recv)
	p.send(&realtime.ControlClientItem{Item: &realtime.ControlClientItem_Handshake{Handshake: &realtime.ControlHandshake{ProtocolVersion: "v3", ProgressionContractVersion: 2, SupportedCapabilities: manifest.ProjectionProfile.RequiredRuntimeCapabilities, Resume: cursor}}})
	p.attachState()
	return p
}

func (f *fixture) connectViewer(apiCredential string) *peer {
	f.t.Helper()
	if apiCredential == "" {
		credential := decodeJSON[struct {
			Token         string `json:"token"`
			ParticipantID string `json:"participantId"`
		}](f.t, f.request(http.MethodPost, "/viewer-credentials", "", map[string]any{"joinCode": f.env.JoinCode}, http.StatusCreated))
		apiCredential = credential.Token
		if apiCredential == "" || credential.ParticipantID == "" {
			f.t.Fatal("Viewer identity missing")
		}
	}
	manifest, bootstrap := f.prepare(apiCredential, f.env.AudienceCapabilityProfileID)
	if manifest.ProjectionProfile.Key.Role != presentation.SessionRole_SESSION_ROLE_VIEWER {
		f.t.Fatal("anonymous Viewer received non-Viewer projection")
	}
	ctx, cancel := context.WithCancel(f.ctx)
	control := f.dialBrowser(ctx, "/browser/control")
	state := f.dialBrowser(ctx, "/browser/state")
	for _, socket := range []*websocket.Conn{control, state} {
		data, _ := json.Marshal(map[string]string{"credential": bootstrap.Credential})
		if err := socket.Write(ctx, websocket.MessageText, data); err != nil {
			f.t.Fatal("authenticate WS connection:", err)
		}
	}
	p := &peer{f: f, apiCredential: apiCredential, runtimeCredential: bootstrap.Credential, manifest: manifest, cancel: cancel, closeTransport: func() { _ = control.CloseNow(); _ = state.CloseNow() }, sendControl: func(item *realtime.ControlClientItem) error { return browserWrite(ctx, control, item) }, sendState: func(item *realtime.StateClientItem) error { return browserWrite(ctx, state, item) }, state: peerState{outcomes: map[string][]*realtime.CommandOutcome{}}}
	f.owner.Cleanup(p.close)
	p.finishControl = func() error { return control.Close(websocket.StatusNormalClosure, "") }
	go p.readControl(func() (*realtime.ControlServerItem, error) {
		item := new(realtime.ControlServerItem)
		err := browserRead(ctx, control, item)
		return item, err
	})
	go p.readState(func() (*realtime.StateServerItem, error) {
		item := new(realtime.StateServerItem)
		err := browserRead(ctx, state, item)
		return item, err
	})
	p.send(&realtime.ControlClientItem{Item: &realtime.ControlClientItem_Handshake{Handshake: &realtime.ControlHandshake{ProtocolVersion: "v3", ProgressionContractVersion: 2, SupportedCapabilities: manifest.ProjectionProfile.RequiredRuntimeCapabilities}}})
	p.attachState()
	return p
}

func (f *fixture) dialBrowser(ctx context.Context, path string) *websocket.Conn {
	f.t.Helper()
	endpoint, _ := url.Parse(f.env.RuntimeEndpoint)
	endpoint.Scheme = "wss"
	endpoint.Path = path
	socket, _, err := websocket.Dial(ctx, endpoint.String(), &websocket.DialOptions{HTTPClient: f.client, HTTPHeader: http.Header{"Origin": []string{f.env.AudienceOrigin}}, Subprotocols: []string{"unframe.realtime.v3"}})
	if err != nil {
		f.t.Fatalf("WS %s upgrade failed: %v", path, err)
	}
	socket.SetReadLimit(1 << 20)
	f.owner.Cleanup(func() { _ = socket.CloseNow() })
	return socket
}

func browserWrite(ctx context.Context, socket *websocket.Conn, item proto.Message) error {
	data, err := proto.Marshal(item)
	if err != nil {
		return err
	}
	return socket.Write(ctx, websocket.MessageBinary, data)
}

func browserRead(ctx context.Context, socket *websocket.Conn, item proto.Message) error {
	kind, data, err := socket.Read(ctx)
	if err != nil {
		return err
	}
	if kind != websocket.MessageBinary {
		return fmt.Errorf("%w: server sent a non-binary frame", errBrowserFrame)
	}
	if err := proto.Unmarshal(data, item); err != nil {
		return fmt.Errorf("%w: protobuf decode failed", errBrowserFrame)
	}
	return nil
}

func (p *peer) attachState() {
	p.wait("Control handshake/Snapshot/nonce", func(s peerState) bool { return s.connectionID != "" && s.view != nil && len(s.nonce) > 0 })
	s := p.snapshot()
	if err := p.sendState(&realtime.StateClientItem{Item: &realtime.StateClientItem_Handshake{Handshake: &realtime.StateHandshake{ProtocolVersion: "v3", ProgressionContractVersion: 2, SupportedCapabilities: p.manifest.ProjectionProfile.RequiredRuntimeCapabilities, ConnectionId: s.connectionID, StateConnectionNonce: s.nonce}}}); err != nil {
		p.f.t.Fatal("State handshake:", err)
	}
	p.wait("State connected", func(s peerState) bool { return s.stateConnected })
	s = p.snapshot()
	p.send(&realtime.ControlClientItem{Item: &realtime.ControlClientItem_StateReady{StateReady: &realtime.StateReady{AppliedReliableSequence: s.readySequence, PresentationOriginVersion: s.readyOrigin}}})
	if s.view.Clock.GetPaused() == nil {
		p.wait("State keyframe", func(s peerState) bool { return s.stateSequence > 0 })
	}
}

func (p *peer) readControl(receive func() (*realtime.ControlServerItem, error)) {
	for {
		item, err := receive()
		p.mu.Lock()
		if err != nil {
			p.state.controlError = err
			p.state.controlClosed = !errors.Is(err, errBrowserFrame)
			p.mu.Unlock()
			return
		}
		if connected := item.GetConnected(); connected != nil {
			p.state.connectionID = connected.ConnectionId
		}
		if cut := item.GetConnectionSnapshot(); cut != nil {
			p.state.view = proto.Clone(cut.Snapshot.RuntimeView).(*realtime.ParticipantRuntimeView)
			p.state.fence = proto.Clone(cut.Fence).(*presentation.RuntimeProjectionFence)
			p.state.sequence = cut.ReliableSequence
			p.state.readySequence = cut.ReliableSequence
			p.state.readyOrigin = cut.Fence.PresentationOriginVersion
			p.state.readySet = true
		}
		if nonce := item.GetStateConnectionNonce(); nonce != nil {
			p.state.nonce = append([]byte(nil), nonce.Nonce...)
		}
		var ack *realtime.InputSynchronizationAck
		if sync := item.GetPresenterInputSynchronization(); sync != nil {
			if !p.state.readySet {
				p.state.readySequence = p.state.sequence
				p.state.readyOrigin = p.state.fence.PresentationOriginVersion
				p.state.readySet = true
			}
			p.state.synchronization = proto.Clone(sync).(*realtime.PresenterInputSynchronization)
			if sync.Phase == realtime.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_REQUIRED {
				epoch := sync.CommandEpoch
				if sync.NextCommandEpoch != nil {
					epoch = sync.GetNextCommandEpoch()
				}
				ack = &realtime.InputSynchronizationAck{SynchronizationRevision: sync.SynchronizationRevision, InputContext: sync.InputContext, CommandEpoch: epoch, AppliedReliableSequence: sync.ReliableSequence, PendingCommandsDiscarded: true}
			}
		}
		if advance := item.GetProjectionAdvance(); advance != nil {
			if advance.FromExclusive != p.state.sequence || advance.ThroughSequence <= p.state.sequence {
				p.state.controlError = fmt.Errorf("projection advance does not continue the applied cursor")
				p.mu.Unlock()
				return
			}
			p.state.sequence = advance.ThroughSequence
		}
		if event := item.GetReliableEvent(); event != nil {
			if event.Sequence != p.state.sequence+1 {
				p.state.controlError = fmt.Errorf("reliable event sequence does not continue the applied cursor")
				p.mu.Unlock()
				return
			}
			p.state.sequence = event.Sequence
			p.state.fence = proto.Clone(event.Fence).(*presentation.RuntimeProjectionFence)
			if replacement := event.GetRuntimeViewReplaced(); replacement != nil {
				p.state.view = proto.Clone(replacement.RuntimeView).(*realtime.ParticipantRuntimeView)
			}
			if changed := event.GetSurfaceStateChanged(); changed != nil && p.state.view != nil {
				for _, surface := range p.state.view.SurfaceStates {
					if surface.SurfaceId == changed.SurfaceId {
						surface.StateId = changed.StateId
					}
				}
			}
			if changed := event.GetVariableChanged(); changed != nil && p.state.view != nil {
				for index, variable := range p.state.view.Variables {
					if variable.VariableId == changed.State.VariableId {
						p.state.view.Variables[index] = proto.Clone(changed.State).(*realtime.VariableState)
					}
				}
			}
			if committed := event.GetNodeStateCommitted(); committed != nil && p.state.view != nil {
				for index, node := range p.state.view.NodeStates {
					if node.NodeId == committed.State.NodeId {
						p.state.view.NodeStates[index] = proto.Clone(committed.State).(*realtime.NodeRuntimeState)
					}
				}
			}
			if step := event.GetStepEntered(); step != nil && p.state.view != nil {
				p.state.view.Progression.CurrentGroupId = step.GroupId
				p.state.view.Progression.CurrentStepId = step.StepId
				p.state.view.Progression.GroupEntryEpoch = step.GroupEntryEpoch
				p.state.view.Progression.StepEntryEpoch = step.StepEntryEpoch
			}
			if status := event.GetRuntimeStatusChanged(); status != nil && p.state.view != nil {
				p.state.view.Clock.RuntimeTimeMs = event.OccurredAtRuntimeTimeMs
				if status.GetRunning() != nil {
					p.state.view.Clock.Status = &realtime.RuntimeClockSnapshot_Running{Running: status.GetRunning()}
				}
				if status.GetPaused() != nil {
					p.state.view.Clock.Status = &realtime.RuntimeClockSnapshot_Paused{Paused: status.GetPaused()}
				}
			}
		}
		if outcome := item.GetCommandOutcome(); outcome != nil {
			p.state.outcomes[outcome.ClientEventId] = append(p.state.outcomes[outcome.ClientEventId], proto.Clone(outcome).(*realtime.CommandOutcome))
		}
		p.mu.Unlock()
		if ack != nil {
			p.sendMu.Lock()
			err := p.sendControl(&realtime.ControlClientItem{Item: &realtime.ControlClientItem_InputSynchronizationAck{InputSynchronizationAck: ack}})
			p.sendMu.Unlock()
			if err != nil {
				if errors.Is(err, io.EOF) {
					continue
				}
				p.mu.Lock()
				p.state.controlError = err
				p.mu.Unlock()
				return
			}
		}
	}
}

func (p *peer) readState(receive func() (*realtime.StateServerItem, error)) {
	for {
		item, err := receive()
		p.mu.Lock()
		if err != nil {
			p.state.stateError = err
			p.state.stateClosed = !errors.Is(err, errBrowserFrame)
			p.mu.Unlock()
			return
		}
		if item.GetConnected() != nil {
			p.state.stateConnected = true
		}
		if frame := item.GetStateFrame(); frame != nil {
			if p.state.stateSequence == 0 && frame.Kind != realtime.StateFrameKind_STATE_FRAME_KIND_KEYFRAME {
				p.state.stateError = fmt.Errorf("first State frame was not a keyframe")
				p.mu.Unlock()
				return
			}
			if frame.Fence.GetSessionId() != p.f.env.SessionID || frame.Fence.GetProjectionProfileId() != p.manifest.ProjectionProfile.ProjectionProfileId || frame.Fence.GetAssignmentEpoch() != p.manifest.ProjectionInstance.AssignmentEpoch || !proto.Equal(frame.Fence.GetPublication(), p.manifest.Publication) {
				p.state.stateError = fmt.Errorf("State frame did not match the authenticated Delivery fence")
				p.mu.Unlock()
				return
			}
			if frame.FrameSequence <= p.state.stateSequence {
				p.state.stateError = fmt.Errorf("State sequence did not advance")
				p.mu.Unlock()
				return
			}
			p.state.stateSequence = frame.FrameSequence
			p.state.stateBaseSequence = frame.BaseReliableSequence
		}
		p.mu.Unlock()
	}
}

func (p *peer) snapshot() peerState {
	p.mu.Lock()
	defer p.mu.Unlock()
	s := p.state
	if s.view != nil {
		s.view = proto.Clone(s.view).(*realtime.ParticipantRuntimeView)
	}
	if s.fence != nil {
		s.fence = proto.Clone(s.fence).(*presentation.RuntimeProjectionFence)
	}
	if s.synchronization != nil {
		s.synchronization = proto.Clone(s.synchronization).(*realtime.PresenterInputSynchronization)
	}
	s.nonce = append([]byte(nil), s.nonce...)
	s.outcomes = map[string][]*realtime.CommandOutcome{}
	for id, items := range p.state.outcomes {
		for _, item := range items {
			s.outcomes[id] = append(s.outcomes[id], proto.Clone(item).(*realtime.CommandOutcome))
		}
	}
	return s
}

func (p *peer) wait(label string, ready func(peerState) bool) {
	p.f.t.Helper()
	defer func() {
		if !p.f.t.Failed() {
			return
		}
		s := p.snapshot()
		if s.view == nil {
			p.f.t.Logf("%s: role=%s no Runtime View", label, p.manifest.ProjectionProfile.Key.Role)
			return
		}
		p.f.t.Logf("%s: role=%s step=%s paused=%t sequence=%d stateSequence=%d", label, p.manifest.ProjectionProfile.Key.Role, s.view.Progression.GetCurrentStepId(), s.view.Clock.GetPaused() != nil, s.sequence, s.stateSequence)
		for _, variable := range s.view.Variables {
			p.f.t.Logf("sample variable id=%s boolean=%t", variable.VariableId, variable.Value.GetBooleanValue())
		}
		for _, surface := range s.view.SurfaceStates {
			p.f.t.Logf("sample surface id=%s state=%s", surface.SurfaceId, surface.StateId)
		}
		for _, node := range s.view.NodeStates {
			p.f.t.Logf("sample node id=%s opacity=%v", node.NodeId, node.Opacity)
		}
	}()
	p.f.wait(label, func() bool {
		s := p.snapshot()
		if s.controlError != nil {
			p.f.t.Fatalf("%s: Control closed: %v", label, s.controlError)
		}
		if s.stateError != nil {
			p.f.t.Fatalf("%s: State closed: %v", label, s.stateError)
		}
		return ready(s)
	})
}

func (p *peer) waitView(label, step string, paused bool) {
	p.wait(label, func(s peerState) bool {
		return s.view != nil && s.view.Progression.GetCurrentStepId() == step && (s.view.Clock.GetPaused() != nil) == paused && sampleDisplayMatches(s.view, step)
	})
}

func sampleDisplayMatches(view *realtime.ParticipantRuntimeView, step string) bool {
	wantState, wantOpacity := "reference-surface:default", 1.0
	if step == "finished" {
		wantState, wantOpacity = "reference-surface:inactive", 0.5
	}
	var foundSurface, foundNode bool
	for _, surface := range view.SurfaceStates {
		if surface.SurfaceId == "reference-surface:reference-surface-root" {
			foundSurface = surface.StateId == wantState
		}
	}
	for _, node := range view.NodeStates {
		if node.NodeId == "reference-surface:surface-node" {
			foundNode = node.Opacity == wantOpacity
		}
	}
	return foundSurface && foundNode
}

func (p *peer) waitClosed(label string) {
	p.f.wait(label, func() bool {
		s := p.snapshot()
		if s.controlError != nil && !s.controlClosed {
			p.f.t.Fatalf("%s: Control validation/send failed before receiving a stream terminator: %v", label, s.controlError)
		}
		return s.controlClosed
	})
}
func (p *peer) waitStateClosed(label string) {
	p.f.wait(label, func() bool {
		s := p.snapshot()
		if s.stateError != nil && !s.stateClosed {
			p.f.t.Fatalf("%s: State validation failed before receiving a stream terminator: %v", label, s.stateError)
		}
		return s.stateClosed
	})
}

func (p *peer) send(item *realtime.ControlClientItem) {
	p.f.t.Helper()
	p.sendMu.Lock()
	defer p.sendMu.Unlock()
	if err := p.sendControl(item); err != nil {
		p.f.t.Fatal("send Control:", err)
	}
}

func (p *peer) control(kind realtime.RuntimeControlKind, label string) uint64 {
	p.wait("input ready before Runtime control", func(s peerState) bool {
		return s.synchronization.GetPhase() == realtime.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_READY
	})
	s := p.snapshot()
	command := &realtime.RuntimeControlCommand{ClientEventId: eventID(s.synchronization.CommandEpoch, label), CommandEpoch: s.synchronization.CommandEpoch, PresentationOriginVersion: s.fence.PresentationOriginVersion, Kind: kind}
	p.send(&realtime.ControlClientItem{Item: &realtime.ControlClientItem_RuntimeControl{RuntimeControl: command}})
	result := p.outcome(command.ClientEventId)
	if result.GetAccepted() == nil {
		p.f.t.Fatalf("Runtime control rejected: %v", result)
	}
	return result.GetAccepted().ReliableSequence
}

func (p *peer) gesture(label string) *realtime.GestureInputCommand {
	p.wait("input ready before Gesture", func(s peerState) bool {
		return s.synchronization.GetPhase() == realtime.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_READY
	})
	s := p.snapshot()
	command := &realtime.GestureInputCommand{ClientEventId: eventID(s.synchronization.CommandEpoch, label), CommandEpoch: s.synchronization.CommandEpoch, InputContext: s.synchronization.InputContext, PresentationOriginVersion: s.fence.PresentationOriginVersion, Gesture: presentation.GestureKind_GESTURE_KIND_SWIPE_LEFT}
	p.send(&realtime.ControlClientItem{Item: &realtime.ControlClientItem_GestureInput{GestureInput: command}})
	return command
}

func (p *peer) outcome(id string) *realtime.CommandOutcome {
	p.wait("command outcome", func(s peerState) bool { return len(s.outcomes[id]) > 0 })
	return p.snapshot().outcomes[id][0]
}
func (p *peer) retriedOutcome(id string) *realtime.CommandOutcome {
	p.wait("retried command outcome", func(s peerState) bool { return len(s.outcomes[id]) > 1 })
	return p.snapshot().outcomes[id][1]
}
func (p *peer) close() { p.cancel(); p.closeTransport() }

func (p *peer) disconnect() {
	p.f.t.Helper()
	p.sendMu.Lock()
	err := p.finishControl()
	p.sendMu.Unlock()
	if err != nil && !errors.Is(err, io.EOF) {
		p.f.t.Fatal("finish Control:", err)
	}
	p.waitClosed("server acknowledged Control disconnect")
	p.close()
}

func (f *fixture) assertRejectedStaleConnection(token string, capabilities []presentation.RuntimeCapability) {
	f.t.Helper()
	ctx, cancel := context.WithTimeout(f.ctx, 3*time.Second)
	defer cancel()
	connection := f.dialBrowser(ctx, "/browser/control")
	defer func() { _ = connection.CloseNow() }()
	encoded, _ := json.Marshal(map[string]string{"credential": token})
	if err := connection.Write(ctx, websocket.MessageText, encoded); err != nil {
		return
	}
	if err := browserWrite(ctx, connection, &realtime.ControlClientItem{Item: &realtime.ControlClientItem_Handshake{Handshake: &realtime.ControlHandshake{ProtocolVersion: "v3", ProgressionContractVersion: 2, SupportedCapabilities: capabilities}}}); err != nil {
		return
	}
	for {
		item := new(realtime.ControlServerItem)
		err := browserRead(ctx, connection, item)
		if err != nil {
			if errors.Is(err, errBrowserFrame) {
				f.t.Fatal("stale connection received an invalid frame instead of being closed")
			}
			if ctx.Err() != nil {
				f.t.Fatal("stale Runtime credential was not rejected before deadline")
			}
			return
		}
		if item.GetConnected() != nil || item.GetConnectionSnapshot() != nil {
			f.t.Fatal("ended Session accepted an existing Runtime credential")
		}
	}
}

func (f *fixture) assertRejectedNativeConnection(token string, capabilities []presentation.RuntimeCapability, resume *realtime.ResumeCursor) {
	f.t.Helper()
	ctx, cancel := context.WithTimeout(f.ctx, 3*time.Second)
	defer cancel()
	ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+token)
	endpoint, _ := url.Parse(f.env.RuntimeEndpoint)
	connection, err := grpc.NewClient(endpoint.Host, grpc.WithTransportCredentials(credentials.NewTLS(f.tls.Clone())))
	if err != nil {
		f.t.Fatal("create native reentry connection:", err)
	}
	defer func() { _ = connection.Close() }()
	stream, err := realtime.NewRealtimeServiceClient(connection).ConnectControl(ctx)
	if err != nil {
		if nativeRejection(err) {
			return
		}
		f.t.Fatal("open native reentry stream:", err)
	}
	if err := stream.Send(&realtime.ControlClientItem{Item: &realtime.ControlClientItem_Handshake{Handshake: &realtime.ControlHandshake{ProtocolVersion: "v3", ProgressionContractVersion: 2, SupportedCapabilities: capabilities, Resume: resume}}}); err != nil && !errors.Is(err, io.EOF) {
		if nativeRejection(err) {
			return
		}
		f.t.Fatal("send native reentry handshake:", err)
	}
	for {
		item, err := stream.Recv()
		if err != nil {
			if nativeRejection(err) {
				return
			}
			f.t.Fatalf("native reentry did not return an assignment/authentication rejection: %v", err)
		}
		if item.GetConnected() != nil || item.GetConnectionSnapshot() != nil {
			f.t.Fatal("ended Session accepted native connection/reconnect")
		}
	}
}

func nativeRejection(err error) bool {
	switch status.Code(err) {
	case codes.Unauthenticated, codes.PermissionDenied, codes.FailedPrecondition:
		return true
	default:
		return false
	}
}
