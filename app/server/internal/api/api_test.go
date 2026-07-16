package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

func TestHealth(t *testing.T) {
	startedAt := time.Date(2026, time.July, 13, 1, 2, 3, 0, time.UTC)
	now := startedAt.Add(5 * time.Second)
	app := New(Options{StartedAt: startedAt, Now: func() time.Time { return now }})

	response := request(t, app.Handler, http.MethodGet, "/health")

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	assertJSON(t, response.Body.Bytes(), map[string]any{
		"status":    "ok",
		"uptime":    float64(5),
		"timestamp": "2026-07-13T01:02:08Z",
	})
}

func TestUnknownRouteUsesErrorEnvelope(t *testing.T) {
	app := New(Options{})

	response := request(t, app.Handler, http.MethodGet, "/unknown")

	assertError(t, response, http.StatusNotFound, "not_found", "Not Found", false)
}

func TestMethodNotAllowedUsesLegacyNotFoundEnvelope(t *testing.T) {
	app := New(Options{})

	response := request(t, app.Handler, http.MethodPost, "/health")

	assertError(t, response, http.StatusNotFound, "not_found", "Not Found", false)
}

func TestValidationErrorUsesErrorEnvelope(t *testing.T) {
	app := New(Options{})
	type input struct {
		Limit int `query:"limit" minimum:"1" required:"true"`
	}
	huma.Get(app.API, "/test/validation", func(context.Context, *input) (*struct{}, error) {
		return nil, nil
	})

	response := request(t, app.Handler, http.MethodGet, "/test/validation?limit=-1")

	assertError(t, response, http.StatusBadRequest, "validation_error", "Request validation failed", true)
}

func TestInternalErrorUsesErrorEnvelope(t *testing.T) {
	app := New(Options{})
	huma.Get(app.API, "/test/error", func(context.Context, *struct{}) (*struct{}, error) {
		return nil, errors.New("database credentials must not leak")
	})

	response := request(t, app.Handler, http.MethodGet, "/test/error")

	assertError(t, response, http.StatusInternalServerError, "internal_error", "Internal Server Error", false)
	if body := response.Body.String(); contains(body, "credentials") {
		t.Fatalf("internal error leaked implementation details: %s", body)
	}
}

func request(t *testing.T, handler http.Handler, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(method, target, nil))
	return recorder
}
