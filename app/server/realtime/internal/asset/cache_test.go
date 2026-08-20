package asset

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestManifestValidationRejectsInvalidAssets(t *testing.T) {
	t.Parallel()

	valid := testManifest([]byte("asset payload"), "https://example.com/asset")
	tests := map[string]func(*Manifest){
		"presentation id":       func(manifest *Manifest) { manifest.PresentationID = "" },
		"presentation revision": func(manifest *Manifest) { manifest.PresentationRevision = 0 },
		"definition checksum":   func(manifest *Manifest) { manifest.DefinitionChecksum = "not-a-sha256" },
		"protocol version":      func(manifest *Manifest) { manifest.ProtocolVersion = "" },
		"asset id":              func(manifest *Manifest) { manifest.Assets[0].ID = "" },
		"asset checksum":        func(manifest *Manifest) { manifest.Assets[0].SHA256 = "invalid" },
		"asset size":            func(manifest *Manifest) { manifest.Assets[0].Size = -1 },
		"asset media type":      func(manifest *Manifest) { manifest.Assets[0].MediaType = "" },
		"asset source":          func(manifest *Manifest) { manifest.Assets[0].SourceURL = "://" },
		"insecure asset source": func(manifest *Manifest) { manifest.Assets[0].SourceURL = "http://example.test/asset" },
		"duplicate asset": func(manifest *Manifest) {
			manifest.Assets = append(manifest.Assets, manifest.Assets[0])
		},
	}

	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			manifest := valid
			manifest.Assets = append([]Descriptor(nil), valid.Assets...)
			mutate(&manifest)
			if err := manifest.Validate(); err == nil {
				t.Fatal("Validate() error = nil, want validation error")
			}
		})
	}
}

func TestCachePrefetchesVerifiedContentAndReusesIt(t *testing.T) {
	t.Parallel()

	payload := []byte("asset payload")
	requests := 0
	source := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		requests++
		response.Header().Set("Content-Type", "application/octet-stream")
		_, _ = response.Write(payload)
	}))
	defer source.Close()

	manifest := testManifest(payload, source.URL)
	root := t.TempDir()
	cache, err := NewCache(root, source.Client())
	if err != nil {
		t.Fatalf("NewCache(): %v", err)
	}
	if err := cache.Prefetch(context.Background(), manifest); err != nil {
		t.Fatalf("Prefetch(): %v", err)
	}
	if err := cache.Ready(manifest); err != nil {
		t.Fatalf("Ready(): %v", err)
	}
	if err := cache.Prefetch(context.Background(), manifest); err != nil {
		t.Fatalf("second Prefetch(): %v", err)
	}
	if requests != 1 {
		t.Fatalf("source requests = %d, want 1", requests)
	}

	path, descriptor, err := cache.Resolve(manifest, manifest.Assets[0].ID)
	if err != nil {
		t.Fatalf("Resolve(): %v", err)
	}
	if descriptor != manifest.Assets[0] {
		t.Fatalf("descriptor = %#v, want %#v", descriptor, manifest.Assets[0])
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read cached asset: %v", err)
	}
	if string(content) != string(payload) {
		t.Fatalf("cached content = %q, want %q", content, payload)
	}
	if filepath.Base(path) != manifest.Assets[0].SHA256 {
		t.Fatalf("cached path = %q, want content-addressed filename", path)
	}
}

func TestCacheResolveReusesPrefetchVerification(t *testing.T) {
	t.Parallel()

	payload := []byte("asset payload")
	source := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/octet-stream")
		_, _ = response.Write(payload)
	}))
	defer source.Close()

	manifest := testManifest(payload, source.URL)
	root := t.TempDir()
	cache, err := NewCache(root, source.Client())
	if err != nil {
		t.Fatalf("NewCache(): %v", err)
	}
	if err := cache.Prefetch(context.Background(), manifest); err != nil {
		t.Fatalf("Prefetch(): %v", err)
	}
	originalHashCached := cache.hashCached
	hashCalls := 0
	cache.hashCached = func(reader io.Reader) (string, error) {
		hashCalls++
		return originalHashCached(reader)
	}

	for range 2 {
		if _, _, err := cache.Resolve(manifest, manifest.Assets[0].ID); err != nil {
			t.Fatalf("Resolve(): %v", err)
		}
	}
	if hashCalls != 0 {
		t.Fatalf("cached asset hash calls = %d, want 0", hashCalls)
	}

	restarted, err := NewCache(root, source.Client())
	if err != nil {
		t.Fatalf("NewCache() after restart: %v", err)
	}
	originalRestartHashCached := restarted.hashCached
	restartHashCalls := 0
	restarted.hashCached = func(reader io.Reader) (string, error) {
		restartHashCalls++
		return originalRestartHashCached(reader)
	}
	if err := restarted.Ready(manifest); err != nil {
		t.Fatalf("Ready() after restart: %v", err)
	}
	for range 2 {
		if _, _, err := restarted.Resolve(manifest, manifest.Assets[0].ID); err != nil {
			t.Fatalf("Resolve() after restart: %v", err)
		}
	}
	if restartHashCalls != 1 {
		t.Fatalf("cached asset hash calls after restart = %d, want 1", restartHashCalls)
	}
}

