-- +goose Up
CREATE TABLE assets (
    id          TEXT PRIMARY KEY,
    filename    TEXT NOT NULL,
    mime_type   TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE presentations (
    id                 TEXT PRIMARY KEY,
    singleton_key      INTEGER NOT NULL DEFAULT 1 CHECK (singleton_key = 1) UNIQUE,
    title              TEXT NOT NULL,
    thumbnail_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
    created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE slides (
    id              TEXT PRIMARY KEY,
    presentation_id TEXT NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
    order_index     INTEGER NOT NULL CHECK (order_index >= 0),
    content         TEXT NOT NULL CHECK (json_valid(content)),
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (presentation_id, order_index)
);

CREATE INDEX slides_presentation_id_idx ON slides(presentation_id);

-- +goose Down
DROP INDEX IF EXISTS slides_presentation_id_idx;
DROP TABLE IF EXISTS slides;
DROP TABLE IF EXISTS presentations;
DROP TABLE IF EXISTS assets;

