ALTER TABLE presentations ADD COLUMN name TEXT NOT NULL DEFAULT 'Untitled';

UPDATE presentations
SET name = CASE WHEN json_valid(definition)
  THEN COALESCE(NULLIF(json_extract(definition, '$.metadata.title'), ''), id)
  ELSE id END;
