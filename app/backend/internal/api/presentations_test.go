package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"testing"

	backenddb "github.com/unframe-dev/unframe/apps/backend/internal/db"
	"github.com/unframe-dev/unframe/apps/backend/internal/db/sqlcgen"
	"github.com/unframe-dev/unframe/apps/backend/internal/db/testdb"
	"github.com/unframe-dev/unframe/apps/backend/internal/service"
	"github.com/unframe-dev/unframe/apps/backend/internal/storage"
)

func TestPresentationOperationsAreRegistered(t *testing.T) {
	app := New(Options{})
	paths := app.API.OpenAPI().Paths
	if paths["/presentations"] == nil || paths["/presentations"].Post == nil || paths["/presentations"].Get == nil {
		t.Fatal("expected POST and GET /presentations operations")
	}
	if paths["/presentations/{id}"] == nil || paths["/presentations/{id}"].Put == nil || paths["/presentations/{id}"].Get == nil {
		t.Fatal("expected PUT and GET /presentations/{id} operations")
	}
}

func TestPresentationHTTPFlow(t *testing.T) {
	app, connection := presentationTestApp(t)
	ctx := context.Background()
	assetID := "aaaaaaaa-1111-4111-8111-111111111111"
	if err := backenddb.NewAssets(sqlcgen.New(connection)).CreateAsset(ctx, service.AssetRecord{
		ID: assetID, Filename: "diagram.png", MimeType: "image/png", SizeBytes: 10, StorageKey: "assets/diagram.png",
	}); err != nil {
		t.Fatal(err)
	}

	element := map[string]any{
		"id": "bbbbbbbb-1111-4111-8111-111111111111", "type": "image", "assetId": assetID,
		"transform": transformJSON(), "alt": "diagram",
	}
	createResponse := jsonRequest(t, app.Handler, http.MethodPost, "/presentations", map[string]any{
		"title": "Demo", "thumbnailAssetId": assetID,
		"slides": []any{map[string]any{"content": map[string]any{"elements": []any{element}, "background": "#123456", "notes": "notes"}}},
	})
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create status = %d; body = %s", createResponse.Code, createResponse.Body.String())
	}
	var created service.PresentationCreated
	if err := json.Unmarshal(createResponse.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}

	getResponse := jsonRequest(t, app.Handler, http.MethodGet, "/presentations/"+created.ID, nil)
	if getResponse.Code != http.StatusOK {
		t.Fatalf("get status = %d; body = %s", getResponse.Code, getResponse.Body.String())
	}
	var got service.Presentation
	if err := json.Unmarshal(getResponse.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.ThumbnailURL == nil || len(got.Slides) != 1 || got.Slides[0].Content.Elements[0].Src == "" {
		t.Fatalf("signed URLs were not expanded: %#v", got)
	}
	oldSlideID := got.Slides[0].ID

	updateResponse := jsonRequest(t, app.Handler, http.MethodPut, "/presentations/"+created.ID, map[string]any{
		"title": "Updated", "thumbnailAssetId": nil,
		"slides": []any{
			map[string]any{"content": map[string]any{"elements": []any{}, "background": "white", "notes": "first"}},
			map[string]any{"content": map[string]any{"elements": []any{}, "background": "black", "notes": "second"}},
		},
	})
	if updateResponse.Code != http.StatusOK {
		t.Fatalf("update status = %d; body = %s", updateResponse.Code, updateResponse.Body.String())
	}
	var updated service.Presentation
	if err := json.Unmarshal(updateResponse.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Title != "Updated" || updated.ThumbnailURL != nil || len(updated.Slides) != 2 || updated.Slides[0].ID == oldSlideID || updated.Slides[0].OrderIndex != 0 || updated.Slides[1].OrderIndex != 1 {
		t.Fatalf("unexpected update: %#v", updated)
	}

	listResponse := jsonRequest(t, app.Handler, http.MethodGet, "/presentations", nil)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status = %d; body = %s", listResponse.Code, listResponse.Body.String())
	}
	var list service.PresentationList
	if err := json.Unmarshal(listResponse.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Presentations) != 1 || list.Presentations[0].Title != "Updated" {
		t.Fatalf("unexpected list: %#v", list)
	}

	// Singleton creation returns before validating unknown assets and preserves data.
	second := jsonRequest(t, app.Handler, http.MethodPost, "/presentations", map[string]any{
		"title": "Ignored", "thumbnailAssetId": "ffffffff-ffff-4fff-8fff-ffffffffffff",
	})
	if second.Code != http.StatusCreated {
		t.Fatalf("singleton status = %d; body = %s", second.Code, second.Body.String())
	}
	var existing service.PresentationCreated
	if err := json.Unmarshal(second.Body.Bytes(), &existing); err != nil || existing.ID != created.ID {
		t.Fatalf("unexpected singleton response: %#v, %v", existing, err)
	}
}

