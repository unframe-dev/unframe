package grpc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"slices"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	protocol "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
)

const browserSubprotocol = "unframe.realtime.v3"

type browserHandler struct {
	handler http.Handler
	mu      sync.Mutex
	active  sync.WaitGroup
	closing bool
}

func (h *browserHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	if h.closing {
		h.mu.Unlock()
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
		return
	}
	h.active.Add(1)
	h.mu.Unlock()
	defer h.active.Done()
	h.handler.ServeHTTP(w, r)
}

func (h *browserHandler) stop() <-chan struct{} {
	h.mu.Lock()
	h.closing = true
	h.mu.Unlock()
	done := make(chan struct{})
	go func() { h.active.Wait(); close(done) }()
	return done
}

func newBrowserHandler(lifetime context.Context, verifier *auth.BearerTokenVerifier, service *V2Service, origins []string) *browserHandler {
	return &browserHandler{handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/browser/control" && r.URL.Path != "/browser/state" {
			http.NotFound(w, r)
			return
		}
		// Origin is mandatory even for same-host clients; credentials belong only in the first message.
		if !slices.Contains(origins, r.Header.Get("Origin")) || r.Header.Get("Origin") == "" || r.URL.RawQuery != "" || r.Header.Get("Authorization") != "" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if r.Header.Get("Sec-WebSocket-Protocol") != browserSubprotocol {
			http.Error(w, "unsupported protocol", http.StatusBadRequest)
			return
		}
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{browserSubprotocol}, InsecureSkipVerify: true})
		if err != nil {
			return
		}
		defer func() { _ = conn.CloseNow() }()
		ctx, cancel := context.WithCancel(lifetime)
		defer cancel()
		// Canceling the service context must interrupt any blocked socket operation.
		stop := context.AfterFunc(ctx, func() { _ = conn.CloseNow() })
		defer stop()
		conn.SetReadLimit(16 << 10)
		authCtx, authCancel := context.WithTimeout(ctx, 5*time.Second)
		kind, payload, err := conn.Read(authCtx)
		var credential struct {
			Credential string `json:"credential"`
		}
		decoder := json.NewDecoder(bytes.NewReader(payload))
		decoder.DisallowUnknownFields()
		validJSON := decoder.Decode(&credential) == nil && decoder.Decode(new(any)) == io.EOF
		if err != nil || kind != websocket.MessageText || !validJSON || credential.Credential == "" || verifier == nil {
			authCancel()
			_ = conn.Close(websocket.StatusPolicyViolation, "realtime connection closed")
			return
		}
		verified, err := verifier.VerifyCredential(authCtx, credential.Credential, "realtime:connect")
		identity := verified.Identity
		authCancel()
		if err != nil || identity.Role != session.RoleViewer || identity.ProtocolVersion != 3 || service == nil {
			_ = conn.Close(websocket.StatusPolicyViolation, "realtime connection closed")
			return
		}
		connectionCtx, connectionCancel := context.WithDeadline(ctx, verified.ExpiresAt)
		defer connectionCancel()
		stopExpiry := context.AfterFunc(connectionCtx, func() { _ = conn.CloseNow() })
		defer stopExpiry()
		ctx = auth.ContextWithIdentity(connectionCtx, identity)
		var result error
		if r.URL.Path == "/browser/control" {
			conn.SetReadLimit(protocol.MaximumControlItemBytes)
			stream := &browserStream[realtime.ControlClientItem, realtime.ControlServerItem]{ctx: ctx, conn: conn, newInput: func() *realtime.ControlClientItem { return new(realtime.ControlClientItem) }}
			result = service.ConnectControl(stream)
		} else {
			conn.SetReadLimit(protocol.MaximumStateItemBytes)
			stream := &browserStream[realtime.StateClientItem, realtime.StateServerItem]{ctx: ctx, conn: conn, newInput: func() *realtime.StateClientItem { return new(realtime.StateClientItem) }}
			result = service.ConnectState(stream)
		}
		code := websocket.StatusNormalClosure
		if result != nil {
			code = websocket.StatusPolicyViolation
		}
		_ = conn.Close(code, "realtime connection closed")
	})}
}

// browserStream adapts message framing only. Authentication and the complete
// Runtime protocol remain owned by the same service used by native gRPC.
type browserStream[I, O any] struct {
	ctx      context.Context
	conn     *websocket.Conn
	newInput func() *I
}

func (s *browserStream[I, O]) Context() context.Context { return s.ctx }
func (s *browserStream[I, O]) Send(value *O) error      { return s.SendMsg(value) }
func (s *browserStream[I, O]) Recv() (*I, error) {
	value := s.newInput()
	if err := s.RecvMsg(value); err != nil {
		return nil, err
	}
	return value, nil
}
func (s *browserStream[I, O]) SendMsg(value any) error {
	message, ok := value.(proto.Message)
	if !ok {
		return errors.New("invalid message")
	}
	payload, err := proto.Marshal(message)
	if err != nil {
		return err
	}
	return s.conn.Write(s.ctx, websocket.MessageBinary, payload)
}
func (s *browserStream[I, O]) RecvMsg(value any) error {
	kind, payload, err := s.conn.Read(s.ctx)
	if err != nil {
		return err
	}
	if kind != websocket.MessageBinary {
		return errors.New("binary message required")
	}
	message, ok := value.(proto.Message)
	if !ok {
		return errors.New("invalid message")
	}
	return proto.Unmarshal(payload, message)
}
func (s *browserStream[I, O]) SetHeader(metadata.MD) error  { return nil }
func (s *browserStream[I, O]) SendHeader(metadata.MD) error { return nil }
func (s *browserStream[I, O]) SetTrailer(metadata.MD)       {}
