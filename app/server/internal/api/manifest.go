package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/unframe-dev/unframe/app/server/internal/service"
)

type manifestInput struct {
	ID string `path:"id" format:"uuid"`
}

type manifestOutput struct {
	Body service.Manifest
}

func registerManifest(api huma.API, presentations *service.Presentations) {
	huma.Register(api, huma.Operation{
		OperationID: "get-presentation-manifest",
		Method:      http.MethodGet,
		Path:        "/presentations/{id}/manifest",
		Tags:        []string{"manifest"},
		Summary:     "Get the presentation manifest consumed by MR clients",
		Description: "Returns ordered slides with image and model asset references expanded to signed download URLs.",
		Errors:      []int{400, 404, 500},
	}, func(ctx context.Context, input *manifestInput) (*manifestOutput, error) {
		if presentations == nil {
			return nil, errors.New("presentation service is not configured")
		}
		manifest, err := presentations.Manifest(ctx, input.ID)
		if err != nil {
			return nil, presentationStatusError(err)
		}
		return &manifestOutput{Body: manifest}, nil
	})
	delete(api.OpenAPI().Paths["/presentations/{id}/manifest"].Get.Responses, "422")
}
