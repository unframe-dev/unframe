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

func (c HTTPControlPlane) Heartbeat(ctx context.Context, input Heartbeat) (*Assignment, error) {
	data, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Origin+"/internal/runtime/hosts/"+url.PathEscape(c.RuntimeID)+"/heartbeat", bytes.NewReader(data))
	if err != nil {
		return nil, errors.New("invalid runtime host heartbeat endpoint")
	}
	request.Header.Set("Authorization", "Bearer "+c.ServiceIdentity)
	request.Header.Set("Content-Type", "application/json")
	response, err := c.Client.Do(request)
	if err != nil {
		return nil, errors.New("runtime host heartbeat transport unavailable")
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		failure := fmt.Sprintf("runtime host heartbeat rejected (HTTP %d)", response.StatusCode)
		if response.StatusCode >= 400 && response.StatusCode < 500 && response.StatusCode != http.StatusTooManyRequests {
			return nil, &TerminalError{Reason: failure}
		}
		return nil, errors.New(failure)
	}
	var envelope struct {
		Assignment json.RawMessage `json:"assignment"`
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 65537))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&envelope) != nil || len(envelope.Assignment) == 0 || decoder.Decode(new(any)) != io.EOF {
		return nil, &TerminalError{Reason: "invalid runtime host heartbeat response"}
	}
	if bytes.Equal(bytes.TrimSpace(envelope.Assignment), []byte("null")) {
		return nil, nil
	}
	var assignment Assignment
	decoder = json.NewDecoder(bytes.NewReader(envelope.Assignment))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&assignment) != nil {
		return nil, &TerminalError{Reason: "invalid runtime host assignment response"}
	}
	return &assignment, nil
}
