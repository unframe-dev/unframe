package service

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/unframe-dev/unframe/app/server/internal/storage"
)

const MaxAssetSizeBytes int64 = 50 * 1024 * 1024

type AssetRecord struct {
	ID         string
	Filename   string
	MimeType   string
	SizeBytes  int64
	StorageKey string
}

type AssetRepository interface {
	CreateAsset(context.Context, AssetRecord) error
}

type AssetOptions struct {
	NewID     func() uuid.UUID
	Now       func() time.Time
	URLExpiry time.Duration
}

type InitAssetInput struct {
	Filename    string `json:"filename" minLength:"1" maxLength:"255"`
	ContentType string `json:"contentType" minLength:"1"`
	SizeBytes   int64  `json:"sizeBytes" minimum:"1"`
}

type InitAssetOutput struct {
	AssetID    string    `json:"assetId" format:"uuid"`
	UploadURL  string    `json:"uploadUrl" format:"uri"`
	ExpiresAt  time.Time `json:"expiresAt" format:"date-time"`
	StorageKey string    `json:"storageKey" pattern:"^assets/[0-9a-f-]{36}\\.(fbx|png|jpg|webp)$"`
}

type AssetError struct {
	Code    string
	Message string
	Details any
}

func (assetError *AssetError) Error() string {
	return assetError.Message
}

type Assets struct {
	repository AssetRepository
	storage    storage.Storage
	newID      func() uuid.UUID
	now        func() time.Time
	urlExpiry  time.Duration
}

func NewAssets(repository AssetRepository, objectStorage storage.Storage, options AssetOptions) *Assets {
	newID := options.NewID
	if newID == nil {
		newID = uuid.New
	}
	now := options.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	expiry := options.URLExpiry
	if expiry <= 0 {
		expiry = 15 * time.Minute
	}
	return &Assets{
		repository: repository,
		storage:    objectStorage,
		newID:      newID,
		now:        now,
		urlExpiry:  expiry,
	}
}

func (assets *Assets) Init(ctx context.Context, input InitAssetInput) (InitAssetOutput, error) {
	if input.SizeBytes > MaxAssetSizeBytes {
		return InitAssetOutput{}, &AssetError{
			Code:    "payload_too_large",
			Message: fmt.Sprintf("sizeBytes exceeds the %d byte limit", MaxAssetSizeBytes),
		}
	}
	extension, validationError := storageExtension(input.ContentType, input.Filename)
	if validationError != nil {
		return InitAssetOutput{}, validationError
	}
	if assets.repository == nil || assets.storage == nil {
		return InitAssetOutput{}, fmt.Errorf("asset service dependencies are not configured")
	}

	id := assets.newID().String()
	storageKey := fmt.Sprintf("assets/%s.%s", id, extension)
	record := AssetRecord{
		ID:         id,
		Filename:   input.Filename,
		MimeType:   input.ContentType,
		SizeBytes:  input.SizeBytes,
		StorageKey: storageKey,
	}
	signed, err := assets.storage.PresignPut(ctx, storage.PutRequest{
		Key:         storageKey,
		ContentType: input.ContentType,
		SizeBytes:   input.SizeBytes,
		Expires:     assets.urlExpiry,
	})
	if err != nil {
		return InitAssetOutput{}, fmt.Errorf("presign asset upload: %w", err)
	}
	if err := assets.repository.CreateAsset(ctx, record); err != nil {
		return InitAssetOutput{}, fmt.Errorf("create asset metadata: %w", err)
	}
	expiresAt := signed.ExpiresAt
	if expiresAt.IsZero() {
		expiresAt = assets.now().Add(assets.urlExpiry)
	}
	return InitAssetOutput{
		AssetID:    id,
		UploadURL:  signed.URL,
		ExpiresAt:  expiresAt.UTC(),
		StorageKey: storageKey,
	}, nil
}

func storageExtension(contentType, filename string) (string, *AssetError) {
	switch contentType {
	case "application/octet-stream":
		if !strings.EqualFold(filepath.Ext(filename), ".fbx") {
			return "", &AssetError{
				Code:    "unsupported_media_type",
				Message: fmt.Sprintf("Content type %q is not allowed for filename %q", contentType, filename),
			}
		}
		return "fbx", nil
	case "image/png":
		return "png", nil
	case "image/jpeg":
		return "jpg", nil
	case "image/webp":
		return "webp", nil
	default:
		return "", &AssetError{
			Code:    "unsupported_media_type",
			Message: fmt.Sprintf("Content type %q is not allowed", contentType),
		}
	}
}
