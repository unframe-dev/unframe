package testdb

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/google/uuid"
	backenddb "github.com/unframe-dev/unframe/apps/backend/internal/db"
	_ "modernc.org/sqlite"
)

func Open(ctx context.Context) (*sql.DB, error) {
	name := fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString())
	connection, err := sql.Open("sqlite", name)
	if err != nil {
		return nil, fmt.Errorf("open in-memory SQLite: %w", err)
	}
	connection.SetMaxOpenConns(1)
	if _, err := connection.ExecContext(ctx, "PRAGMA foreign_keys = ON"); err != nil {
		_ = connection.Close()
		return nil, fmt.Errorf("enable SQLite foreign keys: %w", err)
	}

	if err := backenddb.Migrate(ctx, connection); err != nil {
		_ = connection.Close()
		return nil, fmt.Errorf("migrate in-memory SQLite: %w", err)
	}
	return connection, nil
}
