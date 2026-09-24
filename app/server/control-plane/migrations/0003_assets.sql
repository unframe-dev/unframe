CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  presentation_id TEXT NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'audio/mpeg', 'model/gltf-binary')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256_hex TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed', 'deleting')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX assets_unfinalized_created_at ON assets(status, created_at);
CREATE INDEX assets_presentation_id ON assets(presentation_id);

CREATE TABLE presentation_asset_refs (
  presentation_id TEXT NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  PRIMARY KEY (presentation_id, asset_id)
);

CREATE INDEX presentation_asset_refs_asset_id ON presentation_asset_refs(asset_id);

CREATE TRIGGER presentation_asset_refs_require_ready_local_asset
BEFORE INSERT ON presentation_asset_refs
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM assets
  WHERE id = NEW.asset_id AND presentation_id = NEW.presentation_id AND status = 'ready'
)
BEGIN
  SELECT RAISE(ABORT, 'presentation asset must be ready and belong to presentation');
END;

CREATE TRIGGER presentations_insert_asset_refs
AFTER INSERT ON presentations
FOR EACH ROW
BEGIN
  INSERT INTO presentation_asset_refs (presentation_id, asset_id)
  SELECT NEW.id, json_extract(value, '$.assetId') FROM json_each(NEW.definition, '$.assets');
END;

CREATE TRIGGER presentations_update_asset_refs
AFTER UPDATE OF definition ON presentations
FOR EACH ROW
BEGIN
  DELETE FROM presentation_asset_refs WHERE presentation_id = NEW.id;
  INSERT INTO presentation_asset_refs (presentation_id, asset_id)
  SELECT NEW.id, json_extract(value, '$.assetId') FROM json_each(NEW.definition, '$.assets');
END;
