package http

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	stdhttp "net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
)

func TestClientSendsFencedCheckpointAndOpaquePayload(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(stdhttp.HandlerFunc(func(response stdhttp.ResponseWriter, request *stdhttp.Request) {
		if request.Method != stdhttp.MethodPost || request.URL.Path != "/callbacks/checkpoints" {
			t.Errorf("request = %s %s, want POST /callbacks/checkpoints", request.Method, request.URL.Path)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer service-secret" {
			t.Errorf("Authorization = %q, want service identity", got)
		}
		var received Checkpoint
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if !reflect.DeepEqual(received, checkpointFixture()) {
			t.Errorf("checkpoint = %#v, want %#v", received, checkpointFixture())
		}
		_, _ = response.Write([]byte(`{"applied":true}`))
	}))
	defer server.Close()

	result, err := NewClient(Config{BaseURL: server.URL, ServiceIdentity: "service-secret", AllowInsecureLoopback: true}).Checkpoint(context.Background(), checkpointFixture())
	if err != nil {
		t.Fatalf("checkpoint: %v", err)
	}
	if !result.Applied {
		t.Error("result.Applied = false, want true")
	}
}

func TestClientSendsFencedCompletionAndOpaquePayload(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(stdhttp.HandlerFunc(func(response stdhttp.ResponseWriter, request *stdhttp.Request) {
		if request.Method != stdhttp.MethodPost || request.URL.Path != "/callbacks/completions" {
			t.Errorf("request = %s %s, want POST /callbacks/completions", request.Method, request.URL.Path)
		}
		var received Completion
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if !reflect.DeepEqual(received, completionFixture()) {
			t.Errorf("completion = %#v, want %#v", received, completionFixture())
		}
		_, _ = response.Write([]byte(`{"applied":true}`))
	}))
	defer server.Close()

	_, err := NewClient(Config{BaseURL: server.URL, ServiceIdentity: "service-secret", AllowInsecureLoopback: true}).Complete(context.Background(), completionFixture())
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
}

