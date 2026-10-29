package grpc

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
)

type endpointProbe struct{ name string }

func (p endpointProbe) ConnectControl(s grpcgo.BidiStreamingServer[realtime.ControlClientItem, realtime.ControlServerItem]) error {
	return s.Send(&realtime.ControlServerItem{Item: &realtime.ControlServerItem_Connected{Connected: &realtime.ControlConnected{ConnectionId: p.name}}})
}
func (p endpointProbe) ConnectState(s grpcgo.BidiStreamingServer[realtime.StateClientItem, realtime.StateServerItem]) error {
	return s.Send(&realtime.StateServerItem{Item: &realtime.StateServerItem_Connected{Connected: &realtime.StateConnected{ConnectionId: p.name}}})
}
func TestSharedEndpointRoutesNativeAndBrowserSessionsAfterAuthentication(t *testing.T) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	keys := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []any{map[string]any{"kty": "OKP", "crv": "Ed25519", "kid": "test", "alg": "EdDSA", "use": "sig", "key_ops": []string{"verify"}, "x": base64.RawURLEncoding.EncodeToString(public)}}})
	}))
	defer keys.Close()
	verifier, err := auth.NewBearerTokenVerifier(auth.BearerTokenVerifierConfig{Issuer: "router-test", Audience: "runtime", JWKSURL: keys.URL, HTTPClient: keys.Client()})
	if err != nil {
		t.Fatal(err)
	}
	sign := func(id string) string {
		payload, _ := json.Marshal(map[string]any{"iss": "router-test", "aud": "runtime", "sub": "viewer-1", "session_id": id, "runtime_id": "host-1", "runtime_kind": "Cloud", "presentation_id": "presentation-1", "role": "viewer", "assignment_epoch": 1, "presentation_revision": 1, "protocol_version": 3, "exp": time.Now().Add(time.Hour).Unix(), "nbf": time.Now().Add(-time.Hour).Unix(), "scope": "realtime:connect"})
		head := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"EdDSA","kid":"test"}`)) + "." + base64.RawURLEncoding.EncodeToString(payload)
		return head + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, []byte(head)))
	}
	router := NewSessionRouter()
	router.Register("session-a", endpointProbe{"a"})
	router.Register("session-b", endpointProbe{"b"})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(listener, Dependencies{Verifier: verifier, Sessions: router, BrowserOrigins: []string{"https://audience.example"}})
	if err != nil {
		t.Fatal(err)
	}
	if err = server.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
	connection, err := grpcgo.NewClient(listener.Addr().String(), grpcgo.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = connection.Close() }()
	client := realtime.NewRealtimeServiceClient(connection)
	for _, tc := range []struct{ id, name string }{{"session-a", "a"}, {"session-b", "b"}} {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		credential := sign(tc.id)
		native := metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+credential)
		control, err := client.ConnectControl(native)
		if err != nil {
			t.Fatal(err)
		}
		item, err := control.Recv()
		if err != nil || item.GetConnected().GetConnectionId() != tc.name {
			t.Fatalf("native %s: %v %v", tc.id, item, err)
		}
		state, err := client.ConnectState(native)
		if err != nil {
			t.Fatal(err)
		}
		stateItem, err := state.Recv()
		if err != nil || stateItem.GetConnected().GetConnectionId() != tc.name {
			t.Fatalf("native state %s: %v %v", tc.id, stateItem, err)
		}
		for _, path := range []string{"control", "state"} {
			socket, _, err := websocket.Dial(ctx, "ws://"+listener.Addr().String()+"/browser/"+path, &websocket.DialOptions{Subprotocols: []string{browserSubprotocol}, HTTPHeader: http.Header{"Origin": []string{"https://audience.example"}}})
			if err != nil {
				t.Fatal(err)
			}
			payload, _ := json.Marshal(map[string]string{"credential": credential})
			if err = socket.Write(ctx, websocket.MessageText, payload); err != nil {
				t.Fatal(err)
			}
			_, payload, err = socket.Read(ctx)
			if err != nil {
				t.Fatal(err)
			}
			name := ""
			if path == "control" {
				value := new(realtime.ControlServerItem)
				err = proto.Unmarshal(payload, value)
				name = value.GetConnected().GetConnectionId()
			} else {
				value := new(realtime.StateServerItem)
				err = proto.Unmarshal(payload, value)
				name = value.GetConnected().GetConnectionId()
			}
			_ = socket.CloseNow()
			if err != nil || name != tc.name {
				t.Fatalf("browser %s %s: name=%s err=%v", tc.id, path, name, err)
			}
		}
		cancel()
	}
}
