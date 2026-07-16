package service_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	backenddb "github.com/unframe-dev/unframe/apps/backend/internal/db"
	"github.com/unframe-dev/unframe/apps/backend/internal/db/sqlcgen"
	"github.com/unframe-dev/unframe/apps/backend/internal/db/testdb"
	"github.com/unframe-dev/unframe/apps/backend/internal/service"
	"github.com/unframe-dev/unframe/apps/backend/internal/storage"
)

func TestSlideElementJSONPreservesRequiredZeroValuesAtStoredAndReadBoundaries(t *testing.T) {
	text := service.StoredSlideElement{ID: "10000000-0000-4000-8000-000000000001", Type: "text", Text: ""}
	shape := service.StoredSlideElement{ID: "10000000-0000-4000-8000-000000000002", Type: "shape", Shape: "rectangle", FillColor: "#fff", StrokeColor: "#000", StrokeWidth: 0}

	storedJSON, err := json.Marshal(service.StoredSlideContent{Elements: []service.StoredSlideElement{text, shape}, Background: "white", Notes: ""})
	if err != nil {
		t.Fatal(err)
	}
	assertElementZeroValueFields(t, storedJSON)

	readJSON, err := json.Marshal(service.SlideContent{Elements: []service.SlideElement{{StoredSlideElement: text}, {StoredSlideElement: shape}}, Background: "white", Notes: ""})
	if err != nil {
		t.Fatal(err)
	}
	assertElementZeroValueFields(t, readJSON)
}

func assertElementZeroValueFields(t *testing.T, data []byte) {
	t.Helper()
	var content struct {
		Elements []map[string]any `json:"elements"`
	}
	if err := json.Unmarshal(data, &content); err != nil {
		t.Fatal(err)
	}
	if value, ok := content.Elements[0]["text"]; !ok || value != "" {
		t.Fatalf("empty text field was omitted: %s", data)
	}
	if _, ok := content.Elements[0]["strokeWidth"]; ok {
		t.Fatalf("text contains a shape-only field: %s", data)
	}
	if value, ok := content.Elements[1]["strokeWidth"]; !ok || value != float64(0) {
		t.Fatalf("zero strokeWidth field was omitted: %s", data)
	}
	if _, ok := content.Elements[1]["text"]; ok {
		t.Fatalf("shape contains a text-only field: %s", data)
	}
}

type singletonRaceRepository struct {
	service.PresentationRepository
	lookups int
}

func (repository *singletonRaceRepository) GetSingleton(context.Context) (string, error) {
	repository.lookups++
	if repository.lookups == 1 {
		return "", sql.ErrNoRows
	}
	return "10000000-0000-4000-8000-000000000099", nil
}

func (repository *singletonRaceRepository) WithTx(context.Context, func(service.PresentationStore) error) error {
	return errors.New("UNIQUE constraint failed: presentations.singleton_key")
}

func TestPresentationCreateConvergesOnSingletonAfterInsertRace(t *testing.T) {
	repository := &singletonRaceRepository{}
	presentations := service.NewPresentations(repository, &storage.Fake{}, service.PresentationOptions{})
	created, err := presentations.Create(context.Background(), service.CreatePresentationInput{Title: "Racing create"})
	if err != nil {
		t.Fatal(err)
	}
	if created.ID != "10000000-0000-4000-8000-000000000099" || repository.lookups != 2 {
		t.Fatalf("did not converge on existing singleton: %#v, lookups=%d", created, repository.lookups)
	}
}

