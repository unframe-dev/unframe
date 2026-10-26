package assetgateway

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

type verifier struct{ allow bool }

func (v verifier) VerifyBearer(context.Context, string, ...string) (session.Identity, error) {
	if !v.allow {
		return session.Identity{}, fmt.Errorf("denied")
	}
	return session.Identity{SessionID: "session", ParticipantID: "viewer"}, nil
}
func TestGatewayCachesVerifiedBytesButReauthorizesEachRequest(t *testing.T) {
	bytes := []byte("venue bytes")
	downloads := 0
	origin := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { downloads++; _, _ = w.Write(bytes) }))
	defer origin.Close()
	calls := 0
	deny := false
	gateway := New(verifier{true}, func(ctx context.Context, id session.Identity, asset string) (Asset, error) {
		calls++
		if deny {
			return Asset{}, fmt.Errorf("expired")
		}
		return Asset{URL: origin.URL, Checksum: fmt.Sprintf("sha256:%x", sha256.Sum256(bytes)), Size: int64(len(bytes)), MediaType: "image/png"}, nil
	}, t.TempDir(), origin.Client())
	gateway.reserve = 0
	request := func(path string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", path, nil)
		r.Header.Set("Authorization", "Bearer token")
		w := httptest.NewRecorder()
		gateway.ServeHTTP(w, r)
		return w
	}
	for range 2 {
		w := request("/sessions/session/assets/image")
		if w.Code != 200 || w.Body.String() != string(bytes) {
			t.Fatalf("response: %d %s", w.Code, w.Body.String())
		}
	}
	if downloads != 1 || calls != 4 {
		t.Fatalf("downloads=%d authorizations=%d", downloads, calls)
	}
	deny = true
	if w := request("/sessions/session/assets/image"); w.Code != 403 {
		t.Fatalf("cached access survived revocation: %d", w.Code)
	}
	if w := request("/sessions/other/assets/image"); w.Code != 403 {
		t.Fatalf("cross-session access: %d", w.Code)
	}
}
func TestGatewaySupportsRangeAndRejectsCorruptOrigin(t *testing.T) {
	origin := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("abcdef")) }))
	defer origin.Close()
	descriptor := Asset{URL: origin.URL, Checksum: fmt.Sprintf("sha256:%x", sha256.Sum256([]byte("abcdef"))), Size: 6, MediaType: "video/mp4"}
	gateway := New(verifier{true}, func(context.Context, session.Identity, string) (Asset, error) { return descriptor, nil }, t.TempDir(), origin.Client())
	gateway.reserve = 0
	r := httptest.NewRequest("GET", "/sessions/session/assets/video", nil)
	r.Header.Set("Range", "bytes=2-4")
	w := httptest.NewRecorder()
	gateway.ServeHTTP(w, r)
	if w.Code != 206 || w.Body.String() != "cde" || w.Header().Get("ETag") == "" {
		t.Fatalf("range: %d %s", w.Code, w.Body.String())
	}
	descriptor.Checksum = fmt.Sprintf("sha256:%x", sha256.Sum256([]byte("wrong")))
	w = httptest.NewRecorder()
	gateway.ServeHTTP(w, r)
	if w.Code != 502 {
		t.Fatalf("corrupt origin: %d", w.Code)
	}
}
func TestBrowserPreflightAllowsOnlyConfiguredOrigin(t *testing.T) {
	gateway := New(verifier{}, nil, t.TempDir(), http.DefaultClient)
	gateway.AllowedOrigin = "https://web.example.test"
	for _, origin := range []string{"https://web.example.test", "https://attacker.example.test"} {
		r := httptest.NewRequest("OPTIONS", "/sessions/session/assets/image", nil)
		r.Header.Set("Origin", origin)
		r.Header.Set("Access-Control-Request-Method", "GET")
		r.Header.Set("Access-Control-Request-Headers", "authorization, range")
		r.Header.Set("Access-Control-Request-Private-Network", "true")
		w := httptest.NewRecorder()
		gateway.ServeHTTP(w, r)
		if origin == gateway.AllowedOrigin {
			if w.Code != 204 || w.Header().Get("Access-Control-Allow-Origin") != origin || w.Header().Get("Access-Control-Allow-Private-Network") != "true" {
				t.Fatalf("preflight denied: %d", w.Code)
			}
		} else if w.Code != 403 {
			t.Fatal("foreign origin accepted")
		}
	}
}

