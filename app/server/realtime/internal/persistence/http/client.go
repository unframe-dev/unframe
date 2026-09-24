package http

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	stdhttp "net/http"
	"net/url"
	"strings"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
)

const (
	defaultTimeout     = 5 * time.Second
	defaultMaxAttempts = 3
	maxIdempotencyKey  = 200
)

var (
	ErrBufferFull      = errors.New("persistence callback buffer is full")
	ErrInvalidConfig   = errors.New("invalid persistence callback client configuration")
	ErrInvalidCallback = errors.New("invalid persistence callback")
)

// Checkpoint carries an assignment-fenced opaque runtime snapshot.
type Checkpoint struct {
	SessionID            string                 `json:"sessionId"`
	RuntimeID            string                 `json:"runtimeId"`
	RuntimeKind          assignment.RuntimeKind `json:"runtimeKind"`
	AssignmentEpoch      uint64                 `json:"assignmentEpoch"`
	PresentationRevision uint64                 `json:"presentationRevision"`
	Version              uint64                 `json:"version"`
	LastSequence         uint64                 `json:"lastSequence"`
	IdempotencyKey       string                 `json:"idempotencyKey"`
	Payload              json.RawMessage        `json:"payload"`
}

// Participant is a participant included in the final session record.
type Participant struct {
	UserID string `json:"userId"`
	Role   string `json:"role"`
}

// Completion carries an assignment-fenced opaque final runtime snapshot.
type Completion struct {
	SessionID            string                 `json:"sessionId"`
	RuntimeID            string                 `json:"runtimeId"`
	RuntimeKind          assignment.RuntimeKind `json:"runtimeKind"`
	AssignmentEpoch      uint64                 `json:"assignmentEpoch"`
	PresentationRevision uint64                 `json:"presentationRevision"`
	CheckpointVersion    uint64                 `json:"checkpointVersion"`
	LastSequence         uint64                 `json:"lastSequence"`
	IdempotencyKey       string                 `json:"idempotencyKey"`
	StartedAt            string                 `json:"startedAt"`
	EndedAt              string                 `json:"endedAt"`
	ParticipantCount     uint32                 `json:"participantCount"`
	Participants         []Participant          `json:"participants"`
	FinalCheckpoint      json.RawMessage        `json:"finalCheckpoint"`
}

// Result reports whether the Control Plane applied a callback.
type Result struct {
	Applied bool `json:"applied"`
}

// CallbackClient is the persistence boundary used by runtime session code.
type CallbackClient interface {
	Checkpoint(context.Context, Checkpoint) (Result, error)
	Complete(context.Context, Completion) (Result, error)
}

// Config controls the Control Plane HTTP client. AllowInsecureLoopback is only
// for local HTTP test servers.
type Config struct {
	BaseURL               string
	ServiceIdentity       string
	HTTPClient            *stdhttp.Client
	Timeout               time.Duration
	MaxAttempts           int
	RetryDelay            func(attempt int) time.Duration
	AllowInsecureLoopback bool
}

// Client sends persistence callbacks to the Control Plane.
type Client struct {
	baseURL               string
	serviceIdentity       string
	httpClient            *stdhttp.Client
	timeout               time.Duration
	maxAttempts           int
	retryDelay            func(attempt int) time.Duration
	allowInsecureLoopback bool
}

// ResponseError deliberately omits response bodies and credentials.
type ResponseError struct {
	Operation  string
	StatusCode int
}

func (e *ResponseError) Error() string {
	return fmt.Sprintf("persistence callback %s failed with HTTP status %d", e.Operation, e.StatusCode)
}

// NewClient creates a reusable Control Plane callback client.
func NewClient(config Config) *Client {
	timeout := config.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	maxAttempts := config.MaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = defaultMaxAttempts
	}
	retryDelay := config.RetryDelay
	if retryDelay == nil {
		retryDelay = func(attempt int) time.Duration { return time.Duration(attempt) * 100 * time.Millisecond }
	}
	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = stdhttp.DefaultClient
	}
	httpClientCopy := *httpClient
	// Callback credentials must never be replayed to a redirect target.
	httpClientCopy.CheckRedirect = func(*stdhttp.Request, []*stdhttp.Request) error {
		return stdhttp.ErrUseLastResponse
	}
	return &Client{
		baseURL:               strings.TrimRight(config.BaseURL, "/"),
		serviceIdentity:       config.ServiceIdentity,
		httpClient:            &httpClientCopy,
		timeout:               timeout,
		maxAttempts:           maxAttempts,
		retryDelay:            retryDelay,
		allowInsecureLoopback: config.AllowInsecureLoopback,
	}
}

func (c *Client) Checkpoint(ctx context.Context, value Checkpoint) (Result, error) {
	if err := value.validate(); err != nil {
		return Result{}, err
	}
	return c.send(ctx, "checkpoint", "/callbacks/checkpoints", value)
}

func (c *Client) Complete(ctx context.Context, value Completion) (Result, error) {
	if err := value.validate(); err != nil {
		return Result{}, err
	}
	return c.send(ctx, "completion", "/callbacks/completions", value)
}

func (v Checkpoint) validate() error {
	if err := validateAssignment(v.SessionID, v.RuntimeID, v.RuntimeKind, v.AssignmentEpoch, v.PresentationRevision); err != nil {
		return err
	}
	if !validIdempotencyKey(v.IdempotencyKey) || !json.Valid(v.Payload) {
		return ErrInvalidCallback
	}
	return nil
}

