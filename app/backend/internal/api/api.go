package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/unframe-dev/unframe/apps/backend/internal/service"
)

const version = "0.1.0"

// App exposes both the HTTP handler and Huma API so tests and feature modules
// can register operations without depending on a concrete router.
type App struct {
	Handler http.Handler
	API     huma.API
}

type Options struct {
	StartedAt     time.Time
	Now           func() time.Time
	Assets        *service.Assets
	Presentations *service.Presentations
	CORSOrigins   []string
}

func New(options Options) App {
	now := options.Now
	if now == nil {
		now = time.Now
	}
	startedAt := options.StartedAt
	if startedAt.IsZero() {
		startedAt = now()
	}

	router := chi.NewRouter()
	router.Use(recoverErrors)
	origins := options.CORSOrigins
	if len(origins) == 0 {
		origins = []string{"http://localhost:5173", "http://localhost:3000"}
	}
	router.Use(corsMiddleware(origins))
	router.NotFound(func(writer http.ResponseWriter, _ *http.Request) {
		writeError(writer, http.StatusNotFound, "not_found", "Not Found")
	})
	router.MethodNotAllowed(func(writer http.ResponseWriter, _ *http.Request) {
		writeError(writer, http.StatusNotFound, "not_found", "Not Found")
	})

	config := huma.DefaultConfig("Unframe API", version)
	config.CreateHooks = nil
	api := humachi.New(router, config)
	registerHealth(api, startedAt, now)
	registerAssets(api, options.Assets)
	registerPresentations(api, options.Presentations)
	registerManifest(api, options.Presentations)

	return App{Handler: router, API: api}
}

func corsMiddleware(origins []string) func(http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(origins))
	for _, origin := range origins {
		allowed[origin] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			origin := request.Header.Get("Origin")
			if _, ok := allowed[origin]; ok {
				writer.Header().Set("Access-Control-Allow-Origin", origin)
				writer.Header().Set("Vary", "Origin")
				writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
				writer.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			}
			if request.Method == http.MethodOptions && request.Header.Get("Access-Control-Request-Method") != "" {
				writer.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(writer, request)
		})
	}
}

func recoverErrors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer func() {
			if recover() != nil {
				writeError(writer, http.StatusInternalServerError, "internal_error", "Internal Server Error")
			}
		}()
		next.ServeHTTP(writer, request)
	})
}

func writeError(writer http.ResponseWriter, status int, code, message string) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(ErrorResponse{
		Body:   ErrorBody{Code: code, Message: message},
		status: status,
	})
}
