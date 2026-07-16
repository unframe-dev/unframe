package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"slices"
	"testing"

	backenddb "github.com/unframe-dev/unframe/app/server/internal/db"
	"github.com/unframe-dev/unframe/app/server/internal/db/sqlcgen"
	"github.com/unframe-dev/unframe/app/server/internal/db/testdb"
	"github.com/unframe-dev/unframe/app/server/internal/service"
	"github.com/unframe-dev/unframe/app/server/internal/storage"
)

const (
	manifestPresentationID = "10000000-0000-4000-8000-000000000001"
	manifestModelAssetID   = "aaaaaaaa-1111-4111-8111-111111111111"
	manifestImageAssetID   = "aaaaaaaa-2222-4222-8222-222222222222"
)

func TestManifestOperationIsRegistered(t *testing.T) {
	app := New(Options{})
	path := app.API.OpenAPI().Paths["/presentations/{id}/manifest"]
	if path == nil || path.Get == nil {
		t.Fatal("expected GET /presentations/{id}/manifest operation")
	}
	for _, status := range []string{"200", "400", "404", "500"} {
		if path.Get.Responses[status] == nil {
			t.Fatalf("manifest OpenAPI is missing %s response", status)
		}
	}
}

func TestManifestReturnsOrderedMRProjectionAndLatestUpdate(t *testing.T) {
	objects := &storage.Fake{}
	app, connection := manifestTestApp(t, objects)
	insertManifestAsset(t, connection, service.AssetRecord{ID: manifestModelAssetID, Filename: "robot.fbx", MimeType: "application/octet-stream", SizeBytes: 4096, StorageKey: "assets/robot.fbx"})
	insertManifestAsset(t, connection, service.AssetRecord{ID: manifestImageAssetID, Filename: "diagram.png", MimeType: "image/png", SizeBytes: 2048, StorageKey: "assets/diagram.png"})
	insertManifestPresentation(t, connection, manifestPresentationID, "Demo", "2026-07-13T10:00:00Z")

	transform := `{"position":{"x":0,"y":1,"z":2},"rotation":{"x":3,"y":4,"z":5},"scale":{"x":1,"y":1,"z":1}}`
	firstContent := `{"elements":[` +
		`{"id":"30000000-0000-4000-8000-000000000001","type":"text","transform":` + transform + `,"text":"hello","fontSize":24,"fontColor":"#000","fontFamily":"Inter","fontWeight":"normal","textAlign":"left"},` +
		`{"id":"30000000-0000-4000-8000-000000000002","type":"model","transform":` + transform + `,"assetId":"` + manifestModelAssetID + `","displayName":"Robot"}` +
		`],"background":"#ffffff","notes":"must not leak"}`
	secondContent := `{"elements":[` +
		`{"id":"30000000-0000-4000-8000-000000000003","type":"image","transform":` + transform + `,"assetId":"` + manifestImageAssetID + `","alt":"diagram"},` +
		`{"id":"30000000-0000-4000-8000-000000000004","type":"shape","transform":` + transform + `,"shape":"ellipse","fillColor":"#fff","strokeColor":"#000","strokeWidth":0},` +
		`{"id":"30000000-0000-4000-8000-000000000005","type":"model","transform":` + transform + `,"assetId":"` + manifestModelAssetID + `","displayName":"Robot again"}` +
		`],"background":"black","notes":"also hidden"}`
	// Insert out of order so the query's order_index contract is exercised.
	insertManifestSlide(t, connection, "20000000-0000-4000-8000-000000000002", manifestPresentationID, 1, secondContent, "2026-07-13T12:00:00Z")
	insertManifestSlide(t, connection, "20000000-0000-4000-8000-000000000001", manifestPresentationID, 0, firstContent, "2026-07-13T11:00:00Z")

	response := jsonRequest(t, app.Handler, http.MethodGet, "/presentations/"+manifestPresentationID+"/manifest", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", response.Code, response.Body.String())
	}
	var body struct {
		PresentationID string `json:"presentationId"`
		Title          string `json:"title"`
		Slides         []struct {
			ID         string           `json:"id"`
			OrderIndex int              `json:"orderIndex"`
			Elements   []map[string]any `json:"elements"`
		} `json:"slides"`
		UpdatedAt string `json:"updatedAt"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.PresentationID != manifestPresentationID || body.Title != "Demo" || body.UpdatedAt != "2026-07-13T12:00:00Z" {
		t.Fatalf("unexpected manifest header: %#v", body)
	}
	if len(body.Slides) != 2 || body.Slides[0].OrderIndex != 0 || body.Slides[1].OrderIndex != 1 {
		t.Fatalf("slides are not ordered: %#v", body.Slides)
	}
	assertManifestKeys(t, body.Slides[0].Elements[0], "id", "text", "transform", "type")
	assertManifestKeys(t, body.Slides[0].Elements[1], "asset", "id", "transform", "type")
	assertManifestKeys(t, body.Slides[1].Elements[0], "asset", "id", "transform", "type")
	assertManifestKeys(t, body.Slides[1].Elements[1], "fillColor", "id", "shape", "strokeColor", "strokeWidth", "transform", "type")
	assertManifestKeys(t, body.Slides[1].Elements[2], "asset", "id", "transform", "type")
	modelAsset := body.Slides[0].Elements[1]["asset"].(map[string]any)
	assertManifestKeys(t, modelAsset, "assetId", "filename", "mimeType", "sizeBytes", "url")
	if modelAsset["assetId"] != manifestModelAssetID || modelAsset["filename"] != "robot.fbx" || modelAsset["mimeType"] != "application/octet-stream" || modelAsset["sizeBytes"] != float64(4096) {
		t.Fatalf("unexpected model asset: %#v", modelAsset)
	}
	if len(objects.GetRequests) != 2 {
		t.Fatalf("signed GET requests = %#v", objects.GetRequests)
	}
}

func TestManifestAllowsPresentationWithoutSlides(t *testing.T) {
	app, connection := manifestTestApp(t, &storage.Fake{})
	insertManifestPresentation(t, connection, manifestPresentationID, "Empty", "2026-07-13T10:00:00Z")
	response := jsonRequest(t, app.Handler, http.MethodGet, "/presentations/"+manifestPresentationID+"/manifest", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", response.Code, response.Body.String())
	}
	var manifest service.Manifest
	if err := json.Unmarshal(response.Body.Bytes(), &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Slides == nil || len(manifest.Slides) != 0 {
		t.Fatalf("slides = %#v, want non-null empty array", manifest.Slides)
	}
}

func TestManifestErrorsUseCommonEnvelope(t *testing.T) {
	t.Run("invalid UUID", func(t *testing.T) {
		app, _ := manifestTestApp(t, &storage.Fake{})
		response := jsonRequest(t, app.Handler, http.MethodGet, "/presentations/not-a-uuid/manifest", nil)
		assertError(t, response, 400, "validation_error", "Request validation failed", true)
	})
	t.Run("missing presentation", func(t *testing.T) {
		app, _ := manifestTestApp(t, &storage.Fake{})
		response := jsonRequest(t, app.Handler, http.MethodGet, "/presentations/"+manifestPresentationID+"/manifest", nil)
		assertError(t, response, 404, "not_found", "Presentation "+manifestPresentationID+" not found", false)
	})
	t.Run("missing asset", func(t *testing.T) {
		app, connection := manifestTestApp(t, &storage.Fake{})
		insertManifestPresentation(t, connection, manifestPresentationID, "Broken", "2026-07-13T10:00:00Z")
		content := `{"elements":[{"id":"30000000-0000-4000-8000-000000000001","type":"image","transform":{"position":{"x":0,"y":0,"z":0},"rotation":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"assetId":"ffffffff-ffff-4fff-8fff-ffffffffffff"}],"background":"white","notes":""}`
		insertManifestSlide(t, connection, "20000000-0000-4000-8000-000000000001", manifestPresentationID, 0, content, "2026-07-13T10:00:00Z")
		response := jsonRequest(t, app.Handler, http.MethodGet, "/presentations/"+manifestPresentationID+"/manifest", nil)
		assertError(t, response, 500, "internal_error", "Internal Server Error", false)
	})
	t.Run("signing failure", func(t *testing.T) {
		app, connection := manifestTestApp(t, &storage.Fake{Err: errors.New("R2 unavailable")})
		insertManifestAsset(t, connection, service.AssetRecord{ID: manifestImageAssetID, Filename: "x.png", MimeType: "image/png", SizeBytes: 1, StorageKey: "assets/x.png"})
		insertManifestPresentation(t, connection, manifestPresentationID, "Broken", "2026-07-13T10:00:00Z")
		content := `{"elements":[{"id":"30000000-0000-4000-8000-000000000001","type":"image","transform":{"position":{"x":0,"y":0,"z":0},"rotation":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"assetId":"` + manifestImageAssetID + `"}],"background":"white","notes":""}`
		insertManifestSlide(t, connection, "20000000-0000-4000-8000-000000000001", manifestPresentationID, 0, content, "2026-07-13T10:00:00Z")
		response := jsonRequest(t, app.Handler, http.MethodGet, "/presentations/"+manifestPresentationID+"/manifest", nil)
		assertError(t, response, 500, "internal_error", "Internal Server Error", false)
	})
}

func manifestTestApp(t *testing.T, objects storage.Storage) (App, *sql.DB) {
	t.Helper()
	connection, err := testdb.Open(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	presentations := service.NewPresentations(backenddb.NewPresentations(connection), objects, service.PresentationOptions{})
	return New(Options{Presentations: presentations}), connection
}

func insertManifestAsset(t *testing.T, connection *sql.DB, asset service.AssetRecord) {
	t.Helper()
	if err := backenddb.NewAssets(sqlcgen.New(connection)).CreateAsset(context.Background(), asset); err != nil {
		t.Fatal(err)
	}
}

func insertManifestPresentation(t *testing.T, connection *sql.DB, id, title, updatedAt string) {
	t.Helper()
	if _, err := connection.Exec("INSERT INTO presentations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)", id, title, updatedAt, updatedAt); err != nil {
		t.Fatal(err)
	}
}

func insertManifestSlide(t *testing.T, connection *sql.DB, id, presentationID string, orderIndex int, content, updatedAt string) {
	t.Helper()
	if _, err := connection.Exec("INSERT INTO slides (id, presentation_id, order_index, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", id, presentationID, orderIndex, content, updatedAt, updatedAt); err != nil {
		t.Fatal(err)
	}
}

func assertManifestKeys(t *testing.T, value map[string]any, keys ...string) {
	t.Helper()
	got := make([]string, 0, len(value))
	for key := range value {
		got = append(got, key)
	}
	slices.Sort(got)
	if !reflect.DeepEqual(got, keys) {
		t.Fatalf("keys = %v, want %v; value = %#v", got, keys, value)
	}
}
