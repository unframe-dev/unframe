package grpc

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	deliveryv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/delivery"
	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	persistencehttp "github.com/unframe-dev/unframe/app/server/realtime/internal/persistence/http"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/runtimecore"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	healthv1 "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/protobuf/proto"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestBrowserRejectsMissingOriginAndDisabledRoutes(t *testing.T) {
	for _, origins := range [][]string{nil, {"https://audience.example"}} {
		server := httptest.NewServer(newBrowserHandler(context.Background(), nil, nil, origins))
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		conn, response, err := websocket.Dial(ctx, "ws"+server.URL[4:]+"/browser/control", &websocket.DialOptions{Subprotocols: []string{browserSubprotocol}})
		if conn != nil {
			_ = conn.CloseNow()
		}
		cancel()
		server.Close()
		if err == nil || response == nil || response.StatusCode != 403 {
			t.Fatalf("origin should fail closed: response=%v err=%v", response, err)
		}
	}
}

func browserFixture(t *testing.T, lease ...time.Duration) (string, func(string, time.Time) string, *V2Service) {
	address, sign, service, _ := browserServerFixture(t, lease...)
	return address, sign, service
}

func browserServerFixture(t *testing.T, lease ...time.Duration) (string, func(string, time.Time) string, *V2Service, *Server) {
	t.Helper()
	definition := json.RawMessage(`{"schemaVersion":3,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"cue-next","priority":1,"order":0,"trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"next"},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	runtime, err := runtimecore.NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	publication := persistencehttp.BootstrapPublication{PresentationID: "presentation-1", PublicationEpoch: 2, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
	bootstrap := persistencehttp.RuntimeBootstrap{Assignment: persistencehttp.BootstrapAssignment{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 3, PresentationRevision: 4}, Publication: publication, Definition: definition}
	profile := &deliveryv2.ProjectionProfileDescriptor{ProjectionProfileId: "profile-1", Key: &deliveryv2.ProjectionProfileKey{Publication: &presentationv2.PublicationFence{PresentationId: publication.PresentationID, PublicationEpoch: publication.PublicationEpoch, PublicationManifestHash: publication.PublicationManifestHash}, ProjectionContractVersion: 2, Role: presentationv2.SessionRole_SESSION_ROLE_VIEWER, CapabilityProfileId: "capability-1"}, RequiredRuntimeCapabilities: []presentationv2.RuntimeCapability{presentationv2.RuntimeCapability_RUNTIME_CAPABILITY_RUNTIME_TRANSPORT, presentationv2.RuntimeCapability_RUNTIME_CAPABILITY_INPUT_SYNCHRONIZATION, presentationv2.RuntimeCapability_RUNTIME_CAPABILITY_FROZEN_ANCHORS, presentationv2.RuntimeCapability_RUNTIME_CAPABILITY_STEP_RESTORE}, RuntimeCatalog: &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 3}}
	service, err := NewV2Service(runtime, bootstrap, v2TestProjection{persistencehttp.RuntimeProjection{Role: "viewer", Profile: profile}}, auth.ContextIdentityResolver{}, allowAllAssignment{})
	if err != nil {
		t.Fatal(err)
	}

	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	keys := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []any{map[string]any{"kty": "OKP", "crv": "Ed25519", "kid": "test", "alg": "EdDSA", "use": "sig", "key_ops": []string{"verify"}, "x": base64.RawURLEncoding.EncodeToString(public)}}})
	}))
	t.Cleanup(keys.Close)
	verifier, err := auth.NewBearerTokenVerifier(auth.BearerTokenVerifierConfig{Issuer: "browser-test", Audience: "runtime", JWKSURL: keys.URL, HTTPClient: keys.Client()})
	if err != nil {
		t.Fatal(err)
	}
	sign := func(role string, expires time.Time) string {
		claims := map[string]any{"iss": "browser-test", "aud": "runtime", "sub": "viewer-1", "session_id": "session-1", "runtime_id": "runtime-1", "runtime_kind": "Cloud", "presentation_id": "presentation-1", "role": role, "assignment_epoch": 3, "presentation_revision": 4, "protocol_version": 3, "exp": expires.Unix(), "nbf": time.Now().Add(-time.Hour).Unix(), "scope": "realtime:connect"}
		payload, _ := json.Marshal(claims)
		head := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"EdDSA","kid":"test"}`)) + "." + base64.RawURLEncoding.EncodeToString(payload)
		return head + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, []byte(head)))
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	leaseDuration := time.Hour
	if len(lease) > 0 {
		leaseDuration = lease[0]
	}
	guard, err := assignment.NewAssignmentGuard(assignment.RuntimeAssignment{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, Endpoint: "runtime.example:443", AssignmentEpoch: 3, PresentationRevision: 4, IssuedAt: time.Now().Add(-time.Hour), LeaseExpiresAt: time.Now().Add(leaseDuration)}, nil)
	if err != nil {
		t.Fatal(err)
	}
	service.assignments = guard
	server, err := NewServer(listener, Dependencies{Verifier: verifier, Guard: guard, V2: service, BrowserOrigins: []string{"https://audience.example"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := server.Start(); err != nil {
		t.Fatal(err)
	}
	server.SetApplicationReady(true)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			t.Error(err)
		}
	})
	return listener.Addr().String(), sign, service, server
}
func browserDial(t *testing.T, ctx context.Context, address, path string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.Dial(ctx, "ws://"+address+path, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"https://audience.example"}}, Subprotocols: []string{browserSubprotocol}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	return conn
}
func browserWrite(t *testing.T, ctx context.Context, conn *websocket.Conn, message proto.Message) {
	t.Helper()
	payload, err := proto.Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	if err = conn.Write(ctx, websocket.MessageBinary, payload); err != nil {
		t.Fatal(err)
	}
}
func browserRead(t *testing.T, ctx context.Context, conn *websocket.Conn, message proto.Message) {
	t.Helper()
	kind, payload, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if kind != websocket.MessageBinary {
		t.Fatal("expected protobuf binary")
	}
	if err = proto.Unmarshal(payload, message); err != nil {
		t.Fatal(err)
	}
}
func browserAuthenticate(t *testing.T, ctx context.Context, conn *websocket.Conn, token string) {
	t.Helper()
	payload, _ := json.Marshal(map[string]string{"credential": token})
	if err := conn.Write(ctx, websocket.MessageText, payload); err != nil {
		t.Fatal(err)
	}
}

