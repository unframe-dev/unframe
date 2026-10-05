package grpc

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"sync"
	"sync/atomic"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	deliveryv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/delivery/v2"
	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
	persistencehttp "github.com/unframe-dev/unframe/app/server/realtime/internal/persistence/http"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/runtimecore"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

type V2ProjectionProvider interface {
	Projection(context.Context, persistencehttp.ProjectionRequest) (persistencehttp.RuntimeProjection, error)
}

var errV2StatePending = errors.New("v2 state projection has pending reliable events")

type v2Control struct {
	identity          session.Identity
	profile           *deliveryv2.ProjectionProfileDescriptor
	fence             *presentationv2.RuntimeProjectionFence
	ready             chan struct{}
	done              chan struct{}
	readyOnce         sync.Once
	snapshotCut       uint64
	originCut         uint64
	stateConnected    bool
	stateDetached     chan struct{}
	faultGeneration   uint64
	observedSequence  atomic.Uint64
	deliveredSequence atomic.Uint64
}

type v2ResumeRecord struct {
	participantID   string
	profileID       string
	fence           *presentationv2.RuntimeProjectionFence
	expiresAt       time.Time
	faultGeneration uint64
}

type V2Service struct {
	realtimev2.UnimplementedRealtimeServiceV2Server
	runtime         *runtimecore.V2Session
	bootstrap       persistencehttp.RuntimeBootstrap
	projections     V2ProjectionProvider
	identities      auth.IdentityResolver
	assignments     AssignmentAuthorizer
	nonces          *session.StateNonceManager
	mu              sync.Mutex
	controls        map[string]*v2Control
	resumeRecords   map[string]v2ResumeRecord
	trackingStarted time.Time
}

func NewV2Service(runtime *runtimecore.V2Session, bootstrap persistencehttp.RuntimeBootstrap, projections V2ProjectionProvider, identities auth.IdentityResolver, assignments AssignmentAuthorizer) (*V2Service, error) {
	if runtime == nil || projections == nil || identities == nil || assignments == nil || bootstrap.Assignment.SessionID == "" || bootstrap.Publication.PublicationEpoch == 0 {
		return nil, ErrServerConfiguration
	}
	return &V2Service{runtime: runtime, bootstrap: bootstrap, projections: projections, identities: identities, assignments: assignments, nonces: session.NewStateNonceManager(nil), controls: make(map[string]*v2Control), resumeRecords: make(map[string]v2ResumeRecord), trackingStarted: time.Now()}, nil
}

