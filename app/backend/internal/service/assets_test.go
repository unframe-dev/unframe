package service_test

import (
	"context"
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

type recordingAssetRepository struct {
	created []service.AssetRecord
}

func (repository *recordingAssetRepository) CreateAsset(_ context.Context, asset service.AssetRecord) error {
	repository.created = append(repository.created, asset)
	return nil
}

func TestAssetsInitPersistsMetadataAndSupportsBoundaryInputs(t *testing.T) {
	ctx := context.Background()
	connection, err := testdb.Open(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := connection.Close(); err != nil {
			t.Errorf("close database: %v", err)
		}
	})
	queries := sqlcgen.New(connection)
	repository := backenddb.NewAssets(queries)

	tests := []struct {
		filename    string
		contentType string
		size        int64
		extension   string
	}{
		{"MODEL.FBX", "application/octet-stream", service.MaxAssetSizeBytes, "fbx"},
		{"thumbnail.any", "image/png", 1, "png"},
		{"photo.any", "image/jpeg", 2, "jpg"},
		{"preview.any", "image/webp", 3, "webp"},
	}

	for index, test := range tests {
		t.Run(test.contentType, func(t *testing.T) {
			id := uuid.MustParse(string(rune('1'+index)) + "23e4567-e89b-12d3-a456-426614174000")
			objects := &storage.Fake{PutURL: "https://uploads.example.test/signed"}
			assets := service.NewAssets(repository, objects, service.AssetOptions{
				NewID: func() uuid.UUID { return id },
				Now:   func() time.Time { return time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC) },
			})

			output, err := assets.Init(ctx, service.InitAssetInput{
				Filename: test.filename, ContentType: test.contentType, SizeBytes: test.size,
			})
			if err != nil {
				t.Fatal(err)
			}
			wantKey := "assets/" + id.String() + "." + test.extension
			if output.StorageKey != wantKey {
				t.Fatalf("storage key = %q, want %q", output.StorageKey, wantKey)
			}
			row, err := queries.GetAsset(ctx, id.String())
			if err != nil {
				t.Fatal(err)
			}
			if row.SizeBytes != test.size || row.MimeType != test.contentType || row.StorageKey != wantKey {
				t.Fatalf("persisted row = %#v", row)
			}
		})
	}
}

func TestAssetsInitDoesNotPersistWhenPresigningFails(t *testing.T) {
	repository := &recordingAssetRepository{}
	assets := service.NewAssets(repository, &storage.Fake{Err: errors.New("R2 unavailable")}, service.AssetOptions{})
	_, err := assets.Init(context.Background(), service.InitAssetInput{Filename: "image.png", ContentType: "image/png", SizeBytes: 1})
	if err == nil {
		t.Fatal("expected presign failure")
	}
	if len(repository.created) != 0 {
		t.Fatalf("orphan metadata was persisted: %#v", repository.created)
	}
}
