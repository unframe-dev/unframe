-- name: GetSingletonPresentationID :one
SELECT id
FROM presentations
ORDER BY created_at ASC
LIMIT 1;

-- name: CreatePresentation :exec
INSERT INTO presentations (id, title, thumbnail_asset_id, created_at, updated_at)
VALUES (?, ?, ?, ?, ?);

-- name: GetPresentation :one
SELECT id, title, thumbnail_asset_id, created_at, updated_at
FROM presentations
WHERE id = ?;

-- name: ListPresentations :many
SELECT id, title, thumbnail_asset_id, created_at, updated_at
FROM presentations
ORDER BY created_at DESC;

-- name: UpdatePresentation :exec
UPDATE presentations
SET
    title = CASE WHEN sqlc.arg(set_title) THEN sqlc.arg(title) ELSE title END,
    thumbnail_asset_id = CASE
        WHEN sqlc.arg(set_thumbnail_asset_id) THEN sqlc.narg(thumbnail_asset_id)
        ELSE thumbnail_asset_id
    END,
    updated_at = sqlc.arg(updated_at)
WHERE id = sqlc.arg(id);

-- name: DeletePresentationSlides :exec
DELETE FROM slides
WHERE presentation_id = ?;

-- name: CreateSlide :exec
INSERT INTO slides (id, presentation_id, order_index, content)
VALUES (?, ?, ?, ?);

-- name: ListPresentationSlides :many
SELECT id, order_index, content, updated_at
FROM slides
WHERE presentation_id = ?
ORDER BY order_index ASC;
