package grpc

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/proto"
)

type credentialExpiryJWKS struct{ document []byte }

func (c credentialExpiryJWKS) Do(request *http.Request) (*http.Response, error) {
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(string(c.document))), Request: request}, nil
}

type nativeCredentialSession struct {
	service    *V2Service
	verifier   *auth.BearerTokenVerifier
	guard      *assignment.AssignmentGuard
	client     realtime.RealtimeServiceClient
	ctx        context.Context
	expires    time.Time
	credential func(time.Time) context.Context
}

func nativeCredentialFixture(t *testing.T) nativeCredentialSession {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	t.Cleanup(cancel)
	now := time.Now()
	expires := now.Add(2 * time.Second).Truncate(time.Second)
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	jwks, err := json.Marshal(map[string]any{"keys": []any{map[string]any{"kty": "OKP", "crv": "Ed25519", "kid": "test", "alg": "EdDSA", "use": "sig", "key_ops": []string{"verify"}, "x": base64.RawURLEncoding.EncodeToString(public)}}})
	if err != nil {
		t.Fatal(err)
	}
	verifier, err := auth.NewBearerTokenVerifier(auth.BearerTokenVerifierConfig{Issuer: "https://control-plane.example.test", Audience: "test-runtime", JWKSURL: "https://control-plane.example.test/jwks", HTTPClient: credentialExpiryJWKS{document: jwks}})
	if err != nil {
		t.Fatal(err)
	}
	credential := func(expiry time.Time) context.Context {
		claims, err := json.Marshal(map[string]any{"iss": "https://control-plane.example.test", "aud": "test-runtime", "sub": "presenter-1", "session_id": "session-1", "role": "presenter", "runtime_id": "runtime-1", "runtime_kind": "Cloud", "assignment_epoch": 3, "presentation_id": "presentation-1", "presentation_revision": 4, "protocol_version": 3, "scope": "realtime:connect", "nbf": now.Add(-time.Minute).Unix(), "exp": expiry.Unix()})
		if err != nil {
			t.Fatal(err)
		}
		signingInput := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"EdDSA","kid":"test"}`)) + "." + base64.RawURLEncoding.EncodeToString(claims)
		token := signingInput + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, []byte(signingInput)))
		return metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+token))
	}
	guard, err := assignment.NewAssignmentGuard(assignment.RuntimeAssignment{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, Endpoint: "runtime.example.test:443", AssignmentEpoch: 3, PresentationRevision: 4, IssuedAt: now.Add(-time.Minute), LeaseExpiresAt: expires}, nil)
	if err != nil {
		t.Fatal(err)
	}
	service, _ := newV2LeaseTestService(t, guard)
	service.identities = auth.ContextIdentityResolver{}
	listener := bufconn.Listen(1 << 20)
	server := grpcgo.NewServer(grpcgo.ChainStreamInterceptor(auth.NewBearerStreamServerInterceptor(verifier)))
	realtime.RegisterRealtimeServiceServer(server, service)
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(server.Stop)
	connection, err := grpcgo.NewClient("passthrough:///credential-expiry", grpcgo.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }), grpcgo.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	return nativeCredentialSession{service: service, verifier: verifier, guard: guard, client: realtime.NewRealtimeServiceClient(connection), ctx: credential(expires), expires: expires, credential: credential}
}

func startNativePresenter(t *testing.T, service *V2Service, client realtime.RealtimeServiceClient, ctx context.Context) (grpcgo.BidiStreamingClient[realtime.ControlClientItem, realtime.ControlServerItem], *realtime.ControlConnected, *realtime.ConnectionSnapshotEnvelope, []byte) {
	t.Helper()
	control, err := client.ConnectControl(ctx)
	if err != nil {
		t.Fatal(err)
	}
	capabilities := service.projections.(v2TestProjection).value.Profile.RequiredRuntimeCapabilities
	if err := control.Send(&realtime.ControlClientItem{Item: &realtime.ControlClientItem_Handshake{Handshake: &realtime.ControlHandshake{ProtocolVersion: "v3", ProgressionContractVersion: 2, SupportedCapabilities: capabilities}}}); err != nil {
		t.Fatal(err)
	}
	var connected *realtime.ControlConnected
	var snapshot *realtime.ConnectionSnapshotEnvelope
	var nonce []byte
	for {
		item, err := control.Recv()
		if err != nil {
			t.Fatal(err)
		}
		if value := item.GetConnected(); value != nil {
			connected = value
		}
		if value := item.GetConnectionSnapshot(); value != nil {
			snapshot = value
		}
		if value := item.GetStateConnectionNonce(); value != nil {
			nonce = value.Nonce
		}
		if value := item.GetPresenterInputSynchronization(); value != nil {
			switch value.Phase {
			case realtime.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_REQUIRED:
				if err := control.Send(&realtime.ControlClientItem{Item: &realtime.ControlClientItem_InputSynchronizationAck{InputSynchronizationAck: v3TestAck(value)}}); err != nil {
					t.Fatal(err)
				}
			case realtime.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_READY:
				if connected == nil || snapshot == nil || nonce == nil {
					t.Fatal("missing initial Control messages")
				}
				return control, connected, snapshot, nonce
			}
		}
	}
}

func renewNativeLease(t *testing.T, guard *assignment.AssignmentGuard) {
	t.Helper()
	renewal := guard.Assignment()
	renewal.LeaseExpiresAt = renewal.LeaseExpiresAt.Add(time.Minute)
	if err := guard.Renew(renewal); err != nil {
		t.Fatal(err)
	}
}

func waitForCredentialExpiry(t *testing.T, ctx context.Context, expires time.Time) {
	t.Helper()
	timer := time.NewTimer(time.Until(expires) + 50*time.Millisecond)
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-ctx.Done():
		t.Fatal("client timed out before credential expiry")
	}
}

func TestNativeControlRejectsInputAfterCredentialExpiryDespiteLeaseRenewal(t *testing.T) {
	fixture := nativeCredentialFixture(t)
	service, guard, client, ctx, expires := fixture.service, fixture.guard, fixture.client, fixture.ctx, fixture.expires
	control, connected, _, nonce := startNativePresenter(t, service, client, ctx)
	renewNativeLease(t, guard)
	before := v3TestLogicalCommand(service.runtime, "before-expiry", "next")
	if err := control.Send(&realtime.ControlClientItem{Item: &realtime.ControlClientItem_LogicalInput{LogicalInput: before}}); err != nil {
		t.Fatal(err)
	}
	for {
		item, err := control.Recv()
		if err != nil {
			t.Fatal(err)
		}
		if outcome := item.GetCommandOutcome(); outcome != nil && outcome.ClientEventId == before.ClientEventId {
			if outcome.GetAccepted() == nil {
				t.Fatalf("input before expiry rejected: %v", outcome)
			}
			break
		}
	}
	waitForCredentialExpiry(t, ctx, expires)
	after := v3TestLogicalCommand(service.runtime, "after-expiry", "next")
	_ = control.Send(&realtime.ControlClientItem{Item: &realtime.ControlClientItem_LogicalInput{LogicalInput: after}})
	for {
		item, err := control.Recv()
		if err != nil {
			if ctx.Err() != nil || (status.Code(err) != codes.DeadlineExceeded && status.Code(err) != codes.Unauthenticated) {
				t.Fatalf("credential expiry error: %v", err)
			}
			break
		}
		if outcome := item.GetCommandOutcome(); outcome != nil && outcome.ClientEventId == after.ClientEventId {
			t.Fatalf("input after credential expiry was processed: %v", outcome)
		}
	}
	if err := service.nonces.Consume(connected.ConnectionId, "presenter-1", nonce); err == nil {
		t.Fatal("expired Control retained its State nonce")
	}
	service.mu.Lock()
	remainingControls := len(service.controls)
	service.mu.Unlock()
	if remainingControls != 0 {
		t.Fatal("expired Control was not removed")
	}
	if service.runtime.Snapshot().Clock.GetPaused().GetReason() != realtime.PauseReason_PAUSE_REASON_PRESENTER_DISCONNECTED {
		t.Fatal("Presenter credential expiry did not pause the Runtime")
	}
	newControl, err := client.ConnectControl(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = newControl.Recv()
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("new connection accepted expired credential: %v", err)
	}
}

func TestNativeHandshakeStopsAtCredentialExpiryDespiteLeaseRenewal(t *testing.T) {
	for _, name := range []string{"Control", "State"} {
		t.Run(name, func(t *testing.T) {
			fixture := nativeCredentialFixture(t)
			renewNativeLease(t, fixture.guard)
			var stream interface{ RecvMsg(any) error }
			var err error
			var response any = new(realtime.ControlServerItem)
			if name == "Control" {
				stream, err = fixture.client.ConnectControl(fixture.ctx)
			} else {
				response = new(realtime.StateServerItem)
				stream, err = fixture.client.ConnectState(fixture.ctx)
			}
			if err != nil {
				t.Fatal(err)
			}
			err = stream.RecvMsg(response)
			if fixture.ctx.Err() != nil || status.Code(err) != codes.DeadlineExceeded || time.Now().Before(fixture.expires) {
				t.Fatalf("handshake did not stop at credential expiry: %v", err)
			}
		})
	}
}

func TestNativeStateCredentialExpiryRotatesNonceOnLiveControl(t *testing.T) {
	fixture := nativeCredentialFixture(t)
	longControlContext := fixture.credential(fixture.expires.Add(time.Minute))
	control, connected, snapshot, nonce := startNativePresenter(t, fixture.service, fixture.client, longControlContext)
	renewNativeLease(t, fixture.guard)
	state, err := fixture.client.ConnectState(fixture.ctx)
	if err != nil {
		t.Fatal(err)
	}
	capabilities := fixture.service.projections.(v2TestProjection).value.Profile.RequiredRuntimeCapabilities
	if err := state.Send(&realtime.StateClientItem{Item: &realtime.StateClientItem_Handshake{Handshake: &realtime.StateHandshake{ProtocolVersion: "v3", ProgressionContractVersion: 2, SupportedCapabilities: capabilities, ConnectionId: connected.ConnectionId, StateConnectionNonce: nonce}}}); err != nil {
		t.Fatal(err)
	}
	item, err := state.Recv()
	if err != nil || item.GetConnected() == nil {
		t.Fatalf("State failed before credential expiry: %v", err)
	}
	if err := control.Send(&realtime.ControlClientItem{Item: &realtime.ControlClientItem_StateReady{StateReady: &realtime.StateReady{AppliedReliableSequence: snapshot.ReliableSequence, PresentationOriginVersion: snapshot.Snapshot.RuntimeView.PresentationOrigin.Version}}}); err != nil {
		t.Fatal(err)
	}
	item, err = state.Recv()
	if err != nil || item.GetStateFrame() == nil {
		t.Fatalf("State did not deliver a frame before expiry: %v", err)
	}
	for {
		_, err := state.Recv()
		if err != nil {
			if fixture.ctx.Err() != nil || status.Code(err) != codes.DeadlineExceeded || time.Now().Before(fixture.expires) {
				t.Fatalf("State credential expiry error: %v", err)
			}
			break
		}
	}
	for {
		item, err := control.Recv()
		if err != nil {
			t.Fatalf("Control did not survive State credential expiry: %v", err)
		}
		if fresh := item.GetStateConnectionNonce(); fresh != nil {
			if len(fresh.Nonce) != 32 || string(fresh.Nonce) == string(nonce) {
				t.Fatal("State expiry did not issue a fresh nonce")
			}
			break
		}
	}
}

type blockedCredentialSendStream struct {
	grpcgo.ServerStream
	ctx      context.Context
	input    *realtime.ControlClientItem
	blocked  chan struct{}
	released chan struct{}
}

func (s *blockedCredentialSendStream) Context() context.Context { return s.ctx }
func (s *blockedCredentialSendStream) RecvMsg(message any) error {
	proto.Merge(message.(*realtime.ControlClientItem), s.input)
	return nil
}
func (s *blockedCredentialSendStream) SendMsg(any) error {
	close(s.blocked)
	<-s.ctx.Done()
	close(s.released)
	return s.ctx.Err()
}
func (s *blockedCredentialSendStream) SetTrailer(metadata.MD) {}

func TestControlCredentialExpiryEndsHandlerBeforeBlockedTransportSend(t *testing.T) {
	fixture := nativeCredentialFixture(t)
	renewNativeLease(t, fixture.guard)
	original, cancel := context.WithCancel(fixture.ctx)
	defer cancel()
	credentials, _ := metadata.FromOutgoingContext(fixture.ctx)
	stream := &blockedCredentialSendStream{ctx: metadata.NewIncomingContext(original, credentials), input: &realtime.ControlClientItem{Item: &realtime.ControlClientItem_Handshake{Handshake: &realtime.ControlHandshake{ProtocolVersion: "v3", ProgressionContractVersion: 2, SupportedCapabilities: fixture.service.projections.(v2TestProjection).value.Profile.RequiredRuntimeCapabilities}}}, blocked: make(chan struct{}), released: make(chan struct{})}
	done := make(chan error, 1)
	go func() {
		done <- auth.NewBearerStreamServerInterceptor(fixture.verifier)(nil, stream, nil, func(_ any, wrapped grpcgo.ServerStream) error {
			return fixture.service.ConnectControl(&grpcgo.GenericServerStream[realtime.ControlClientItem, realtime.ControlServerItem]{ServerStream: wrapped})
		})
	}()
	select {
	case <-stream.blocked:
	case <-fixture.ctx.Done():
		t.Fatal("Control did not reach transport SendMsg")
	}
	select {
	case err := <-done:
		if (!errors.Is(err, context.DeadlineExceeded) && status.Code(err) != codes.DeadlineExceeded) || time.Now().Before(fixture.expires) || original.Err() != nil {
			t.Fatalf("handler did not stop at credential expiry independently of transport: %v", err)
		}
	case <-fixture.ctx.Done():
		t.Fatal("blocked transport SendMsg retained the handler past credential expiry")
	}
	// gRPC cancels the original transport context after the interceptor returns.
	cancel()
	select {
	case <-stream.released:
	case <-time.After(time.Second):
		t.Fatal("blocked transport SendMsg was not released")
	}
}
