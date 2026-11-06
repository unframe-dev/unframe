CREATE TABLE presentation_build_cleanup (
  presentation_id TEXT PRIMARY KEY NOT NULL,
  available_at TEXT NOT NULL
);

CREATE INDEX presentation_build_cleanup_available_at
ON presentation_build_cleanup(available_at, presentation_id);

CREATE TRIGGER presentations_wait_for_build_cleanup
BEFORE INSERT ON presentations
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM presentation_build_cleanup WHERE presentation_id = NEW.id
)
BEGIN
  SELECT RAISE(IGNORE);
END;