func TestPresentationsLifecycleAndSingleton(t *testing.T) {
	ctx := context.Background()
	connection, err := testdb.Open(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close() })

	assetID := "aaaaaaaa-1111-4111-8111-111111111111"
	if err := backenddb.NewAssets(sqlcgen.New(connection)).CreateAsset(ctx, service.AssetRecord{
		ID: assetID, Filename: "diagram.png", MimeType: "image/png", SizeBytes: 12, StorageKey: "assets/diagram.png",
	}); err != nil {
		t.Fatal(err)
	}

	ids := []uuid.UUID{
		uuid.MustParse("10000000-0000-4000-8000-000000000001"),
		uuid.MustParse("20000000-0000-4000-8000-000000000001"),
		uuid.MustParse("20000000-0000-4000-8000-000000000002"),
		uuid.MustParse("30000000-0000-4000-8000-000000000001"),
	}
	nextID := func() uuid.UUID {
		id := ids[0]
		ids = ids[1:]
		return id
	}
	nowIndex := 0
	now := func() time.Time {
		nowIndex++
		return time.Date(2026, 7, 13, 10, nowIndex, 0, 0, time.UTC)
	}
	fakeStorage := &storage.Fake{}
	presentations := service.NewPresentations(backenddb.NewPresentations(connection), fakeStorage, service.PresentationOptions{NewID: nextID, Now: now})

	created, err := presentations.Create(ctx, service.CreatePresentationInput{Title: "Demo"})
	if err != nil {
		t.Fatal(err)
	}
	if created.ID != "10000000-0000-4000-8000-000000000001" {
		t.Fatalf("unexpected presentation id %q", created.ID)
	}
	got, err := presentations.Get(ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Slides) != 1 || got.Slides[0].OrderIndex != 0 || got.Slides[0].Content.Background != "#ffffff" || got.Slides[0].Content.Notes != "" {
		t.Fatalf("unexpected default slide: %#v", got.Slides)
	}
	firstSlideID := got.Slides[0].ID

	// Existing singleton returns before validating title or referenced assets and is not mutated.
	unknown := "ffffffff-ffff-4fff-8fff-ffffffffffff"
	again, err := presentations.Create(ctx, service.CreatePresentationInput{Title: "Changed", ThumbnailAssetID: &unknown})
	if err != nil {
		t.Fatal(err)
	}
	if again.ID != created.ID {
		t.Fatalf("singleton id changed: %s", again.ID)
	}
	unchanged, err := presentations.Get(ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.Title != "Demo" || unchanged.Slides[0].ID != firstSlideID {
		t.Fatalf("singleton was mutated: %#v", unchanged)
	}

	title := "Updated"
	slides := []service.SlidePayload{
		{Content: service.StoredSlideContent{Elements: []service.StoredSlideElement{{
			ID: "40000000-0000-4000-8000-000000000001", Type: "image", AssetID: assetID,
		}}, Background: "#112233", Notes: "speaker"}},
		{Content: service.StoredSlideContent{Elements: []service.StoredSlideElement{}, Background: "white", Notes: ""}},
	}
	updated, err := presentations.Update(ctx, created.ID, service.UpdatePresentationInput{Title: &title, Slides: &slides})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Title != title || len(updated.Slides) != 2 || updated.Slides[0].ID == firstSlideID || updated.Slides[0].OrderIndex != 0 || updated.Slides[1].OrderIndex != 1 {
		t.Fatalf("slides were not fully replaced: %#v", updated)
	}
	if updated.Slides[0].Content.Elements[0].Src == "" || len(fakeStorage.GetRequests) != 1 || fakeStorage.GetRequests[0].Key != "assets/diagram.png" {
		t.Fatalf("asset URL was not expanded: %#v / %#v", updated.Slides[0], fakeStorage.GetRequests)
	}

	list, err := presentations.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Presentations) != 1 || list.Presentations[0].ID != created.ID || list.Presentations[0].Title != title {
		t.Fatalf("unexpected list: %#v", list)
	}
}

func TestPresentationRejectsUnknownAssetsInsideTransaction(t *testing.T) {
	ctx := context.Background()
	connection, err := testdb.Open(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	presentations := service.NewPresentations(backenddb.NewPresentations(connection), &storage.Fake{}, service.PresentationOptions{})
	unknown := "ffffffff-ffff-4fff-8fff-ffffffffffff"

	_, err = presentations.Create(ctx, service.CreatePresentationInput{Title: "Demo", ThumbnailAssetID: &unknown})
	var presentationError *service.PresentationError
	if !errors.As(err, &presentationError) || presentationError.Code != "validation_error" {
		t.Fatalf("expected validation error, got %v", err)
	}
	details, ok := presentationError.Details.(map[string]any)
	if !ok || details["field"] == nil || details["missing"] == nil {
		t.Fatalf("unexpected details: %#v", presentationError.Details)
	}
	var count int
	if err := connection.QueryRowContext(ctx, "SELECT count(*) FROM presentations").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("transaction persisted invalid presentation: %d", count)
	}
}

func TestPresentationGetTreatsMissingSlideZeroAsNotFound(t *testing.T) {
	ctx := context.Background()
	connection, err := testdb.Open(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	id := "10000000-0000-4000-8000-000000000001"
	_, err = connection.ExecContext(ctx, "INSERT INTO presentations (id, title) VALUES (?, ?)", id, "broken")
	if err != nil {
		t.Fatal(err)
	}
	presentations := service.NewPresentations(backenddb.NewPresentations(connection), &storage.Fake{}, service.PresentationOptions{})
	_, err = presentations.Get(ctx, id)
	var presentationError *service.PresentationError
	if !errors.As(err, &presentationError) || presentationError.Code != "not_found" {
		t.Fatalf("expected not_found, got %v", err)
	}
}

func TestPresentationGetFailsWhenSlideAssetIsMissing(t *testing.T) {
	ctx := context.Background()
	connection, err := testdb.Open(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	presentationID := "10000000-0000-4000-8000-000000000001"
	missingAssetID := "ffffffff-ffff-4fff-8fff-ffffffffffff"
	content := `{"elements":[{"id":"40000000-0000-4000-8000-000000000001","type":"model","transform":{"position":{"x":0,"y":0,"z":0},"rotation":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"assetId":"` + missingAssetID + `","displayName":"missing"}],"background":"#fff","notes":""}`
	if _, err := connection.ExecContext(ctx, "PRAGMA foreign_keys = OFF"); err != nil {
		t.Fatal(err)
	}
	if _, err := connection.ExecContext(ctx, "INSERT INTO presentations (id, title) VALUES (?, ?)", presentationID, "broken"); err != nil {
		t.Fatal(err)
	}
	if _, err := connection.ExecContext(ctx, "INSERT INTO slides (id, presentation_id, order_index, content) VALUES (?, ?, 0, ?)", "20000000-0000-4000-8000-000000000001", presentationID, content); err != nil {
		t.Fatal(err)
	}
	presentations := service.NewPresentations(backenddb.NewPresentations(connection), &storage.Fake{}, service.PresentationOptions{})
	_, err = presentations.Get(ctx, presentationID)
	var presentationError *service.PresentationError
	if errors.As(err, &presentationError) || errors.Is(err, sql.ErrNoRows) || err == nil {
		t.Fatalf("expected internal failure, got %v", err)
	}
}
