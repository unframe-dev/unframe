package migrations

import "embed"

// FS contains the exact migrations used by production and in-memory tests.
//
//go:embed *.sql
var FS embed.FS
