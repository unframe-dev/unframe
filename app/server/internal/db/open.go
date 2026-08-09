package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"

	_ "github.com/tursodatabase/libsql-client-go/libsql"
)

type Config struct {
	URL       string
	AuthToken string
}

func Open(ctx context.Context, config Config) (*sql.DB, error) {
	if config.URL == "" || config.AuthToken == "" {
		return nil, errors.New("turso database URL and auth token are required")
	}
	databaseURL, err := url.Parse(config.URL)
	if err != nil || databaseURL.Scheme == "" || databaseURL.Host == "" {
		return nil, fmt.Errorf("invalid Turso database URL %q", config.URL)
	}
	query := databaseURL.Query()
	query.Set("authToken", config.AuthToken)
	databaseURL.RawQuery = query.Encode()

	connection, err := sql.Open("libsql", databaseURL.String())
	if err != nil {
		return nil, fmt.Errorf("open Turso database: %w", err)
	}
	connection.SetMaxOpenConns(1)
	if err := connection.PingContext(ctx); err != nil {
		_ = connection.Close()
		return nil, fmt.Errorf("ping Turso database: %w", err)
	}
	if _, err := connection.ExecContext(ctx, "PRAGMA foreign_keys = ON"); err != nil {
		_ = connection.Close()
		return nil, fmt.Errorf("enable Turso foreign keys: %w", err)
	}
	return connection, nil
}
