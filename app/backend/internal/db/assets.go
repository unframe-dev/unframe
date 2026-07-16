package db

import (
	"context"

	"github.com/unframe-dev/unframe/apps/backend/internal/db/sqlcgen"
	"github.com/unframe-dev/unframe/apps/backend/internal/service"
)

type Assets struct {
	queries *sqlcgen.Queries
}

func NewAssets(queries *sqlcgen.Queries) *Assets {
	return &Assets{queries: queries}
}

func (assets *Assets) CreateAsset(ctx context.Context, asset service.AssetRecord) error {
	_, err := assets.queries.CreateAsset(ctx, sqlcgen.CreateAssetParams{
		ID:         asset.ID,
		Filename:   asset.Filename,
		MimeType:   asset.MimeType,
		SizeBytes:  asset.SizeBytes,
		StorageKey: asset.StorageKey,
	})
	return err
}

var _ service.AssetRepository = (*Assets)(nil)