func TestClientRejectsInvalidCallbackBeforeRequest(t *testing.T) {
	t.Parallel()

	var requests atomic.Int32
	client := NewClient(Config{
		BaseURL:         "https://control-plane.example.test",
		ServiceIdentity: "service-secret",
		HTTPClient: &stdhttp.Client{Transport: roundTripperFunc(func(*stdhttp.Request) (*stdhttp.Response, error) {
			requests.Add(1)
			return nil, errors.New("must not send")
		})},
	})

	tests := []struct {
		name  string
		value Checkpoint
	}{
		{name: "empty session", value: Checkpoint{RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 1, PresentationRevision: 1, Payload: json.RawMessage(`{}`)}},
		{name: "empty runtime ID", value: Checkpoint{SessionID: "session-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 1, PresentationRevision: 1, Payload: json.RawMessage(`{}`)}},
		{name: "invalid runtime kind", value: Checkpoint{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKind("unknown"), AssignmentEpoch: 1, PresentationRevision: 1, Payload: json.RawMessage(`{}`)}},
		{name: "empty epoch", value: Checkpoint{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, PresentationRevision: 1, Payload: json.RawMessage(`{}`)}},
		{name: "empty revision", value: Checkpoint{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 1, Payload: json.RawMessage(`{}`)}},
		{name: "invalid payload", value: Checkpoint{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 1, PresentationRevision: 1, Payload: json.RawMessage(`{`)}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := client.Checkpoint(context.Background(), test.value); !errors.Is(err, ErrInvalidCallback) {
				t.Errorf("Checkpoint() error = %v, want ErrInvalidCallback", err)
			}
		})
	}
	invalidCheckpoint := checkpointFixture()
	invalidCheckpoint.IdempotencyKey = ""
	if _, err := client.Checkpoint(context.Background(), invalidCheckpoint); !errors.Is(err, ErrInvalidCallback) {
		t.Errorf("Checkpoint() error = %v, want ErrInvalidCallback", err)
	}
	invalidCheckpoint = checkpointFixture()
	invalidCheckpoint.IdempotencyKey = strings.Repeat("x", 201)
	if _, err := client.Checkpoint(context.Background(), invalidCheckpoint); !errors.Is(err, ErrInvalidCallback) {
		t.Errorf("Checkpoint() error = %v, want ErrInvalidCallback", err)
	}
	invalidCheckpoint = checkpointFixture()
	invalidCheckpoint.Payload = json.RawMessage(`{`)
	if _, err := client.Checkpoint(context.Background(), invalidCheckpoint); !errors.Is(err, ErrInvalidCallback) {
		t.Errorf("Checkpoint() error = %v, want ErrInvalidCallback", err)
	}
	invalidCompletion := completionFixture()
	invalidCompletion.FinalCheckpoint = json.RawMessage(`{`)
	if _, err := client.Complete(context.Background(), invalidCompletion); !errors.Is(err, ErrInvalidCallback) {
		t.Errorf("Complete() error = %v, want ErrInvalidCallback", err)
	}
	if got := requests.Load(); got != 0 {
		t.Errorf("requests = %d, want 0", got)
	}
}

func TestClientRejectsInvalidCompletionBeforeRequest(t *testing.T) {
	t.Parallel()

	var requests atomic.Int32
	client := NewClient(Config{
		BaseURL:         "https://control-plane.example.test",
		ServiceIdentity: "service-secret",
		HTTPClient: &stdhttp.Client{Transport: roundTripperFunc(func(*stdhttp.Request) (*stdhttp.Response, error) {
			requests.Add(1)
			return nil, errors.New("must not send")
		})},
	})
	tests := []struct {
		name   string
		mutate func(*Completion)
	}{
		{name: "empty idempotency key", mutate: func(value *Completion) { value.IdempotencyKey = "" }},
		{name: "end before start", mutate: func(value *Completion) { value.EndedAt = "2026-08-21T11:59:59Z" }},
		{name: "participant count mismatch", mutate: func(value *Completion) { value.ParticipantCount = 2 }},
		{name: "no participants", mutate: func(value *Completion) { value.ParticipantCount = 0; value.Participants = nil }},
		{name: "too many participants", mutate: func(value *Completion) { value.ParticipantCount = 51; value.Participants = make([]Participant, 51) }},
		{name: "invalid participant role", mutate: func(value *Completion) { value.Participants[0].Role = "operator" }},
		{name: "invalid final checkpoint", mutate: func(value *Completion) { value.FinalCheckpoint = json.RawMessage(`{`) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			value := completionFixture()
			test.mutate(&value)
			if _, err := client.Complete(context.Background(), value); !errors.Is(err, ErrInvalidCallback) {
				t.Errorf("Complete() error = %v, want ErrInvalidCallback", err)
			}
		})
	}
	if got := requests.Load(); got != 0 {
		t.Errorf("requests = %d, want 0", got)
	}
}

func TestClientRequiresHTTPSExceptLoopbackTestOverride(t *testing.T) {
	t.Parallel()

	respond := &stdhttp.Client{Transport: roundTripperFunc(func(*stdhttp.Request) (*stdhttp.Response, error) {
		return &stdhttp.Response{StatusCode: stdhttp.StatusOK, Body: io.NopCloser(strings.NewReader(`{"applied":true}`)), Header: make(stdhttp.Header)}, nil
	})}
	for name, config := range map[string]Config{
		"HTTP by default":       {BaseURL: "http://127.0.0.1", ServiceIdentity: "service-secret"},
		"non-loopback override": {BaseURL: "http://control-plane.example.test", ServiceIdentity: "service-secret", AllowInsecureLoopback: true},
		"URL credentials":       {BaseURL: "https://user:password@control-plane.example.test", ServiceIdentity: "service-secret", HTTPClient: respond},
		"invalid bearer value":  {BaseURL: "https://control-plane.example.test", ServiceIdentity: "invalid\nidentity", HTTPClient: respond},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := NewClient(config).Checkpoint(context.Background(), checkpointFixture()); !errors.Is(err, ErrInvalidConfig) {
				t.Errorf("Checkpoint() error = %v, want ErrInvalidConfig", err)
			}
		})
	}
}