func TestPresentationHTTPValidationAndErrors(t *testing.T) {
	app, _ := presentationTestApp(t)
	invalidBodies := []any{
		map[string]any{"title": ""},
		map[string]any{"title": "Demo", "slides": []any{}},
		map[string]any{"title": "Demo", "slides": []any{map[string]any{"content": map[string]any{"elements": []any{}, "background": "", "notes": ""}}}},
		map[string]any{"title": "Demo", "slides": []any{map[string]any{"content": map[string]any{"elements": []any{map[string]any{"id": "bbbbbbbb-1111-4111-8111-111111111111", "type": "image", "assetId": "aaaaaaaa-1111-4111-8111-111111111111", "src": "https://forbidden.test/x", "transform": transformJSON()}}, "background": "white", "notes": ""}}}},
	}
	for _, body := range invalidBodies {
		response := jsonRequest(t, app.Handler, http.MethodPost, "/presentations", body)
		assertError(t, response, http.StatusBadRequest, "validation_error", "Request validation failed", true)
	}

	missingAsset := jsonRequest(t, app.Handler, http.MethodPost, "/presentations", map[string]any{
		"title": "Demo", "thumbnailAssetId": "ffffffff-ffff-4fff-8fff-ffffffffffff",
	})
	assertError(t, missingAsset, http.StatusBadRequest, "validation_error", "Unknown asset(s) referenced by slides[].content.elements[].assetId / thumbnailAssetId", true)

	emptyUpdate := jsonRequest(t, app.Handler, http.MethodPut, "/presentations/10000000-0000-4000-8000-000000000001", map[string]any{})
	assertError(t, emptyUpdate, http.StatusBadRequest, "validation_error", "At least one of title / thumbnailAssetId / slides must be provided", true)
	badPath := jsonRequest(t, app.Handler, http.MethodGet, "/presentations/not-a-uuid", nil)
	assertError(t, badPath, http.StatusBadRequest, "validation_error", "Request validation failed", true)
	notFound := jsonRequest(t, app.Handler, http.MethodGet, "/presentations/10000000-0000-4000-8000-000000000001", nil)
	assertError(t, notFound, http.StatusNotFound, "not_found", "Presentation 10000000-0000-4000-8000-000000000001 not found", false)
}

func presentationTestApp(t *testing.T) (App, *sql.DB) {
	t.Helper()
	connection, err := testdb.Open(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	presentations := service.NewPresentations(backenddb.NewPresentations(connection), &storage.Fake{}, service.PresentationOptions{})
	return New(Options{Presentations: presentations}), connection
}

func transformJSON() map[string]any {
	return map[string]any{
		"position": map[string]any{"x": 0, "y": 0, "z": 0},
		"rotation": map[string]any{"x": 0, "y": 0, "z": 0},
		"scale":    map[string]any{"x": 1, "y": 1, "z": 1},
	}
}