func TestBrowserAuthenticationAndMessageOrder(t *testing.T) {
	address, sign, _ := browserFixture(t)
	for _, test := range []struct {
		name, token string
		kind        websocket.MessageType
		payload     []byte
	}{
		{"invalid", "", websocket.MessageText, []byte(`{"credential":"secret-invalid"}`)},
		{"expired", sign("viewer", time.Now().Add(-time.Minute)), websocket.MessageText, nil},
		{"presenter", sign("presenter", time.Now().Add(time.Hour)), websocket.MessageText, nil},
		{"binary first", "", websocket.MessageBinary, []byte{1}},
		{"oversized first", "", websocket.MessageText, []byte(strings.Repeat("x", (16<<10)+1))},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			conn := browserDial(t, ctx, address, "/browser/control")
			if test.token != "" {
				browserAuthenticate(t, ctx, conn, test.token)
			} else {
				_ = conn.Write(ctx, test.kind, test.payload)
			}
			_, _, err := conn.Read(ctx)
			if err == nil {
				t.Fatal("invalid authentication accepted")
			}
			if strings.Contains(err.Error(), "secret-invalid") {
				t.Fatal("credential leaked")
			}
		})
	}
}

func TestBrowserLiveControlStateAndNativeGRPC(t *testing.T) {
	address, sign, service := browserFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	native, err := grpcgo.NewClient(address, grpcgo.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = native.Close() }()
	if health, err := healthv1.NewHealthClient(native).Check(ctx, &healthv1.HealthCheckRequest{}); err != nil || health.Status != healthv1.HealthCheckResponse_SERVING {
		t.Fatalf("native grpc health: %v %v", health, err)
	}
	control := browserDial(t, ctx, address, "/browser/control")
	token := sign("viewer", time.Now().Add(time.Hour))
	browserAuthenticate(t, ctx, control, token)
	caps := service.projections.(v2TestProjection).value.Profile.RequiredRuntimeCapabilities
	browserWrite(t, ctx, control, &realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_Handshake{Handshake: &realtimev2.ControlHandshake{ProtocolVersion: "v3", ProgressionContractVersion: 2, SupportedCapabilities: caps}}})
	connected, snapshot, nonce := new(realtimev2.ControlServerItem), new(realtimev2.ControlServerItem), new(realtimev2.ControlServerItem)
	browserRead(t, ctx, control, connected)
	browserRead(t, ctx, control, snapshot)
	browserRead(t, ctx, control, nonce)
	if connected.GetConnected() == nil || snapshot.GetConnectionSnapshot() == nil || len(nonce.GetStateConnectionNonce().GetNonce()) != 32 {
		t.Fatal("missing initial control messages")
	}
	state := browserDial(t, ctx, address, "/browser/state")
	browserAuthenticate(t, ctx, state, token)
	browserWrite(t, ctx, state, &realtimev2.StateClientItem{Item: &realtimev2.StateClientItem_Handshake{Handshake: &realtimev2.StateHandshake{ProtocolVersion: "v3", ProgressionContractVersion: 2, SupportedCapabilities: caps, ConnectionId: connected.GetConnected().ConnectionId, StateConnectionNonce: nonce.GetStateConnectionNonce().Nonce}}})
	stateConnected := new(realtimev2.StateServerItem)
	browserRead(t, ctx, state, stateConnected)
	if stateConnected.GetConnected() == nil {
		t.Fatal("state not connected")
	}
	cut := snapshot.GetConnectionSnapshot()
	browserWrite(t, ctx, control, &realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_StateReady{StateReady: &realtimev2.StateReady{AppliedReliableSequence: cut.ReliableSequence, PresentationOriginVersion: cut.Snapshot.RuntimeView.PresentationOrigin.Version}}})
	keyframe := new(realtimev2.StateServerItem)
	browserRead(t, ctx, state, keyframe)
	if keyframe.GetStateFrame().GetKind() != realtimev2.StateFrameKind_STATE_FRAME_KIND_KEYFRAME {
		t.Fatal("state keyframe missing")
	}
	// Viewer authority is checked by the shared Runtime service after authentication.
	browserWrite(t, ctx, control, &realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_LogicalInput{LogicalInput: v3TestLogicalCommand(service.runtime, "viewer-input", "next")}})
	for {
		_, _, err := control.Read(ctx)
		if err != nil {
			if ctx.Err() != nil {
				t.Fatal("viewer command did not close control")
			}
			break
		}
	}
	_, _, err = state.Read(ctx)
	if err == nil {
		t.Fatal("state survived control disconnect")
	}
}

