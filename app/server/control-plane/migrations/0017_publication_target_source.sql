ALTER TABLE presentations ADD COLUMN source_presentation_id TEXT;

UPDATE presentations SET source_presentation_id = id;

CREATE UNIQUE INDEX presentations_owner_source_id
ON presentations(owner_id, source_presentation_id);

CREATE TRIGGER presentations_default_source_id
AFTER INSERT ON presentations
FOR EACH ROW
WHEN NEW.source_presentation_id IS NULL
BEGIN
  UPDATE presentations SET source_presentation_id = NEW.id WHERE id = NEW.id;
END;