func (s *V2Service) ConnectControl(stream grpcgo.BidiStreamingServer[realtimev2.ControlClientItem, realtimev2.ControlServerItem]) (result error) {
	defer func() { setV2ReasonTrailer(stream, result) }()
	identity, err := s.identities.Resolve(stream.Context())
	if err != nil || identity.ProtocolVersion != 2 {
		return status.Error(codes.Unauthenticated, "v2 realtime credential is required")
	}
	claim := assignmentClaim(identity)
	var sendMu sync.Mutex
	sendRaw := func(item *realtimev2.ControlServerItem) error {
		if proto.Size(item) > 1<<20 {
			return status.Error(codes.ResourceExhausted, "message_limit_exceeded")
		}
		_, err := v2BeforeLeaseExpiry(stream.Context(), func() (time.Time, error) { return s.assignments.ReliableDeliveryDeadline(claim) }, func() (struct{}, error) { return struct{}{}, stream.Send(item) })
		return err
	}
	send := func(item *realtimev2.ControlServerItem) error {
		sendMu.Lock()
		defer sendMu.Unlock()
		return sendRaw(item)
	}
	if err := s.assignments.AllowNewConnection(claim); err != nil {
		return assignmentError(err)
	}
	first, err := v2BeforeLeaseExpiry(stream.Context(), func() (time.Time, error) { return s.assignments.ConnectionDeadline(assignmentClaim(identity)) }, stream.Recv)
	if err != nil {
		if errors.Is(err, io.EOF) {
			return status.Error(codes.InvalidArgument, "handshake_order_invalid")
		}
		return err
	}
	if proto.Size(first) > 1<<20 {
		return status.Error(codes.ResourceExhausted, "message_limit_exceeded")
	}
	handshake := first.GetHandshake()
	if handshake == nil {
		return status.Error(codes.InvalidArgument, "handshake_order_invalid")
	}
	if err := protocolv2.ValidateMessage(handshake); err != nil {
		return status.Error(codes.InvalidArgument, "message_invalid")
	}
	projection, err := s.projections.Projection(stream.Context(), persistencehttp.ProjectionRequest{SessionID: identity.SessionID, ParticipantID: identity.ParticipantID})
	if err != nil {
		return status.Error(codes.Unavailable, "runtime_projection_unavailable")
	}
	profile := projection.Profile
	if profile == nil || projection.Role != roleName(identity.Role) || profile.Key == nil || profile.Key.Role != v2Role(identity.Role) || profile.Key.Publication == nil || profile.Key.Publication.PresentationId != s.bootstrap.Publication.PresentationID || profile.Key.Publication.PublicationEpoch != s.bootstrap.Publication.PublicationEpoch || profile.Key.Publication.PublicationManifestHash != s.bootstrap.Publication.PublicationManifestHash {
		return status.Error(codes.FailedPrecondition, "publication_fence_mismatch")
	}
	if err := protocolv2.NegotiateControl(handshake, profile.RequiredRuntimeCapabilities); err != nil {
		return status.Error(codes.FailedPrecondition, "protocol_incompatible")
	}
	connectionID, err := randomConnectionID()
	if err != nil {
		return status.Error(codes.Internal, "internal_error")
	}
	if resume := handshake.Resume; resume != nil {
		s.mu.Lock()
		s.evictResumeRecords(time.Now())
		previous, known := s.resumeRecords[resume.PriorConnectionId]
		if known && time.Now().After(previous.expiresAt) {
			delete(s.resumeRecords, resume.PriorConnectionId)
			known = false
		}
		s.mu.Unlock()
		if !known || previous.faultGeneration != s.runtime.FaultGeneration() || previous.participantID != identity.ParticipantID || !proto.Equal(previous.fence, resume.Fence) {
			return s.resync(send, s.runtime.Snapshot().ReliableSequence, realtimev2.ResyncReason_RESYNC_REASON_REPLAY_RANGE_UNAVAILABLE)
		}
		if previous.profileID != profile.ProjectionProfileId {
			return s.resync(send, s.runtime.Snapshot().ReliableSequence, realtimev2.ResyncReason_RESYNC_REASON_PROJECTION_CHANGED)
		}
	}
	if err := s.assignments.AllowNewConnection(claim); err != nil {
		return assignmentError(err)
	}
	if err := s.runtime.JoinParticipant(stream.Context(), identity); err != nil {
		if errors.Is(err, session.ErrParticipantActive) {
			return status.Error(codes.AlreadyExists, "participant_already_connected")
		}
		return status.Error(codes.Unavailable, "runtime_persistence_unavailable")
	}
	defer func() {
		leaveCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = s.runtime.LeaveParticipant(leaveCtx, identity)
	}()
	faultGeneration := s.runtime.FaultGeneration()
	snapshot, presence, events, unsubscribe := s.runtime.SnapshotPresenceAndSubscribe()
	defer unsubscribe()
	view, err := runtimecore.ProjectV2Snapshot(snapshot, profile, identity.AssignmentEpoch, nil)
	if err != nil {
		return status.Error(codes.FailedPrecondition, "runtime_snapshot_invalid")
	}
	fence := &presentationv2.RuntimeProjectionFence{SessionId: identity.SessionID, Publication: &presentationv2.PublicationFence{PresentationId: s.bootstrap.Publication.PresentationID, PublicationEpoch: s.bootstrap.Publication.PublicationEpoch, PublicationManifestHash: s.bootstrap.Publication.PublicationManifestHash}, AssignmentEpoch: identity.AssignmentEpoch, ProjectionProfileId: profile.ProjectionProfileId, PresentationOriginVersion: snapshot.PresentationOrigin.Version}
	instance := &presentationv2.ProjectionInstance{ProjectionProfileId: profile.ProjectionProfileId, ParticipantId: identity.ParticipantID, AssignmentEpoch: identity.AssignmentEpoch}
	cut := &realtimev2.ConnectionSnapshotEnvelope{SchemaVersion: 2, ConnectionId: connectionID, Fence: proto.Clone(fence).(*presentationv2.RuntimeProjectionFence), ProjectionInstance: proto.Clone(instance).(*presentationv2.ProjectionInstance), PresenceAtCut: presence, ReliableSequence: snapshot.ReliableSequence, Snapshot: &realtimev2.ProjectedRuntimeSnapshot{ProjectionProfileId: profile.ProjectionProfileId, AssignmentEpoch: identity.AssignmentEpoch, ReliableSequence: snapshot.ReliableSequence, RuntimeView: view}}
	var resumed []*realtimev2.ProjectedReliableEvent
	if resume := handshake.Resume; resume != nil {
		if !proto.Equal(resume.Fence, fence) {
			return s.resync(send, snapshot.ReliableSequence, v2FenceResyncReason(resume.Fence, fence))
		}
		resumed, err = s.runtime.ReplayThrough(resume.AppliedReliableSequence, snapshot.ReliableSequence)
		if err != nil {
			return s.resync(send, snapshot.ReliableSequence, realtimev2.ResyncReason_RESYNC_REASON_REPLAY_RANGE_UNAVAILABLE)
		}
	} else if _, err := protocolv2.NewConnectionCursor(cut, fence, profile.RuntimeCatalog); err != nil {
		return status.Error(codes.FailedPrecondition, "runtime_snapshot_invalid")
	}
	control := &v2Control{identity: identity, profile: profile, fence: fence, ready: make(chan struct{}), stateDetached: make(chan struct{}, 1), done: make(chan struct{}), snapshotCut: snapshot.ReliableSequence, originCut: snapshot.PresentationOrigin.Version, faultGeneration: faultGeneration}
	initialCursor := snapshot.ReliableSequence
	if handshake.Resume != nil {
		initialCursor = handshake.Resume.AppliedReliableSequence
	}
	control.observedSequence.Store(initialCursor)
	control.deliveredSequence.Store(initialCursor)
	s.mu.Lock()
	s.controls[connectionID] = control
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		close(control.done)
		delete(s.controls, connectionID)
		s.evictResumeRecords(time.Now())
		s.resumeRecords[connectionID] = v2ResumeRecord{participantID: identity.ParticipantID, profileID: profile.ProjectionProfileId, fence: proto.Clone(fence).(*presentationv2.RuntimeProjectionFence), expiresAt: time.Now().Add(15 * time.Minute), faultGeneration: faultGeneration}
		s.mu.Unlock()
		s.nonces.Revoke(connectionID)
	}()
	lastVisible := snapshot.ReliableSequence
	if handshake.Resume != nil {
		lastVisible = handshake.Resume.AppliedReliableSequence
	}
	observed := lastVisible
	sendProjected := func(event *realtimev2.ProjectedReliableEvent) error {
		sendMu.Lock()
		defer sendMu.Unlock()
		if event.Sequence <= observed {
			return nil
		}
		if event.Sequence != observed+1 {
			return status.Error(codes.FailedPrecondition, "runtime_snapshot_invalid")
		}
		observed = event.Sequence
		control.observedSequence.Store(observed)
		projected, visible := runtimecore.ProjectV2ReliableEvent(event, profile)
		if !visible {
			return nil
		}
		projected.Fence = proto.Clone(fence).(*presentationv2.RuntimeProjectionFence)
		if lastVisible+1 < event.Sequence {
			advance := &realtimev2.ProjectionAdvance{Fence: proto.Clone(fence).(*presentationv2.RuntimeProjectionFence), FromExclusive: lastVisible, ThroughSequence: event.Sequence - 1}
			if err := sendRaw(&realtimev2.ControlServerItem{Item: &realtimev2.ControlServerItem_ProjectionAdvance{ProjectionAdvance: advance}}); err != nil {
				return err
			}
		}
		item := &realtimev2.ControlServerItem{Item: &realtimev2.ControlServerItem_ReliableEvent{ReliableEvent: projected}}
		if proto.Size(item) > 1<<20 {
			return status.Error(codes.ResourceExhausted, "message_limit_exceeded")
		}
		if err := sendRaw(item); err != nil {
			return err
		}
		lastVisible = event.Sequence
		control.deliveredSequence.Store(lastVisible)
		return nil
	}
	connected := &realtimev2.ControlConnected{ProtocolVersion: "v2", ProgressionContractVersion: 1, RequiredCapabilities: profile.RequiredRuntimeCapabilities, ConnectionId: connectionID, ProjectionInstance: instance, Limits: v2ProtocolLimits()}
	if err := send(&realtimev2.ControlServerItem{Item: &realtimev2.ControlServerItem_Connected{Connected: connected}}); err != nil {
		return err
	}
	if handshake.Resume == nil {
		if err := send(&realtimev2.ControlServerItem{Item: &realtimev2.ControlServerItem_ConnectionSnapshot{ConnectionSnapshot: cut}}); err != nil {
			return err
		}
	} else {
		for _, event := range resumed {
			if err := sendProjected(event); err != nil {
				return err
			}
		}
		control.snapshotCut = control.deliveredSequence.Load()
	}
	issueNonce := func() error {
		nonce, err := s.nonces.Issue(connectionID, identity.ParticipantID)
		if err != nil {
			return status.Error(codes.Internal, "internal_error")
		}
		return send(&realtimev2.ControlServerItem{Item: &realtimev2.ControlServerItem_StateConnectionNonce{StateConnectionNonce: &realtimev2.StateConnectionNonce{Nonce: nonce, ExpiresInMs: 30000}}})
	}
	if err := issueNonce(); err != nil {
		return err
	}
	streamErrors := make(chan error, 1)
	go func() {
		for event := range events {
			if err := sendProjected(event); err != nil {
				streamErrors <- err
				return
			}
		}
		streamErrors <- status.Error(codes.ResourceExhausted, "reliable_subscriber_slow")
	}()
	type receivedControl struct {
		item *realtimev2.ControlClientItem
		err  error
	}
	received := make(chan receivedControl, 1)
	go func() {
		for {
			item, err := stream.Recv()
			select {
			case received <- receivedControl{item: item, err: err}:
			case <-stream.Context().Done():
				return
			}
			if err != nil {
				return
			}
		}
	}()
	deadline, err := s.assignments.ConnectionDeadline(claim)
	if err != nil {
		return assignmentError(err)
	}
	leaseTimer := time.NewTimer(time.Until(deadline))
	defer leaseTimer.Stop()
	leaseCheck := time.NewTicker(time.Second)
	defer leaseCheck.Stop()
	for {
		var item *realtimev2.ControlClientItem
		var err error
		select {
		case <-control.stateDetached:
			if err := issueNonce(); err != nil {
				return err
			}
			continue
		case incoming := <-received:
			item, err = incoming.item, incoming.err
		case err := <-streamErrors:
			return err
		case <-leaseTimer.C:
			deadline, err := s.assignments.ConnectionDeadline(claim)
			if err != nil {
				return assignmentError(err)
			}
			remaining := time.Until(deadline)
			if remaining <= 0 {
				return assignmentError(assignment.ErrLeaseExpired)
			}
			leaseTimer.Reset(remaining)
			continue
		case <-leaseCheck.C:
			if s.runtime.FaultGeneration() != control.faultGeneration {
				return status.Error(codes.FailedPrecondition, "private_runtime_fault")
			}
			if err := s.assignments.AllowCommand(claim); err != nil {
				return assignmentError(err)
			}
			continue
		case <-stream.Context().Done():
			return stream.Context().Err()
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		if err := s.assignments.AllowCommand(claim); err != nil {
			return assignmentError(err)
		}
		if s.runtime.FaultGeneration() != control.faultGeneration {
			return status.Error(codes.FailedPrecondition, "private_runtime_fault")
		}
		if item == nil {
			return status.Error(codes.InvalidArgument, "handshake_order_invalid")
		}
		if proto.Size(item) > 1<<20 {
			return status.Error(codes.ResourceExhausted, "message_limit_exceeded")
		}
		if err := protocolv2.ValidateMessage(item); err != nil {
			return status.Error(codes.InvalidArgument, "message_invalid")
		}
		switch value := item.Item.(type) {
		case *realtimev2.ControlClientItem_StateReady:
			s.mu.Lock()
			if !control.stateConnected {
				s.mu.Unlock()
				return status.Error(codes.InvalidArgument, "handshake_order_invalid")
			}
			if value.StateReady.AppliedReliableSequence != control.snapshotCut || value.StateReady.PresentationOriginVersion != control.originCut {
				s.mu.Unlock()
				return status.Error(codes.FailedPrecondition, "state_ready_fence_mismatch")
			}
			control.readyOnce.Do(func() { close(control.ready) })
			s.mu.Unlock()
		case *realtimev2.ControlClientItem_LogicalInput:
			outcome, _, err := s.runtime.LogicalInputContext(stream.Context(), identity, value.LogicalInput)
			if err != nil {
				return v2CommandError(err)
			}
			if err := send(&realtimev2.ControlServerItem{Item: &realtimev2.ControlServerItem_CommandOutcome{CommandOutcome: outcome}}); err != nil {
				return err
			}
		case *realtimev2.ControlClientItem_SurfaceInteraction:
			outcome, _, err := s.runtime.SurfaceInteractionContext(stream.Context(), identity, value.SurfaceInteraction)
			if err != nil {
				return v2CommandError(err)
			}
			if err := send(&realtimev2.ControlServerItem{Item: &realtimev2.ControlServerItem_CommandOutcome{CommandOutcome: outcome}}); err != nil {
				return err
			}
		case *realtimev2.ControlClientItem_RuntimeControl:
			outcome, _, err := s.runtime.RuntimeControl(stream.Context(), identity, value.RuntimeControl)
			if err != nil {
				return v2CommandError(err)
			}
			if err := send(&realtimev2.ControlServerItem{Item: &realtimev2.ControlServerItem_CommandOutcome{CommandOutcome: outcome}}); err != nil {
				return err
			}
		case *realtimev2.ControlClientItem_ReplayRequest:
			replay, err := s.runtime.Replay(value.ReplayRequest.AfterSequence)
			if err != nil {
				return s.resync(send, s.runtime.Snapshot().ReliableSequence, realtimev2.ResyncReason_RESYNC_REASON_REPLAY_RANGE_UNAVAILABLE)
			}
			sendMu.Lock()
			replayLast := value.ReplayRequest.AfterSequence
			for _, event := range replay {
				projected, visible := runtimecore.ProjectV2ReliableEvent(event, profile)
				if !visible {
					continue
				}
				projected.Fence = proto.Clone(fence).(*presentationv2.RuntimeProjectionFence)
				if replayLast+1 < event.Sequence {
					advance := &realtimev2.ProjectionAdvance{Fence: proto.Clone(fence).(*presentationv2.RuntimeProjectionFence), FromExclusive: replayLast, ThroughSequence: event.Sequence - 1}
					if err := sendRaw(&realtimev2.ControlServerItem{Item: &realtimev2.ControlServerItem_ProjectionAdvance{ProjectionAdvance: advance}}); err != nil {
						sendMu.Unlock()
						return err
					}
				}
				item := &realtimev2.ControlServerItem{Item: &realtimev2.ControlServerItem_ReliableEvent{ReliableEvent: projected}}
				if proto.Size(item) > 1<<20 {
					sendMu.Unlock()
					return status.Error(codes.ResourceExhausted, "message_limit_exceeded")
				}
				if err := sendRaw(item); err != nil {
					sendMu.Unlock()
					return err
				}
				replayLast = event.Sequence
			}
			sendMu.Unlock()
		default:
			return status.Error(codes.InvalidArgument, "handshake_order_invalid")
		}
	}
}

