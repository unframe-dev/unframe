package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/unframe-dev/unframe/apps/backend/internal/service"
	"github.com/unframe-dev/unframe/apps/backend/internal/storage"
)

const maxAssetSize = 50 * 1024 * 1024

type recordingAssetRepository struct {
	created []service.AssetRecord
}

func (repository *recordingAssetRepository) CreateAsset(_ context.Context, asset service.AssetRecord) error {
	repository.created = append(repository.created, asset)
	return nil
}

func TestInitAsset(t *testing.T) {
	fixedNow := time.Date(2026, time.July, 13, 3, 4, 5, 0, time.UTC)
	repository := &recordingAssetRepository{}
	objects := &storage.Fake{
		PutURL: "https://uploads.example.test/signed",
		Now:    func() time.Time { return fixedNow },
	}
	assets := service.NewAssets(repository, objects, service.AssetOptions{
		NewID:     func() uuid.UUID { return uuid.MustParse("123e4567-e89b-12d3-a456-426614174000") },
		Now:       func() time.Time { return fixedNow },
		URLExpiry: 15 * time.Minute,
	})
	app := New(Options{Assets: assets, Now: func() time.Time { return fixedNow }})

	response := jsonRequest(t, app.Handler, http.MethodPost, "/assets/init", map[string]any{
		"filename":    "MODEL.FBX",
		"contentType": "application/octet-stream",
		"sizeBytes":   maxAssetSize,
	})

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body = %s", response.Code, response.Body.String())
	}
	assertJSON(t, response.Body.Bytes(), map[string]any{
		"assetId":    "123e4567-e89b-12d3-a456-426614174000",
		"uploadUrl":  "https://uploads.example.test/signed",
		"expiresAt":  "2026-07-13T03:19:05Z",
		"storageKey": "assets/123e4567-e89b-12d3-a456-426614174000.fbx",
	})
	if len(repository.created) != 1 || repository.created[0].StorageKey != "assets/123e4567-e89b-12d3-a456-426614174000.fbx" {
		t.Fatalf("created assets = %#v", repository.created)
	}
	if repository.created[0].SizeBytes != maxAssetSize {
		t.Fatalf("size bytes = %d, want %d", repository.created[0].SizeBytes, maxAssetSize)
	}
	if len(objects.PutRequests) != 1 || objects.PutRequests[0].ContentType != "application/octet-stream" {
		t.Fatalf("presign requests = %#v", objects.PutRequests)
	}
	if objects.PutRequests[0].SizeBytes != maxAssetSize {
		t.Fatalf("presigned size = %d, want %d", objects.PutRequests[0].SizeBytes, maxAssetSize)
	}
}

func TestInitAssetOversizedHTTPBodyUsesErrorEnvelope(t *testing.T) {
	app := New(Options{Assets: service.NewAssets(&recordingAssetRepository{}, &storage.Fake{}, service.AssetOptions{})})
	request := httptestRequest(http.MethodPost, "/assets/init", strings.NewReader(`{"filename":"`+strings.Repeat("a", 1024*1024)+`","contentType":"image/png","sizeBytes":1}`))
	request.Header.Set("Content-Type", "application/json")
	response := serve(app.Handler, request)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413; body = %s", response.Code, response.Body.String())
	}
	var envelope struct {
		Error ErrorBody `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Error.Code != "payload_too_large" {
		t.Fatalf("unexpected envelope: %#v", envelope)
	}
}

func TestInitAssetRejectsInvalidRequests(t *testing.T) {
	tests := []struct {
		name    string
		body    map[string]any
		status  int
		code    string
		message string
	}{
		{"empty filename", map[string]any{"filename": "", "contentType": "image/png", "sizeBytes": 1}, 400, "validation_error", "Request validation failed"},
		{"long filename", map[string]any{"filename": string(bytes.Repeat([]byte{'a'}, 256)), "contentType": "image/png", "sizeBytes": 1}, 400, "validation_error", "Request validation failed"},
		{"zero size", map[string]any{"filename": "x.png", "contentType": "image/png", "sizeBytes": 0}, 400, "validation_error", "Request validation failed"},
		{"oversize", map[string]any{"filename": "x.png", "contentType": "image/png", "sizeBytes": maxAssetSize + 1}, 413, "payload_too_large", "sizeBytes exceeds the 52428800 byte limit"},
		{"unsupported MIME", map[string]any{"filename": "x.txt", "contentType": "text/plain", "sizeBytes": 1}, 415, "unsupported_media_type", "Content type \"text/plain\" is not allowed"},
		{"non-FBX binary", map[string]any{"filename": "x.bin", "contentType": "application/octet-stream", "sizeBytes": 1}, 415, "unsupported_media_type", "Content type \"application/octet-stream\" is not allowed for filename \"x.bin\""},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repository := &recordingAssetRepository{}
			assets := service.NewAssets(repository, &storage.Fake{}, service.AssetOptions{})
			app := New(Options{Assets: assets})

			response := jsonRequest(t, app.Handler, http.MethodPost, "/assets/init", test.body)

			assertError(t, response, test.status, test.code, test.message, test.code == "validation_error")
			if len(repository.created) != 0 {
				t.Fatalf("invalid request persisted an asset: %#v", repository.created)
			}
		})
	}
}

func TestCORS(t *testing.T) {
	app := New(Options{CORSOrigins: []string{"http://localhost:5173", "http://localhost:3000"}})
	request := httptestRequest(http.MethodOptions, "/assets/init", nil)
	request.Header.Set("Origin", "http://localhost:5173")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	request.Header.Set("Access-Control-Request-Headers", "Content-Type")
	response := serve(app.Handler, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body = %s", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("allow origin = %q", got)
	}
	if got := response.Header().Get("Access-Control-Allow-Methods"); got != "GET, POST, PUT, OPTIONS" {
		t.Fatalf("allow methods = %q", got)
	}
	if got := response.Header().Get("Access-Control-Allow-Headers"); got != "Content-Type" {
		t.Fatalf("allow headers = %q", got)
	}

	denied := httptestRequest(http.MethodOptions, "/assets/init", nil)
	denied.Header.Set("Origin", "https://evil.example")
	denied.Header.Set("Access-Control-Request-Method", http.MethodPost)
	deniedResponse := serve(app.Handler, denied)
	if got := deniedResponse.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("unexpected allow origin for denied preflight: %q", got)
	}
}

func jsonRequest(t *testing.T, handler http.Handler, method, target string, body any) *httptest.ResponseRecorder {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request := httptestRequest(method, target, bytes.NewReader(data))
	request.Header.Set("Content-Type", "application/json")
	return serve(handler, request)
}

func httptestRequest(method, target string, body io.Reader) *http.Request {
	return httptest.NewRequest(method, target, body)
}

func serve(handler http.Handler, request *http.Request) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
