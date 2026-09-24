package asset

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

type accessValidatorFunc func(*http.Request, string, Manifest) error

func (function accessValidatorFunc) Validate(request *http.Request, sessionID string, manifest Manifest) error {
	return function(request, sessionID, manifest)
}

func TestGatewayAuthorizesManifestBoundRangeRequests(t *testing.T) {
	t.Parallel()

	payload := []byte("0123456789")
	source := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/octet-stream")
		_, _ = response.Write(payload)
	}))
	defer source.Close()
	manifest := testManifest(payload, source.URL)
	cache, err := NewCache(t.TempDir(), source.Client())
	if err != nil {
		t.Fatalf("NewCache(): %v", err)
	}
	if err := cache.Prefetch(context.Background(), manifest); err != nil {
		t.Fatalf("Prefetch(): %v", err)
	}
	validated := 0
	gateway, err := NewGateway(cache, manifest, accessValidatorFunc(func(request *http.Request, sessionID string, got Manifest) error {
		validated++
		if sessionID != "session-1" {
			t.Errorf("session ID = %q, want session-1", sessionID)
		}
		if request.Header.Get("Authorization") != "Bearer credential" {
			t.Errorf("authorization header = %q", request.Header.Get("Authorization"))
		}
		if got.PresentationRevision != manifest.PresentationRevision {
			t.Errorf("presentation revision = %d, want %d", got.PresentationRevision, manifest.PresentationRevision)
		}
		return nil
	}))
	if err != nil {
		t.Fatalf("NewGateway(): %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/sessions/session-1/assets/asset-1", nil)
	request.Header.Set("Authorization", "Bearer credential")
	request.Header.Set("Range", "bytes=2-5")
	response := httptest.NewRecorder()
	gateway.ServeHTTP(response, request)

	if response.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusPartialContent)
	}
	if response.Body.String() != "2345" {
		t.Fatalf("body = %q, want %q", response.Body.String(), "2345")
	}
	if response.Header().Get("ETag") != `"`+manifest.Assets[0].SHA256+`"` {
		t.Fatalf("ETag = %q", response.Header().Get("ETag"))
	}
	if validated != 1 {
		t.Fatalf("validation calls = %d, want 1", validated)
	}
}

func TestGatewayRejectsUnauthorizedAndUnlistedAssets(t *testing.T) {
	t.Parallel()

	payload := []byte("asset payload")
	source := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/octet-stream")
		_, _ = response.Write(payload)
	}))
	defer source.Close()
	manifest := testManifest(payload, source.URL)
	cache, err := NewCache(t.TempDir(), source.Client())
	if err != nil {
		t.Fatalf("NewCache(): %v", err)
	}
	if err := cache.Prefetch(context.Background(), manifest); err != nil {
		t.Fatalf("Prefetch(): %v", err)
	}

	for name, test := range map[string]struct {
		path      string
		validator AccessValidator
		status    int
	}{
		"unauthorized": {
			path: "/sessions/session-1/assets/asset-1",
			validator: accessValidatorFunc(func(*http.Request, string, Manifest) error {
				return errors.New("invalid credential")
			}),
			status: http.StatusUnauthorized,
		},
		"unlisted": {
			path:      "/sessions/session-1/assets/asset-2",
			validator: accessValidatorFunc(func(*http.Request, string, Manifest) error { return nil }),
			status:    http.StatusNotFound,
		},
	} {
		t.Run(name, func(t *testing.T) {
			gateway, err := NewGateway(cache, manifest, test.validator)
			if err != nil {
				t.Fatalf("NewGateway(): %v", err)
			}
			response := httptest.NewRecorder()
			gateway.ServeHTTP(response, httptest.NewRequest(http.MethodGet, test.path, nil))
			if response.Code != test.status {
				t.Fatalf("status = %d, want %d", response.Code, test.status)
			}
		})
	}
}

func TestGatewayReportsUnavailableCachedAsset(t *testing.T) {
	t.Parallel()

	payload := []byte("asset payload")
	source := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/octet-stream")
		_, _ = response.Write(payload)
	}))
	defer source.Close()
	manifest := testManifest(payload, source.URL)
	cache, err := NewCache(t.TempDir(), source.Client())
	if err != nil {
		t.Fatalf("NewCache(): %v", err)
	}
	if err := cache.Prefetch(context.Background(), manifest); err != nil {
		t.Fatalf("Prefetch(): %v", err)
	}
	gateway, err := NewGateway(
		cache,
		manifest,
		accessValidatorFunc(func(*http.Request, string, Manifest) error { return nil }),
	)
	if err != nil {
		t.Fatalf("NewGateway(): %v", err)
	}
	if err := os.Remove(cache.path(manifest.Assets[0].SHA256)); err != nil {
		t.Fatalf("remove cached asset: %v", err)
	}

	response := httptest.NewRecorder()
	gateway.ServeHTTP(
		response,
		httptest.NewRequest(http.MethodGet, "/sessions/session-1/assets/asset-1", nil),
	)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}