func TestClientRejectsRedirectsBeforeResendingServiceIdentity(t *testing.T) {
	t.Parallel()

	var redirectedRequests atomic.Int32
	redirectTarget := httptest.NewServer(stdhttp.HandlerFunc(func(response stdhttp.ResponseWriter, request *stdhttp.Request) {
		redirectedRequests.Add(1)
		if got := request.Header.Get("Authorization"); got != "" {
			t.Errorf("redirected Authorization = %q, want empty", got)
		}
		_, _ = response.Write([]byte(`{"applied":true}`))
	}))
	defer redirectTarget.Close()
	origin := httptest.NewTLSServer(stdhttp.HandlerFunc(func(response stdhttp.ResponseWriter, request *stdhttp.Request) {
		stdhttp.Redirect(response, request, redirectTarget.URL, stdhttp.StatusTemporaryRedirect)
	}))
	defer origin.Close()

	_, err := NewClient(Config{
		BaseURL:         origin.URL,
		ServiceIdentity: "service-secret",
		HTTPClient:      origin.Client(),
		MaxAttempts:     1,
	}).Checkpoint(context.Background(), checkpointFixture())
	var responseError *ResponseError
	if !errors.As(err, &responseError) || responseError.StatusCode != stdhttp.StatusTemporaryRedirect {
		t.Fatalf("Checkpoint() error = %v, want 307 ResponseError", err)
	}
	if got := redirectedRequests.Load(); got != 0 {
		t.Errorf("redirected requests = %d, want 0", got)
	}
}

func TestClientRetriesOnlyTransientFailures(t *testing.T) {
	t.Parallel()

	var requests atomic.Int32
	server := httptest.NewServer(stdhttp.HandlerFunc(func(response stdhttp.ResponseWriter, _ *stdhttp.Request) {
		if requests.Add(1) < 3 {
			response.WriteHeader(stdhttp.StatusTooManyRequests)
			return
		}
		_, _ = response.Write([]byte(`{"applied":true}`))
	}))
	defer server.Close()

	client := NewClient(Config{BaseURL: server.URL, ServiceIdentity: "service-secret", AllowInsecureLoopback: true, MaxAttempts: 3, RetryDelay: func(int) time.Duration { return 0 }})
	if _, err := client.Checkpoint(context.Background(), checkpointFixture()); err != nil {
		t.Fatalf("checkpoint after 429 retries: %v", err)
	}
	if got := requests.Load(); got != 3 {
		t.Errorf("requests = %d, want 3", got)
	}
	requests.Store(0)
	server.Config.Handler = stdhttp.HandlerFunc(func(response stdhttp.ResponseWriter, _ *stdhttp.Request) {
		if requests.Add(1) < 3 {
			response.WriteHeader(stdhttp.StatusServiceUnavailable)
			return
		}
		_, _ = response.Write([]byte(`{"applied":true}`))
	})
	if _, err := client.Checkpoint(context.Background(), checkpointFixture()); err != nil {
		t.Fatalf("checkpoint after 5xx retries: %v", err)
	}
	if got := requests.Load(); got != 3 {
		t.Errorf("requests = %d, want 3", got)
	}

	requests.Store(0)
	server.Config.Handler = stdhttp.HandlerFunc(func(response stdhttp.ResponseWriter, _ *stdhttp.Request) {
		requests.Add(1)
		response.WriteHeader(stdhttp.StatusBadRequest)
	})
	_, err := client.Checkpoint(context.Background(), checkpointFixture())
	var responseError *ResponseError
	if !errors.As(err, &responseError) || responseError.StatusCode != stdhttp.StatusBadRequest {
		t.Fatalf("error = %v, want 400 ResponseError", err)
	}
	if got := requests.Load(); got != 1 {
		t.Errorf("requests after 400 = %d, want 1", got)
	}
}

func TestClientRetriesTemporaryNetworkAndPerRequestTimeout(t *testing.T) {
	t.Parallel()

	temporary := &retryTransport{first: func(*stdhttp.Request) error { return temporaryError{} }}
	client := NewClient(Config{BaseURL: "https://control-plane.example.test", ServiceIdentity: "service-secret", HTTPClient: &stdhttp.Client{Transport: temporary}, MaxAttempts: 2, RetryDelay: func(int) time.Duration { return 0 }})
	if _, err := client.Checkpoint(context.Background(), checkpointFixture()); err != nil {
		t.Fatalf("checkpoint after temporary error: %v", err)
	}

	timeout := &retryTransport{first: func(request *stdhttp.Request) error {
		<-request.Context().Done()
		return request.Context().Err()
	}}
	client = NewClient(Config{BaseURL: "https://control-plane.example.test", ServiceIdentity: "service-secret", HTTPClient: &stdhttp.Client{Transport: timeout}, Timeout: time.Millisecond, MaxAttempts: 2, RetryDelay: func(int) time.Duration { return 0 }})
	if _, err := client.Checkpoint(context.Background(), checkpointFixture()); err != nil {
		t.Fatalf("checkpoint after request timeout: %v", err)
	}
}