func TestCacheResolveRevalidatesChangedContent(t *testing.T) {
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
	path := cache.path(manifest.Assets[0].SHA256)
	if err := os.Chmod(path, 0o640); err != nil {
		t.Fatalf("make cached asset writable: %v", err)
	}
	if err := os.WriteFile(path, []byte("wrong payload"), 0o640); err != nil {
		t.Fatalf("replace cached asset: %v", err)
	}
	changedAt := time.Now().Add(time.Hour)
	if err := os.Chtimes(path, changedAt, changedAt); err != nil {
		t.Fatalf("change cached asset timestamp: %v", err)
	}

	if _, _, err := cache.Resolve(manifest, manifest.Assets[0].ID); !errors.Is(err, ErrNotReady) {
		t.Fatalf("Resolve() error = %v, want %v", err, ErrNotReady)
	}
}

func TestCacheRejectsUnverifiedContent(t *testing.T) {
	t.Parallel()

	tests := map[string]http.HandlerFunc{
		"checksum": func(response http.ResponseWriter, _ *http.Request) {
			response.Header().Set("Content-Type", "application/octet-stream")
			_, _ = io.WriteString(response, "wrong payload")
		},
		"media type": func(response http.ResponseWriter, _ *http.Request) {
			response.Header().Set("Content-Type", "text/plain")
			_, _ = io.WriteString(response, "asset payload")
		},
	}
	for name, handler := range tests {
		t.Run(name, func(t *testing.T) {
			source := httptest.NewTLSServer(handler)
			defer source.Close()
			manifest := testManifest([]byte("asset payload"), source.URL)
			cache, err := NewCache(t.TempDir(), source.Client())
			if err != nil {
				t.Fatalf("NewCache(): %v", err)
			}
			if err := cache.Prefetch(context.Background(), manifest); err == nil {
				t.Fatal("Prefetch() error = nil, want verification error")
			}
			if err := cache.Ready(manifest); !errors.Is(err, ErrNotReady) {
				t.Fatalf("Ready() error = %v, want %v", err, ErrNotReady)
			}
		})
	}
}

func TestCacheDoesNotFollowAssetSourceRedirects(t *testing.T) {
	t.Parallel()

	payload := []byte("asset payload")
	redirectedRequests := 0
	insecure := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		redirectedRequests++
		response.Header().Set("Content-Type", "application/octet-stream")
		_, _ = response.Write(payload)
	}))
	defer insecure.Close()
	source := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		http.Redirect(response, &http.Request{}, insecure.URL, http.StatusFound)
	}))
	defer source.Close()
	manifest := testManifest(payload, source.URL)
	cache, err := NewCache(t.TempDir(), source.Client())
	if err != nil {
		t.Fatalf("NewCache(): %v", err)
	}

	if err := cache.Prefetch(context.Background(), manifest); err == nil {
		t.Fatal("Prefetch() error = nil, want redirect rejection")
	}
	if redirectedRequests != 0 {
		t.Fatalf("redirect target requests = %d, want 0", redirectedRequests)
	}
}

func testManifest(payload []byte, sourceURL string) Manifest {
	digest := sha256.Sum256(payload)
	return Manifest{
		PresentationID:       "presentation-1",
		PresentationRevision: 4,
		DefinitionChecksum:   "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		ProtocolVersion:      "v1",
		Assets: []Descriptor{{
			ID:        "asset-1",
			SHA256:    hex.EncodeToString(digest[:]),
			Size:      int64(len(payload)),
			MediaType: "application/octet-stream",
			SourceURL: sourceURL,
		}},
	}
}