func TestCachePreservesPinnedAssetsAndRemovesPartialFiles(t *testing.T) {
	directory := t.TempDir()
	payload := []byte("active")
	active := fmt.Sprintf("%x", sha256.Sum256(payload))
	if err := os.WriteFile(filepath.Join(directory, active), payload, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "partial-interrupted"), []byte("partial"), 0600); err != nil {
		t.Fatal(err)
	}
	gateway := New(verifier{}, nil, directory, http.DefaultClient)
	gateway.reserve = ^uint64(0) - uint64(maximumAssetBytes)
	gateway.pinned[active] = true
	if err := gateway.makeRoom(1); err == nil {
		t.Fatal("disk reserve exhaustion accepted")
	}
	if _, err := os.Stat(filepath.Join(directory, active)); err != nil {
		t.Fatal("pinned asset removed")
	}
	if _, err := os.Stat(filepath.Join(directory, "partial-interrupted")); !os.IsNotExist(err) {
		t.Fatal("partial file survived cleanup")
	}
}

func TestRevocationDuringCloudDownloadPreventsServing(t *testing.T) {
	payload := []byte("venue bytes")
	var revoked atomic.Bool
	origin := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { revoked.Store(true); _, _ = w.Write(payload) }))
	defer origin.Close()
	gateway := New(verifier{true}, func(context.Context, session.Identity, string) (Asset, error) {
		if revoked.Load() {
			return Asset{}, fmt.Errorf("revoked")
		}
		return Asset{URL: origin.URL, Checksum: fmt.Sprintf("sha256:%x", sha256.Sum256(payload)), Size: int64(len(payload)), MediaType: "image/png"}, nil
	}, t.TempDir(), origin.Client())
	gateway.reserve = 0
	w := httptest.NewRecorder()
	gateway.ServeHTTP(w, httptest.NewRequest("GET", "/sessions/session/assets/image", nil))
	if w.Code != 403 || strings.Contains(w.Body.String(), string(payload)) {
		t.Fatalf("revoked download served: %d %s", w.Code, w.Body.String())
	}
}

func TestCachedRequestReauthorizesAfterWaitingForCacheLock(t *testing.T) {
	payload := []byte("cached bytes")
	checksum := fmt.Sprintf("sha256:%x", sha256.Sum256(payload))
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, strings.TrimPrefix(checksum, "sha256:")), payload, 0600); err != nil {
		t.Fatal(err)
	}
	var revoked atomic.Bool
	authorized := make(chan struct{}, 1)
	gateway := New(verifier{true}, func(context.Context, session.Identity, string) (Asset, error) {
		if revoked.Load() {
			return Asset{}, fmt.Errorf("revoked")
		}
		authorized <- struct{}{}
		return Asset{URL: "https://assets.example.test/image", Checksum: checksum, Size: int64(len(payload)), MediaType: "image/png"}, nil
	}, directory, http.DefaultClient)
	gateway.mu.Lock()
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		w := httptest.NewRecorder()
		gateway.ServeHTTP(w, httptest.NewRequest("GET", "/sessions/session/assets/image", nil))
		done <- w
	}()
	<-authorized
	revoked.Store(true)
	gateway.mu.Unlock()
	response := <-done
	if response.Code != 403 {
		t.Fatalf("cached request survived revocation while waiting: %d", response.Code)
	}
}

type expiringVerifier struct{ expired *atomic.Bool }

func (v expiringVerifier) VerifyBearer(context.Context, string, ...string) (session.Identity, error) {
	if v.expired.Load() {
		return session.Identity{}, fmt.Errorf("token expired")
	}
	return session.Identity{SessionID: "session", ParticipantID: "viewer"}, nil
}
func TestTokenExpiryDuringFinalAuthorizationPreventsServing(t *testing.T) {
	payload := []byte("cached bytes")
	checksum := fmt.Sprintf("sha256:%x", sha256.Sum256(payload))
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, strings.TrimPrefix(checksum, "sha256:")), payload, 0600); err != nil {
		t.Fatal(err)
	}
	var expired atomic.Bool
	calls := 0
	gateway := New(expiringVerifier{&expired}, func(context.Context, session.Identity, string) (Asset, error) {
		calls++
		if calls == 2 {
			expired.Store(true)
		}
		return Asset{URL: "https://assets.example.test/image", Checksum: checksum, Size: int64(len(payload)), MediaType: "image/png"}, nil
	}, directory, http.DefaultClient)
	response := httptest.NewRecorder()
	gateway.ServeHTTP(response, httptest.NewRequest("GET", "/sessions/session/assets/image", nil))
	if response.Code != 401 {
		t.Fatalf("token expired during final authorization was accepted: %d", response.Code)
	}
}