func (s *V2Service) ConnectState(stream grpcgo.BidiStreamingServer[realtimev2.StateClientItem, realtimev2.StateServerItem]) (result error) {
	defer func() { setV2ReasonTrailer(stream, result) }()
	identity, err := s.identities.Resolve(stream.Context())
	if err != nil || identity.ProtocolVersion != 2 {
		return status.Error(codes.Unauthenticated, "v2 realtime credential is required")
	}
	send := func(item *realtimev2.StateServerItem) error {
		_, err := v2BeforeLeaseExpiry(stream.Context(), func() (time.Time, error) {
			return s.assignments.ConnectionDeadline(assignmentClaim(identity))
		}, func() (struct{}, error) { return struct{}{}, stream.Send(item) })
		return err
	}
	if err := s.assignments.AllowNewConnection(assignmentClaim(identity)); err != nil {
		return assignmentError(err)
	}
	first, err := v2BeforeLeaseExpiry(stream.Context(), func() (time.Time, error) { return s.assignments.ConnectionDeadline(assignmentClaim(identity)) }, stream.Recv)
	if err != nil {
		return err
	}
	if first.GetHandshake() == nil {
		return status.Error(codes.InvalidArgument, "handshake_order_invalid")
	}
	if proto.Size(first) > 256<<10 {
		return status.Error(codes.ResourceExhausted, "message_limit_exceeded")
	}
	handshake := first.GetHandshake()
	if err := protocolv2.ValidateMessage(handshake); err != nil {
		return status.Error(codes.InvalidArgument, "message_invalid")
	}
	s.mu.Lock()
	control := s.controls[handshake.ConnectionId]
	s.mu.Unlock()
	if control == nil || control.identity.SessionID != identity.SessionID || control.identity.ParticipantID != identity.ParticipantID || handshake.ProtocolVersion != "v2" || handshake.ProgressionContractVersion != 1 || !sameCapabilities(handshake.SupportedCapabilities, control.profile.RequiredRuntimeCapabilities) || s.nonces.Consume(handshake.ConnectionId, identity.ParticipantID, handshake.StateConnectionNonce) != nil {
		return status.Error(codes.Unauthenticated, "state_nonce_invalid")
	}
	s.mu.Lock()
	if control.stateConnected || s.controls[handshake.ConnectionId] != control {
		s.mu.Unlock()
		return status.Error(codes.Unauthenticated, "state_nonce_invalid")
	}
	control.stateConnected = true
	ready := control.ready
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		control.stateConnected = false
		control.ready = make(chan struct{})
		control.readyOnce = sync.Once{}
		if s.controls[handshake.ConnectionId] == control {
			select {
			case control.stateDetached <- struct{}{}:
			default:
			}
		}
		s.mu.Unlock()
	}()
	if err := send(&realtimev2.StateServerItem{Item: &realtimev2.StateServerItem_Connected{Connected: &realtimev2.StateConnected{ConnectionId: handshake.ConnectionId, NextStateFrameSequence: 1}}}); err != nil {
		return err
	}
	stateInput := make(chan error, 1)
	go func() {
		var trackingRate v2TrackingRate
		for {
			item, err := stream.Recv()
			if err != nil {
				stateInput <- err
				return
			}
			if item.GetHandshake() != nil || item.GetTrackingFrame() == nil {
				stateInput <- status.Error(codes.InvalidArgument, "handshake_order_invalid")
				return
			}
			if proto.Size(item) > 256<<10 {
				stateInput <- status.Error(codes.ResourceExhausted, "message_limit_exceeded")
				return
			}
			if err := protocolv2.ValidateMessage(item); err != nil {
				stateInput <- status.Error(codes.InvalidArgument, "message_invalid")
				return
			}
			select {
			case <-ready:
			default:
				stateInput <- status.Error(codes.InvalidArgument, "handshake_order_invalid")
				return
			}
			select {
			case <-control.done:
				stateInput <- s.v2ControlClosed(control)
				return
			default:
			}
			if s.runtime.FaultGeneration() != control.faultGeneration {
				stateInput <- status.Error(codes.FailedPrecondition, "private_runtime_fault")
				return
			}
			if err := s.assignments.AllowCommand(assignmentClaim(identity)); err != nil {
				stateInput <- assignmentError(err)
				return
			}
			if identity.Role != session.RolePresenter {
				stateInput <- status.Error(codes.PermissionDenied, "presenter_required")
				return
			}
			receivedAt := time.Now()
			admitted, closeStream := trackingRate.Admit(receivedAt)
			if closeStream {
				stateInput <- status.Error(codes.ResourceExhausted, "state_rate_exceeded")
				return
			}
			if !admitted {
				continue
			}
			observedAtMs := uint64(time.Since(s.trackingStarted)/time.Millisecond) + 1
			if _, _, err := s.runtime.AcceptTracking(stream.Context(), identity, item.GetTrackingFrame(), receivedAt, observedAtMs); err != nil {
				stateInput <- status.Error(codes.InvalidArgument, "message_invalid")
				return
			}
		}
	}()
	_, err = v2BeforeLeaseExpiry(stream.Context(), func() (time.Time, error) { return s.assignments.ConnectionDeadline(assignmentClaim(identity)) }, func() (struct{}, error) {
		select {
		case <-ready:
			return struct{}{}, nil
		case <-control.done:
			return struct{}{}, s.v2ControlClosed(control)
		case err := <-stateInput:
			return struct{}{}, err
		case <-stream.Context().Done():
			return struct{}{}, stream.Context().Err()
		}
	})
	if err != nil {
		return err
	}

	waitTick := func(ticks <-chan time.Time) error {
		_, err := v2BeforeLeaseExpiry(stream.Context(), func() (time.Time, error) { return s.assignments.ConnectionDeadline(assignmentClaim(identity)) }, func() (struct{}, error) {
			select {
			case <-ticks:
				return struct{}{}, nil
			case <-control.done:
				return struct{}{}, s.v2ControlClosed(control)
			case err := <-stateInput:
				return struct{}{}, err
			case <-stream.Context().Done():
				return struct{}{}, stream.Context().Err()
			}
		})
		return err
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	sequence := uint64(1)
	cadence := time.Second
	for {
		select {
		case <-control.done:
			return s.v2ControlClosed(control)
		default:
		}
		if s.runtime.FaultGeneration() != control.faultGeneration {
			return status.Error(codes.FailedPrecondition, "private_runtime_fault")
		}
		if err := s.assignments.AllowCommand(assignmentClaim(identity)); err != nil {
			return assignmentError(err)
		}
		frame, err := s.keyframe(control, sequence)
		if errors.Is(err, errV2StatePending) {
			if err := waitTick(ticker.C); err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		outbound := &realtimev2.StateServerItem{Item: &realtimev2.StateServerItem_StateFrame{StateFrame: frame}}
		if proto.Size(outbound) > 256<<10 {
			return status.Error(codes.ResourceExhausted, "message_limit_exceeded")
		}
		if err := send(outbound); err != nil {
			return err
		}
		nextCadence := time.Second
		if len(frame.AnchorBindings) != 0 {
			nextCadence = 50 * time.Millisecond
		}
		if nextCadence != cadence {
			ticker.Reset(nextCadence)
			cadence = nextCadence
		}
		sequence++
		if err := waitTick(ticker.C); err != nil {
			return err
		}
	}
}

func (s *V2Service) keyframe(control *v2Control, sequence uint64) (*realtimev2.ElementStateFrame, error) {
	snapshot := s.runtime.Snapshot()
	if control.observedSequence.Load() < snapshot.ReliableSequence || control.deliveredSequence.Load() > snapshot.ReliableSequence {
		return nil, errV2StatePending
	}
	view, err := runtimecore.ProjectV2Snapshot(snapshot, control.profile, control.identity.AssignmentEpoch, nil)
	if err != nil {
		return nil, status.Error(codes.FailedPrecondition, "runtime_snapshot_invalid")
	}
	owned, err := s.runtime.TimelineOwnedNodeProperties(snapshot)
	if err != nil {
		return nil, status.Error(codes.FailedPrecondition, "runtime_snapshot_invalid")
	}
	nowMs := uint64(time.Since(s.trackingStarted)/time.Millisecond) + 1
	frame := &realtimev2.ElementStateFrame{Fence: proto.Clone(control.fence).(*presentationv2.RuntimeProjectionFence), FrameSequence: sequence, BaseReliableSequence: control.deliveredSequence.Load(), Kind: realtimev2.StateFrameKind_STATE_FRAME_KIND_KEYFRAME, ProducedAtRuntimeMonotonicMs: nowMs}
	for _, node := range view.NodeStates {
		frame.Elements = append(frame.Elements, &realtimev2.ElementStatePatch{ElementId: node.NodeId, Node: v2KeyframeNodePatch(node, owned[node.NodeId])})
	}
	frame.AnchorBindings, err = s.runtime.ProjectedAnchorBindings(view.NodeStates, nowMs)
	if err != nil {
		return nil, status.Error(codes.FailedPrecondition, "runtime_snapshot_invalid")
	}
	return frame, nil
}

func v2KeyframeNodePatch(node *realtimev2.NodeRuntimeState, owned map[string]bool) *realtimev2.NodeStatePatch {
	active, visible, opacity := node.Active, node.Visible, node.Opacity
	patch := &realtimev2.NodeStatePatch{}
	if !owned["active"] {
		patch.Active = &active
	}
	if !owned["visible"] {
		patch.Visible = &visible
	}
	if !owned["opacity"] {
		patch.Opacity = &opacity
	}
	transform := &presentationv2.Transform{}
	if !owned["transform.position"] {
		transform.Position = proto.Clone(node.Transform.Position).(*presentationv2.Vector3)
	}
	if !owned["transform.rotation"] {
		transform.Rotation = proto.Clone(node.Transform.Rotation).(*presentationv2.Quaternion)
	}
	if !owned["transform.scale"] {
		transform.Scale = proto.Clone(node.Transform.Scale).(*presentationv2.Vector3)
	}
	if transform.Position != nil || transform.Rotation != nil || transform.Scale != nil {
		patch.Transform = transform
	}
	return patch
}

func (s *V2Service) resync(send func(*realtimev2.ControlServerItem) error, latest uint64, reason realtimev2.ResyncReason) error {
	if err := send(&realtimev2.ControlServerItem{Item: &realtimev2.ControlServerItem_ResyncRequired{ResyncRequired: &realtimev2.ResyncRequired{Reason: reason, NewestReliableSequence: latest}}}); err != nil {
		return err
	}
	return nil
}

func v2FenceResyncReason(old, current *presentationv2.RuntimeProjectionFence) realtimev2.ResyncReason {
	if old == nil || current == nil {
		return realtimev2.ResyncReason_RESYNC_REASON_REPLAY_RANGE_UNAVAILABLE
	}
	if !proto.Equal(old.Publication, current.Publication) || old.AssignmentEpoch != current.AssignmentEpoch {
		return realtimev2.ResyncReason_RESYNC_REASON_PUBLICATION_FENCE_CHANGED
	}
	if old.ProjectionProfileId != current.ProjectionProfileId {
		return realtimev2.ResyncReason_RESYNC_REASON_PROJECTION_CHANGED
	}
	if old.PresentationOriginVersion != current.PresentationOriginVersion {
		return realtimev2.ResyncReason_RESYNC_REASON_PRESENTATION_ORIGIN_CHANGED
	}
	return realtimev2.ResyncReason_RESYNC_REASON_REPLAY_RANGE_UNAVAILABLE
}

func (s *V2Service) v2ControlClosed(control *v2Control) error {
	if s.runtime.FaultGeneration() != control.faultGeneration {
		return status.Error(codes.FailedPrecondition, "private_runtime_fault")
	}
	return nil
}

func v2CommandError(err error) error {
	switch {
	case errors.Is(err, runtimecore.ErrV2PresenterRequired):
		return status.Error(codes.PermissionDenied, "presenter_required")
	case errors.Is(err, runtimecore.ErrV2OriginMismatch):
		return status.Error(codes.FailedPrecondition, "presentation_origin_mismatch")
	case errors.Is(err, runtimecore.ErrV2IdempotencyKeyReused):
		return status.Error(codes.InvalidArgument, "idempotency_key_reused")
	case errors.Is(err, runtimecore.ErrV2PersistenceUnavailable):
		return status.Error(codes.Unavailable, "runtime_persistence_unavailable")
	default:
		return status.Error(codes.FailedPrecondition, "runtime_snapshot_invalid")
	}
}

func randomConnectionID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return "connection-" + hex.EncodeToString(value[:]), nil
}

