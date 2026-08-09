CREATE TABLE presentations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  definition TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE presentation_members (
  presentation_id TEXT NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor')),
  PRIMARY KEY (presentation_id, user_id)
);

CREATE INDEX presentation_members_user_id ON presentation_members(user_id);
