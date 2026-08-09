package db

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/pressly/goose/v3"
	"github.com/unframe-dev/unframe/app/server/db/migrations"
)

func Migrate(ctx context.Context, connection *sql.DB) error {
	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("sqlite3"); err != nil {
		return fmt.Errorf("configure goose: %w", err)
	}
	if err := goose.UpContext(ctx, connection, "."); err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	return nil
}