func roleName(role session.Role) string {
	if role == session.RolePresenter {
		return "presenter"
	}
	if role == session.RoleViewer {
		return "viewer"
	}
	return ""
}

func v2Role(role session.Role) presentationv2.SessionRole {
	if role == session.RolePresenter {
		return presentationv2.SessionRole_SESSION_ROLE_PRESENTER
	}
	return presentationv2.SessionRole_SESSION_ROLE_VIEWER
}

func sameCapabilities(supported, required []presentationv2.RuntimeCapability) bool {
	set := make(map[presentationv2.RuntimeCapability]bool)
	for _, capability := range supported {
		set[capability] = true
	}
	for _, capability := range required {
		if !set[capability] {
			return false
		}
	}
	return true
}

func v2ProtocolLimits() *realtimev2.RuntimeProtocolLimits {
	return &realtimev2.RuntimeProtocolLimits{MaximumIdUtf8Bytes: 128, MaximumControlItemBytes: 1048576, MaximumStateItemBytes: 262144, ReliableEventRetentionCount: 4096, ReliableEventRetentionBytes: 8 << 20, ReliableEventRetentionMs: 900000, MaximumReplayItems: 1024, MaximumReplayBytes: 1 << 20, IdempotencyRetentionCount: 1024, IdempotencyRetentionMs: 900000, SnapshotCatchUpMaxAttempts: 3, SnapshotCatchUpTotalBudgetMs: 250, RuntimeMicrostepLimit: 1024, MaximumTrackingSamplesPerFrame: 4, MaximumTrackingFramesPerSecond: 90, AnchorSampleMaxAgeMs: 500, CatchUpQueueMaximumItems: 1024, CatchUpQueueMaximumBytes: 1 << 20, StateDependencyBufferMaximumValues: 4096, StateDependencyBufferMaximumMs: 500}
}

