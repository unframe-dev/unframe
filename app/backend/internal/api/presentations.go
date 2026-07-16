package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/unframe-dev/unframe/apps/backend/internal/service"
)

type createPresentationInput struct {
	Body service.CreatePresentationInput
}

type createPresentationOutput struct {
	Body service.PresentationCreated
}

type presentationPathInput struct {
	ID string `path:"id" format:"uuid"`
}

type updatePresentationInput struct {
	ID   string `path:"id" format:"uuid"`
	Body service.UpdatePresentationInput
}

type presentationOutput struct {
	Body service.Presentation
}

type presentationListOutput struct {
	Body service.PresentationList
}

func registerPresentations(api huma.API, presentations *service.Presentations) {
	huma.Register(api, huma.Operation{
		OperationID: "create-presentation", Method: http.MethodPost, Path: "/presentations",
		Tags: []string{"presentations"}, Summary: "Create the singleton presentation",
		DefaultStatus: http.StatusCreated, Errors: []int{400, 500},
	}, func(ctx context.Context, input *createPresentationInput) (*createPresentationOutput, error) {
		if presentations == nil {
			return nil, errors.New("presentation service is not configured")
		}
		created, err := presentations.Create(ctx, input.Body)
		if err != nil {
			return nil, presentationStatusError(err)
		}
		return &createPresentationOutput{Body: created}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "update-presentation", Method: http.MethodPut, Path: "/presentations/{id}",
		Tags: []string{"presentations"}, Summary: "Update a presentation and optionally replace all slides",
		Errors: []int{400, 404, 500},
	}, func(ctx context.Context, input *updatePresentationInput) (*presentationOutput, error) {
		if presentations == nil {
			return nil, errors.New("presentation service is not configured")
		}
		updated, err := presentations.Update(ctx, input.ID, input.Body)
		if err != nil {
			return nil, presentationStatusError(err)
		}
		return &presentationOutput{Body: updated}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-presentation", Method: http.MethodGet, Path: "/presentations/{id}",
		Tags: []string{"presentations"}, Summary: "Get a presentation with ordered slides and signed asset URLs",
		Errors: []int{400, 404, 500},
	}, func(ctx context.Context, input *presentationPathInput) (*presentationOutput, error) {
		if presentations == nil {
			return nil, errors.New("presentation service is not configured")
		}
		found, err := presentations.Get(ctx, input.ID)
		if err != nil {
			return nil, presentationStatusError(err)
		}
		return &presentationOutput{Body: found}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "list-presentations", Method: http.MethodGet, Path: "/presentations",
		Tags: []string{"presentations"}, Summary: "List presentations newest first", Errors: []int{500},
	}, func(ctx context.Context, _ *struct{}) (*presentationListOutput, error) {
		if presentations == nil {
			return nil, errors.New("presentation service is not configured")
		}
		list, err := presentations.List(ctx)
		if err != nil {
			return nil, presentationStatusError(err)
		}
		return &presentationListOutput{Body: list}, nil
	})

	delete(api.OpenAPI().Paths["/presentations"].Post.Responses, "422")
	delete(api.OpenAPI().Paths["/presentations/{id}"].Put.Responses, "422")
	delete(api.OpenAPI().Paths["/presentations/{id}"].Get.Responses, "422")
	updateSchema := api.OpenAPI().Components.Schemas.Map()["UpdatePresentationInput"]
	if updateSchema != nil {
		if updateSchema.Extensions == nil {
			updateSchema.Extensions = map[string]any{}
		}
		// Documentation-only constraint. Runtime keeps the service error envelope.
		updateSchema.Extensions["minProperties"] = 1
	}
}

func presentationStatusError(err error) error {
	var presentationError *service.PresentationError
	if errors.As(err, &presentationError) {
		return statusError(statusForErrorCode(presentationError.Code), presentationError.Code, presentationError.Message, presentationError.Details)
	}
	return err
}