func browserStartControl(t *testing.T, ctx context.Context, address, token string, service *V2Service, resume *realtimev2.ResumeCursor) (*websocket.Conn, *realtimev2.ControlServerItem, *realtimev2.ControlServerItem, *realtimev2.ControlServerItem) {
	t.Helper()
	conn := browserDial(t, ctx, address, "/browser/control")
	browserAuthenticate(t, ctx, conn, token)
	browserWrite(t, ctx, conn, &realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_Handshake{Handshake: &realtimev2.ControlHandshake{ProtocolVersion: "v3", ProgressionContractVersion: 2, SupportedCapabilities: service.projections.(v2TestProjection).value.Profile.RequiredRuntimeCapabilities, Resume: resume}}})
	connected, cut, nonce := new(realtimev2.ControlServerItem), new(realtimev2.ControlServerItem), new(realtimev2.ControlServerItem)
	browserRead(t, ctx, conn, connected)
	if connected.GetConnected() == nil {
		t.Fatal("missing connected")
	}
	if resume == nil {
		browserRead(t, ctx, conn, cut)
	}
	for {
		browserRead(t, ctx, conn, nonce)
		if nonce.GetStateConnectionNonce() != nil {
			break
		}
		if nonce.GetResyncRequired() != nil {
			t.Fatal("unexpected resync")
		}
	}
	return conn, connected, cut, nonce
}
func browserStartState(t *testing.T, ctx context.Context, address, token string, service *V2Service, connectionID string, nonce []byte) *websocket.Conn {
	t.Helper()
	state := browserDial(t, ctx, address, "/browser/state")
	browserAuthenticate(t, ctx, state, token)
	browserWrite(t, ctx, state, &realtimev2.StateClientItem{Item: &realtimev2.StateClientItem_Handshake{Handshake: &realtimev2.StateHandshake{ProtocolVersion: "v3", ProgressionContractVersion: 2, SupportedCapabilities: service.projections.(v2TestProjection).value.Profile.RequiredRuntimeCapabilities, ConnectionId: connectionID, StateConnectionNonce: nonce}}})
	return state
}
func TestBrowserStateNonceRotationAndControlResume(t *testing.T) {
	address, sign, service := browserFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	token := sign("viewer", time.Now().Add(time.Hour))
	control, connected, cut, nonce := browserStartControl(t, ctx, address, token, service, nil)
	id := connected.GetConnected().ConnectionId
	state := browserStartState(t, ctx, address, token, service, id, nonce.GetStateConnectionNonce().Nonce)
	browserRead(t, ctx, state, new(realtimev2.StateServerItem))
	_ = state.Close(websocket.StatusNormalClosure, "")
	fresh := new(realtimev2.ControlServerItem)
	browserRead(t, ctx, control, fresh)
	if fresh.GetStateConnectionNonce() == nil {
		t.Fatal("state disconnect did not rotate nonce")
	}
	stale := browserStartState(t, ctx, address, token, service, id, nonce.GetStateConnectionNonce().Nonce)
	if _, _, err := stale.Read(ctx); err == nil {
		t.Fatal("reused state nonce accepted")
	}
	replacement := browserStartState(t, ctx, address, token, service, id, fresh.GetStateConnectionNonce().Nonce)
	attached := new(realtimev2.StateServerItem)
	browserRead(t, ctx, replacement, attached)
	if attached.GetConnected() == nil {
		t.Fatal("replacement state failed")
	}
	_ = control.Close(websocket.StatusNormalClosure, "")
	if _, _, err := replacement.Read(ctx); err == nil {
		t.Fatal("state survived control disconnect")
	}
	snapshot := cut.GetConnectionSnapshot()
	resumed, next, _, _ := browserStartControl(t, ctx, address, token, service, &realtimev2.ResumeCursor{PriorConnectionId: id, Fence: snapshot.Fence, AppliedReliableSequence: snapshot.ReliableSequence})
	if next.GetConnected().ConnectionId == id {
		t.Fatal("resume reused connection id")
	}
	_ = resumed.Close(websocket.StatusNormalClosure, "")
}
func TestBrowserLeaseExpiryClosesLiveControl(t *testing.T) {
	address, sign, service := browserFixture(t, 150*time.Millisecond)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	control, _, _, _ := browserStartControl(t, ctx, address, sign("viewer", time.Now().Add(time.Hour)), service, nil)
	for {
		if _, _, err := control.Read(ctx); err != nil {
			if ctx.Err() != nil {
				t.Fatal("control survived assignment lease")
			}
			break
		}
	}
}
func TestBrowserAuthenticationTimeout(t *testing.T) {
	address, _, _ := browserFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
	defer cancel()
	conn := browserDial(t, ctx, address, "/browser/control")
	started := time.Now()
	if _, _, err := conn.Read(ctx); err == nil || ctx.Err() != nil {
		t.Fatalf("authentication timeout: %v", err)
	}
	if time.Since(started) < 4*time.Second {
		t.Fatal("authentication closed before timeout")
	}
}
func TestBrowserRejectsTextAndOversizedBinaryAfterAuthentication(t *testing.T) {
	address, sign, _ := browserFixture(t)
	for _, test := range []struct {
		name    string
		kind    websocket.MessageType
		payload []byte
	}{{"text", websocket.MessageText, []byte(`{}`)}, {"oversized binary", websocket.MessageBinary, make([]byte, (1<<20)+1)}} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			conn := browserDial(t, ctx, address, "/browser/control")
			browserAuthenticate(t, ctx, conn, sign("viewer", time.Now().Add(time.Hour)))
			_ = conn.Write(ctx, test.kind, test.payload)
			if _, _, err := conn.Read(ctx); err == nil || ctx.Err() != nil {
				t.Fatalf("invalid protocol message: %v", err)
			}
		})
	}
}