func setV2ReasonTrailer(stream grpcgo.ServerStream, err error) {
	if err == nil {
		return
	}
	var reason string
	switch status.Convert(err).Message() {
	case "v2 realtime credential is required", "realtime connection is unauthenticated":
		reason = "authentication_required"
	case "handshake_order_invalid":
		reason = "handshake_order_invalid"
	case "realtime assignment does not match this runtime":
		reason = "assignment_fence_mismatch"
	case "realtime assignment lease has expired":
		reason = "assignment_lease_expired"
	case "realtime assignment is not active":
		reason = "assignment_inactive"
	case "message_invalid", "message_limit_exceeded", "state_nonce_invalid", "protocol_incompatible", "publication_fence_mismatch", "presentation_origin_mismatch", "state_ready_fence_mismatch", "idempotency_key_reused", "presenter_required", "runtime_snapshot_invalid", "runtime_projection_unavailable", "runtime_persistence_unavailable", "participant_already_connected", "reliable_subscriber_slow", "state_rate_exceeded", "internal_error":
		reason = status.Convert(err).Message()
	case "private_runtime_fault":
		reason = "runtime_snapshot_required"
	}
	if reason != "" {
		stream.SetTrailer(metadata.Pairs("unframe-reason", reason))
	}
}

// Caller owns s.mu; expired credentials must not accumulate without resume lookups.
func (s *V2Service) evictResumeRecords(now time.Time) {
	for id, record := range s.resumeRecords {
		if !now.Before(record.expiresAt) {
			delete(s.resumeRecords, id)
		}
	}
}
