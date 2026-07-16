package db

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/unframe-dev/unframe/apps/backend/internal/db/sqlcgen"
	"github.com/unframe-dev/unframe/apps/backend/internal/service"
)

type Presentations struct {
	connection *sql.DB
	queries    *sqlcgen.Queries
}

func NewPresentations(connection *sql.DB) *Presentations {
	return &Presentations{connection: connection, queries: sqlcgen.New(connection)}
}

func (presentations *Presentations) WithTx(ctx context.Context, callback func(service.PresentationStore) error) error {
	transaction, err := presentations.connection.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	store := &presentationStore{queries: presentations.queries.WithTx(transaction)}
	if err := callback(store); err != nil {
		if rollbackErr := transaction.Rollback(); rollbackErr != nil {
			return fmt.Errorf("rollback transaction after %v: %w", err, rollbackErr)
		}
		return err
	}
	if err := transaction.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}

func (presentations *Presentations) GetSingleton(ctx context.Context) (string, error) {
	return presentations.queries.GetSingletonPresentationID(ctx)
}

func (presentations *Presentations) GetPresentation(ctx context.Context, id string) (service.PresentationRecord, error) {
	return (&presentationStore{queries: presentations.queries}).GetPresentation(ctx, id)
}

func (presentations *Presentations) ListPresentations(ctx context.Context) ([]service.PresentationRecord, error) {
	return (&presentationStore{queries: presentations.queries}).ListPresentations(ctx)
}

func (presentations *Presentations) ListSlides(ctx context.Context, id string) ([]service.SlideRecord, error) {
	return (&presentationStore{queries: presentations.queries}).ListSlides(ctx, id)
}

func (presentations *Presentations) GetAsset(ctx context.Context, id string) (service.AssetRecord, error) {
	return (&presentationStore{queries: presentations.queries}).GetAsset(ctx, id)
}

func (presentations *Presentations) GetAssets(ctx context.Context, ids []string) ([]service.AssetRecord, error) {
	return (&presentationStore{queries: presentations.queries}).GetAssets(ctx, ids)
}

func (presentations *Presentations) CreatePresentation(ctx context.Context, record service.PresentationRecord) error {
	return (&presentationStore{queries: presentations.queries}).CreatePresentation(ctx, record)
}

func (presentations *Presentations) UpdatePresentation(ctx context.Context, patch service.PresentationPatch) error {
	return (&presentationStore{queries: presentations.queries}).UpdatePresentation(ctx, patch)
}

func (presentations *Presentations) DeleteSlides(ctx context.Context, id string) error {
	return presentations.queries.DeletePresentationSlides(ctx, id)
}

func (presentations *Presentations) CreateSlide(ctx context.Context, id, presentationID string, orderIndex int, content string) error {
	return (&presentationStore{queries: presentations.queries}).CreateSlide(ctx, id, presentationID, orderIndex, content)
}

type presentationStore struct {
	queries *sqlcgen.Queries
}

func (store *presentationStore) GetSingleton(ctx context.Context) (string, error) {
	return store.queries.GetSingletonPresentationID(ctx)
}

func (store *presentationStore) GetPresentation(ctx context.Context, id string) (service.PresentationRecord, error) {
	record, err := store.queries.GetPresentation(ctx, id)
	if err != nil {
		return service.PresentationRecord{}, err
	}
	return service.PresentationRecord{ID: record.ID, Title: record.Title, ThumbnailAssetID: record.ThumbnailAssetID, CreatedAt: record.CreatedAt, UpdatedAt: record.UpdatedAt}, nil
}

func (store *presentationStore) ListPresentations(ctx context.Context) ([]service.PresentationRecord, error) {
	records, err := store.queries.ListPresentations(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]service.PresentationRecord, 0, len(records))
	for _, record := range records {
		result = append(result, service.PresentationRecord{ID: record.ID, Title: record.Title, ThumbnailAssetID: record.ThumbnailAssetID, CreatedAt: record.CreatedAt, UpdatedAt: record.UpdatedAt})
	}
	return result, nil
}

func (store *presentationStore) ListSlides(ctx context.Context, id string) ([]service.SlideRecord, error) {
	records, err := store.queries.ListPresentationSlides(ctx, id)
	if err != nil {
		return nil, err
	}
	result := make([]service.SlideRecord, 0, len(records))
	for _, record := range records {
		result = append(result, service.SlideRecord{ID: record.ID, OrderIndex: record.OrderIndex, Content: record.Content, UpdatedAt: record.UpdatedAt})
	}
	return result, nil
}

func (store *presentationStore) GetAsset(ctx context.Context, id string) (service.AssetRecord, error) {
	asset, err := store.queries.GetAsset(ctx, id)
	if err != nil {
		return service.AssetRecord{}, err
	}
	return service.AssetRecord{ID: asset.ID, Filename: asset.Filename, MimeType: asset.MimeType, SizeBytes: asset.SizeBytes, StorageKey: asset.StorageKey}, nil
}

func (store *presentationStore) GetAssets(ctx context.Context, ids []string) ([]service.AssetRecord, error) {
	assets, err := store.queries.ListAssetsByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	result := make([]service.AssetRecord, 0, len(assets))
	for _, asset := range assets {
		result = append(result, service.AssetRecord{ID: asset.ID, Filename: asset.Filename, MimeType: asset.MimeType, SizeBytes: asset.SizeBytes, StorageKey: asset.StorageKey})
	}
	return result, nil
}

func (store *presentationStore) CreatePresentation(ctx context.Context, record service.PresentationRecord) error {
	return store.queries.CreatePresentation(ctx, sqlcgen.CreatePresentationParams{ID: record.ID, Title: record.Title, ThumbnailAssetID: record.ThumbnailAssetID, CreatedAt: record.CreatedAt, UpdatedAt: record.UpdatedAt})
}

func (store *presentationStore) UpdatePresentation(ctx context.Context, patch service.PresentationPatch) error {
	setTitle := "0"
	if patch.SetTitle {
		setTitle = "1"
	}
	setThumbnail := sql.NullString{}
	if patch.SetThumbnailAssetID {
		setThumbnail = sql.NullString{String: "1", Valid: true}
	}
	return store.queries.UpdatePresentation(ctx, sqlcgen.UpdatePresentationParams{
		SetTitle: setTitle, Title: patch.Title, SetThumbnailAssetID: setThumbnail,
		ThumbnailAssetID: patch.ThumbnailAssetID, UpdatedAt: patch.UpdatedAt, ID: patch.ID,
	})
}

func (store *presentationStore) DeleteSlides(ctx context.Context, id string) error {
	return store.queries.DeletePresentationSlides(ctx, id)
}

func (store *presentationStore) CreateSlide(ctx context.Context, id, presentationID string, orderIndex int, content string) error {
	return store.queries.CreateSlide(ctx, sqlcgen.CreateSlideParams{ID: id, PresentationID: presentationID, OrderIndex: int64(orderIndex), Content: content})
}

var _ service.PresentationRepository = (*Presentations)(nil)
var _ service.PresentationStore = (*presentationStore)(nil)
