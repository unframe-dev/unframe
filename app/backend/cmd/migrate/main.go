package main

import (
	"context"
	"log"
	"os"

	backenddb "github.com/unframe-dev/unframe/apps/backend/internal/db"
)

func main() {
	ctx := context.Background()
	connection, err := backenddb.Open(ctx, backenddb.Config{
		URL:       os.Getenv("TURSO_DATABASE_URL"),
		AuthToken: os.Getenv("TURSO_AUTH_TOKEN"),
	})
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}
	defer func() {
		if err := connection.Close(); err != nil {
			log.Printf("close database: %v", err)
		}
	}()

	if err := backenddb.Migrate(ctx, connection); err != nil {
		log.Fatalf("migrate database: %v", err)
	}
	log.Print("database is up to date")
}
