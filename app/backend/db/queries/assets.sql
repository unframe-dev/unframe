-- name: CreateAsset :one
INSERT INTO assets (id, filename, mime_type, size_bytes, storage_key)
VALUES (?, ?, ?, ?, ?)
RETURNING id, filename, mime_type, size_bytes, storage_key, created_at;

-- name: GetAsset :one
SELECT id, filename, mime_type, size_bytes, storage_key, created_at
FROM assets
WHERE id = ?;

-- name: ListAssetsByIDs :many
SELECT id, filename, mime_type, size_bytes, storage_key, created_at
FROM assets
WHERE id IN (sqlc.slice('ids'));