func TestBrowserCredentialExpiryClosesWithoutLeaseExpiry(t *testing.T) {
	address, sign, service := browserFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	expires := time.Now().Add(2 * time.Second).Truncate(time.Second)
	control, _, _, _ := browserStartControl(t, ctx, address, sign("viewer", expires), service, nil)
	for {
		if _, _, err := control.Read(ctx); err != nil {
			if ctx.Err() != nil {
				t.Fatal("control survived credential expiry")
			}
			if time.Now().Before(expires) {
				t.Fatal("control closed before credential expiry")
			}
			break
		}
	}
}

func TestBrowserShutdownCleansViewerAndKeepsNativeDrainDeadline(t *testing.T) {
	address, sign, service, server := browserServerFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	control, _, _, _ := browserStartControl(t, ctx, address, sign("viewer", time.Now().Add(time.Hour)), service, nil)
	native, err := grpcgo.NewClient(address, grpcgo.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = native.Close() }()
	watch, err := healthv1.NewHealthClient(native).Watch(ctx, &healthv1.HealthCheckRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = watch.Recv(); err != nil {
		t.Fatal(err)
	}
	stopCtx, stopCancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer stopCancel()
	if err := server.Shutdown(stopCtx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("active native stream should drain until deadline: %v", err)
	}
	if _, _, err := control.Read(ctx); err == nil {
		t.Fatal("browser survived shutdown")
	}
	service.mu.Lock()
	remaining := len(service.controls)
	service.mu.Unlock()
	if remaining != 0 {
		t.Fatalf("shutdown left %d controls active", remaining)
	}
}

func TestBrowserStateCredentialExpiryRotatesNonceOnLiveControl(t *testing.T) {
	address, sign, service := browserFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	control, connected, _, nonce := browserStartControl(t, ctx, address, sign("viewer", time.Now().Add(time.Hour)), service, nil)
	expires := time.Now().Add(2 * time.Second).Truncate(time.Second)
	state := browserStartState(t, ctx, address, sign("viewer", expires), service, connected.GetConnected().ConnectionId, nonce.GetStateConnectionNonce().Nonce)
	browserRead(t, ctx, state, new(realtimev2.StateServerItem))
	if _, _, err := state.Read(ctx); err == nil || ctx.Err() != nil {
		t.Fatalf("state survived credential expiry: %v", err)
	}
	rotated := new(realtimev2.ControlServerItem)
	browserRead(t, ctx, control, rotated)
	if rotated.GetStateConnectionNonce() == nil {
		t.Fatal("state expiry did not issue replacement nonce")
	}
}