func (v Completion) validate() error {
	if err := validateAssignment(v.SessionID, v.RuntimeID, v.RuntimeKind, v.AssignmentEpoch, v.PresentationRevision); err != nil {
		return err
	}
	if !validIdempotencyKey(v.IdempotencyKey) || !json.Valid(v.FinalCheckpoint) || v.ParticipantCount < 1 || v.ParticipantCount > 50 || int(v.ParticipantCount) != len(v.Participants) {
		return ErrInvalidCallback
	}
	startedAt, err := time.Parse(time.RFC3339, v.StartedAt)
	if err != nil {
		return ErrInvalidCallback
	}
	endedAt, err := time.Parse(time.RFC3339, v.EndedAt)
	if err != nil || endedAt.Before(startedAt) {
		return ErrInvalidCallback
	}
	for _, participant := range v.Participants {
		if strings.TrimSpace(participant.UserID) == "" || (participant.Role != "presenter" && participant.Role != "viewer") {
			return ErrInvalidCallback
		}
	}
	return nil
}

func validIdempotencyKey(value string) bool {
	return strings.TrimSpace(value) != "" && len(value) <= maxIdempotencyKey
}

func validateAssignment(sessionID, runtimeID string, runtimeKind assignment.RuntimeKind, epoch, revision uint64) error {
	if sessionID == "" || runtimeID == "" || (runtimeKind != assignment.RuntimeKindCloud && runtimeKind != assignment.RuntimeKindVenueEdge) || epoch == 0 || revision == 0 {
		return ErrInvalidCallback
	}
	return nil
}

func (c *Client) send(ctx context.Context, operation, path string, value any) (Result, error) {
	endpoint, err := c.callbackEndpoint(path)
	if err != nil {
		return Result{}, err
	}
	body, err := json.Marshal(value)
	if err != nil {
		return Result{}, ErrInvalidCallback
	}
	for attempt := 1; attempt <= c.maxAttempts; attempt++ {
		result, retry, err := c.attempt(ctx, operation, endpoint.String(), body)
		if err == nil {
			return result, nil
		}
		if !retry || attempt == c.maxAttempts {
			return Result{}, err
		}
		if err := wait(ctx, c.retryDelay(attempt)); err != nil {
			return Result{}, err
		}
	}
	panic("unreachable")
}

func (c *Client) callbackEndpoint(path string) (*url.URL, error) {
	if c.baseURL == "" || c.serviceIdentity == "" || strings.ContainsAny(c.serviceIdentity, " \t\r\n") {
		return nil, ErrInvalidConfig
	}
	base, err := url.Parse(c.baseURL)
	if err != nil || base.Host == "" || base.User != nil || !c.allowedEndpoint(base) {
		return nil, ErrInvalidConfig
	}
	return base.ResolveReference(&url.URL{Path: path}), nil
}

func (c *Client) allowedEndpoint(endpoint *url.URL) bool {
	if endpoint.Scheme == "https" {
		return true
	}
	if endpoint.Scheme != "http" || !c.allowInsecureLoopback {
		return false
	}
	host := endpoint.Hostname()
	return host == "localhost" || net.ParseIP(host).IsLoopback()
}

func (c *Client) attempt(ctx context.Context, operation, endpoint string, body []byte) (Result, bool, error) {
	requestContext, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	request, err := stdhttp.NewRequestWithContext(requestContext, stdhttp.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return Result{}, false, ErrInvalidConfig
	}
	request.Header.Set("Authorization", "Bearer "+c.serviceIdentity)
	request.Header.Set("Content-Type", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return Result{}, false, ctx.Err()
		}
		if requestContext.Err() != nil {
			return Result{}, true, requestContext.Err()
		}
		return Result{}, isTemporaryNetworkError(err), &requestError{operation: operation}
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return Result{}, response.StatusCode == stdhttp.StatusTooManyRequests || response.StatusCode >= 500, &ResponseError{Operation: operation, StatusCode: response.StatusCode}
	}
	var result Result
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return Result{}, false, fmt.Errorf("decode persistence callback %s response: %w", operation, err)
	}
	return result, false, nil
}

type requestError struct{ operation string }

func (e *requestError) Error() string {
	return "persistence callback " + e.operation + " request failed"
}

func isTemporaryNetworkError(err error) bool {
	var urlError *url.Error
	if errors.As(err, &urlError) {
		err = urlError.Err
	}
	var temporary interface{ Temporary() bool }
	if errors.As(err, &temporary) && temporary.Temporary() {
		return true
	}
	var networkError net.Error
	return errors.As(err, &networkError) && networkError.Timeout()
}

func wait(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			return nil
		}
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// Buffer is a bounded asynchronous callback queue for runtime hot paths.
type Buffer struct {
	client CallbackClient
	jobs   chan callbackJob
}

type callbackJob struct {
	checkpoint *Checkpoint
	completion *Completion
}

func NewBuffer(client CallbackClient, capacity int) *Buffer {
	if capacity < 1 {
		capacity = 1
	}
	return &Buffer{client: client, jobs: make(chan callbackJob, capacity)}
}

func (b *Buffer) EnqueueCheckpoint(ctx context.Context, value Checkpoint) error {
	return b.enqueue(ctx, callbackJob{checkpoint: &value})
}

func (b *Buffer) EnqueueCompletion(ctx context.Context, value Completion) error {
	return b.enqueue(ctx, callbackJob{completion: &value})
}

func (b *Buffer) enqueue(ctx context.Context, job callbackJob) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	select {
	case b.jobs <- job:
		return nil
	default:
		return ErrBufferFull
	}
}

// Run delivers queued callbacks until cancellation or the first delivery error.
func (b *Buffer) Run(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case job := <-b.jobs:
			var err error
			if job.checkpoint != nil {
				_, err = b.client.Checkpoint(ctx, *job.checkpoint)
			} else {
				_, err = b.client.Complete(ctx, *job.completion)
			}
			if err != nil {
				return err
			}
		}
	}
}
