package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/unframe-dev/unframe/app/server/internal/service"
)

type initAssetInput struct {
	Body service.InitAssetInput
}

type initAssetOutput struct {
	Body service.InitAssetOutput
}

func registerAssets(api huma.API, assets *service.Assets) {
	huma.Register(api, huma.Operation{
		OperationID:   "init-asset",
		Method:        http.MethodPost,
		Path:          "/assets/init",
		Tags:          []string{"assets"},
		Summary:       "Initialize an asset upload",
		Description:   "Persists asset metadata and returns a presigned Cloudflare R2 upload URL.",
		DefaultStatus: http.StatusCreated,
		Errors:        []int{400, 413, 415, 500},
	}, func(ctx context.Context, input *initAssetInput) (*initAssetOutput, error) {
		if assets == nil {
			return nil, errors.New("asset service is not configured")
		}
		output, err := assets.Init(ctx, input.Body)
		if err != nil {
			var assetError *service.AssetError
			if errors.As(err, &assetError) {
				return nil, statusError(statusForErrorCode(assetError.Code), assetError.Code, assetError.Message, assetError.Details)
			}
			return nil, err
		}
		return &initAssetOutput{Body: output}, nil
	})
	assetSchema := api.OpenAPI().Components.Schemas.Map()["InitAssetInput"]
	if assetSchema != nil {
		contentTypeSchema := assetSchema.Properties["contentType"]
		contentTypeSchema.Extensions = map[string]any{"enum": []string{"application/octet-stream", "image/png", "image/jpeg", "image/webp"}}
		sizeSchema := assetSchema.Properties["sizeBytes"]
		sizeSchema.Extensions = map[string]any{"maximum": service.MaxAssetSizeBytes}
	}
	delete(api.OpenAPI().Paths["/assets/init"].Post.Responses, "422")
}

func statusForErrorCode(code string) int {
	switch code {
	case "payload_too_large":
		return http.StatusRequestEntityTooLarge
	case "unsupported_media_type":
		return http.StatusUnsupportedMediaType
	case "not_found":
		return http.StatusNotFound
	case "conflict":
		return http.StatusConflict
	default:
		return http.StatusBadRequest
	}
}
