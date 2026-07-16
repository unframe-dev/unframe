package testdb

import (
	"context"
	"testing"
)

func TestOpenMigratesAndEnablesForeignKeys(t *testing.T) {
	connection, err := Open(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := connection.Close(); err != nil {
			t.Errorf("close database: %v", err)
		}
	})

	var enabled int
	if err := connection.QueryRow("PRAGMA foreign_keys").Scan(&enabled); err != nil {
		t.Fatal(err)
	}
	if enabled != 1 {
		t.Fatalf("foreign_keys = %d, want 1", enabled)
	}

	var table string
	if err := connection.QueryRow("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'assets'").Scan(&table); err != nil {
		t.Fatal(err)
	}
	if table != "assets" {
		t.Fatalf("table = %q, want assets", table)
	}
}
