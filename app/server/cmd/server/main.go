package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2/humacli"
	"github.com/unframe-dev/unframe/app/server/internal/api"
	"github.com/unframe-dev/unframe/app/server/internal/config"
	backenddb "github.com/unframe-dev/unframe/app/server/internal/db"
	"github.com/unframe-dev/unframe/app/server/internal/db/sqlcgen"
	"github.com/unframe-dev/unframe/app/server/internal/service"
	"github.com/unframe-dev/unframe/app/server/internal/storage"
)

type options struct {
	Host string `doc:"Hostname to listen on" default:"0.0.0.0"`
	Port int    `doc:"Port to listen on" short:"p" default:"8080"`
}

func main() {
	cli := humacli.New(func(hooks humacli.Hooks, options *options) {
		configuration, err := config.FromEnv()
		if err != nil {
			log.Fatalf("load configuration: %v", err)
		}
		ctx := context.Background()
		connection, err := backenddb.Open(ctx, backenddb.Config{
			URL: configuration.TursoDatabaseURL, AuthToken: configuration.TursoAuthToken,
		})
		if err != nil {
			log.Fatalf("connect database: %v", err)
		}
		objects, err := storage.NewR2(storage.R2Config{
			Endpoint:        configuration.R2Endpoint,
			AccessKeyID:     configuration.R2AccessKeyID,
			SecretAccessKey: configuration.R2SecretKey,
			Bucket:          configuration.R2Bucket,
		})
		if err != nil {
			_ = connection.Close()
			log.Fatalf("configure R2: %v", err)
		}
		assets := service.NewAssets(
			backenddb.NewAssets(sqlcgen.New(connection)),
			objects,
			service.AssetOptions{},
		)
		presentations := service.NewPresentations(
			backenddb.NewPresentations(connection),
			objects,
			service.PresentationOptions{},
		)
		app := api.New(api.Options{Assets: assets, Presentations: presentations, CORSOrigins: configuration.CORSOrigins})
		server := &http.Server{
			Addr:              fmt.Sprintf("%s:%d", options.Host, options.Port),
			Handler:           app.Handler,
			ReadHeaderTimeout: 5 * time.Second,
		}

		hooks.OnStart(func() {
			log.Printf("listening on %s", server.Addr)
			if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Printf("server stopped: %v", err)
			}
		})
		hooks.OnStop(func() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if err := server.Shutdown(ctx); err != nil {
				log.Printf("graceful shutdown failed: %v", err)
			}
			if err := connection.Close(); err != nil {
				log.Printf("close database: %v", err)
			}
		})
	})
	cli.Run()
}
