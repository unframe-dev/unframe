CREATE TABLE anonymous_viewer_credentials (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES presentation_sessions(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  renewable_until TEXT NOT NULL,
  revoked_at TEXT
);
