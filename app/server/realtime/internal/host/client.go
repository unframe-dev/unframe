package host

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

type TerminalError struct{ Reason string }

func (e *TerminalError) Error() string { return e.Reason }

type HTTPControlPlane struct {
	Origin, RuntimeID, ServiceIdentity string
	Client                             *http.Client
}

func (c HTTPControlPlane) Start(ctx context.Context, input Registration) (uint64, error) {
	var result struct {
		Generation uint64 `json:"generation"`
	}
	err := c.post(ctx, "start", input, &result)
	if err == nil && result.Generation == 0 {
		return 0, &TerminalError{Reason: "invalid runtime host generation response"}
	}
	return result.Generation, err
}
func (c HTTPControlPlane) Heartbeat(ctx context.Context, input Heartbeat) (HeartbeatResponse, error) {
	var result HeartbeatResponse
	err := c.post(ctx, "heartbeat", input, &result)
	if err == nil && (result.Generation == 0 || result.Assignments == nil) {
		return HeartbeatResponse{}, &TerminalError{Reason: "invalid runtime host heartbeat response"}
	}
	return result, err
}
func (c HTTPControlPlane) post(ctx context.Context, action string, input, output any) error {
	data, err := json.Marshal(input)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Origin+"/internal/runtime/hosts/"+url.PathEscape(c.RuntimeID)+"/"+action, bytes.NewReader(data))
	if err != nil {
		return errors.New("invalid runtime host management endpoint")
	}
	request.Header.Set("Authorization", "Bearer "+c.ServiceIdentity)
	request.Header.Set("Content-Type", "application/json")
	response, err := c.Client.Do(request)
	if err != nil {
		return errors.New("runtime host management transport unavailable")
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		failure := fmt.Sprintf("runtime host management rejected (HTTP %d)", response.StatusCode)
		if response.StatusCode >= 400 && response.StatusCode < 500 && response.StatusCode != http.StatusTooManyRequests {
			return &TerminalError{Reason: failure}
		}
		return errors.New(failure)
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if decoder.Decode(output) != nil || decoder.Decode(new(any)) != io.EOF {
		return &TerminalError{Reason: "invalid runtime host management response"}
	}
	return nil
}