func TestClientErrorsDoNotExposeResponseBodyOrCredential(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(stdhttp.HandlerFunc(func(response stdhttp.ResponseWriter, _ *stdhttp.Request) {
		response.WriteHeader(stdhttp.StatusInternalServerError)
		_, _ = response.Write([]byte("response-secret"))
	}))
	defer server.Close()

	_, err := NewClient(Config{BaseURL: server.URL, ServiceIdentity: "credential-secret", AllowInsecureLoopback: true, MaxAttempts: 1}).Checkpoint(context.Background(), checkpointFixture())
	if err == nil || strings.Contains(err.Error(), "response-secret") || strings.Contains(err.Error(), "credential-secret") {
		t.Errorf("error = %v, must not expose body or credential", err)
	}
}

func TestBufferIsBoundedAndNonBlocking(t *testing.T) {
	t.Parallel()

	buffer := NewBuffer(callbackClientFunc(func(context.Context, Checkpoint) (Result, error) { return Result{}, nil }), 1)
	if err := buffer.EnqueueCheckpoint(context.Background(), checkpointFixture()); err != nil {
		t.Fatalf("first enqueue: %v", err)
	}
	if err := buffer.EnqueueCompletion(context.Background(), completionFixture()); !errors.Is(err, ErrBufferFull) {
		t.Errorf("full enqueue error = %v, want ErrBufferFull", err)
	}
}

func TestBufferKeepsLaterJobsAfterDeliveryFailure(t *testing.T) {
	t.Parallel()

	want := errors.New("callback unavailable")
	buffer := NewBuffer(callbackClientFunc(func(context.Context, Checkpoint) (Result, error) {
		return Result{}, want
	}), 2)
	if err := buffer.EnqueueCheckpoint(context.Background(), checkpointFixture()); err != nil {
		t.Fatalf("first enqueue: %v", err)
	}
	if err := buffer.EnqueueCompletion(context.Background(), completionFixture()); err != nil {
		t.Fatalf("second enqueue: %v", err)
	}
	if err := buffer.Run(context.Background()); !errors.Is(err, want) {
		t.Fatalf("Run() error = %v, want %v", err, want)
	}
	if pending := len(buffer.jobs); pending != 1 {
		t.Errorf("pending jobs = %d, want 1", pending)
	}
}

func checkpointFixture() Checkpoint {
	return Checkpoint{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 1, PresentationRevision: 2, Version: 1, LastSequence: 5, IdempotencyKey: "checkpoint-1", Payload: json.RawMessage(`{"step":2}`)}
}

func completionFixture() Completion {
	return Completion{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindVenueEdge, AssignmentEpoch: 2, PresentationRevision: 3, CheckpointVersion: 1, LastSequence: 5, IdempotencyKey: "completion-1", StartedAt: "2026-08-21T12:00:00Z", EndedAt: "2026-08-21T12:01:00Z", ParticipantCount: 1, Participants: []Participant{{UserID: "presenter-1", Role: "presenter"}}, FinalCheckpoint: json.RawMessage(`{"state":"complete"}`)}
}

type callbackClientFunc func(context.Context, Checkpoint) (Result, error)

func (f callbackClientFunc) Checkpoint(ctx context.Context, value Checkpoint) (Result, error) {
	return f(ctx, value)
}
func (callbackClientFunc) Complete(context.Context, Completion) (Result, error) { return Result{}, nil }

type roundTripperFunc func(*stdhttp.Request) (*stdhttp.Response, error)

func (f roundTripperFunc) RoundTrip(request *stdhttp.Request) (*stdhttp.Response, error) {
	return f(request)
}

type retryTransport struct {
	calls atomic.Int32
	first func(*stdhttp.Request) error
}

func (t *retryTransport) RoundTrip(request *stdhttp.Request) (*stdhttp.Response, error) {
	if t.calls.Add(1) == 1 {
		return nil, t.first(request)
	}
	return &stdhttp.Response{StatusCode: stdhttp.StatusOK, Body: io.NopCloser(strings.NewReader(`{"applied":true}`)), Header: make(stdhttp.Header)}, nil
}

type temporaryError struct{}

func (temporaryError) Error() string   { return "temporary network failure" }
func (temporaryError) Temporary() bool { return true }
