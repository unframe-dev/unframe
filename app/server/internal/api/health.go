package api

import (
	"context"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

type HealthResponse struct {
	Status    string    `json:"status" enum:"ok" doc:"Service liveness status"`
	Uptime    float64   `json:"uptime" minimum:"0" doc:"Seconds since process start"`
	Timestamp time.Time `json:"timestamp" format:"date-time" doc:"Current server time"`
}

type healthOutput struct {
	Body HealthResponse
}

func registerHealth(api huma.API, startedAt time.Time, now func() time.Time) {
	huma.Register(api, huma.Operation{
		OperationID: "get-health",
		Method:      http.MethodGet,
		Path:        "/health",
		Tags:        []string{"system"},
		Summary:     "Liveness probe",
		Description: "Reports process liveness without checking database or storage connectivity.",
	}, func(context.Context, *struct{}) (*healthOutput, error) {
		current := now().UTC()
		return &healthOutput{Body: HealthResponse{
			Status:    "ok",
			Uptime:    max(0, current.Sub(startedAt).Seconds()),
			Timestamp: current,
		}}, nil
	})
}
