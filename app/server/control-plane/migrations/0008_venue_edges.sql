CREATE TABLE venue_edges (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  runtime_version TEXT,
  protocol_version TEXT,
  capacity INTEGER,
  local_endpoint TEXT,
  certificate_fingerprint TEXT,
  health TEXT,
  registered_at TEXT,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE venue_edge_credentials (
  edge_id TEXT NOT NULL REFERENCES venue_edges(id) ON DELETE CASCADE,
  token_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  PRIMARY KEY (edge_id, token_id)
);

CREATE INDEX venue_edge_credentials_token_id ON venue_edge_credentials(token_id);

CREATE TABLE session_edge_assignments (
  session_id TEXT NOT NULL REFERENCES presentation_sessions(id) ON DELETE CASCADE,
  edge_id TEXT NOT NULL REFERENCES venue_edges(id) ON DELETE RESTRICT,
  assignment_epoch INTEGER NOT NULL CHECK (assignment_epoch > 0),
  presentation_revision INTEGER NOT NULL CHECK (presentation_revision > 0),
  issued_at TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  released_at TEXT,
  PRIMARY KEY (session_id, assignment_epoch)
);

CREATE INDEX session_edge_assignments_active_lease
  ON session_edge_assignments(session_id, lease_expires_at, released_at);
CREATE INDEX session_edge_assignments_edge_id ON session_edge_assignments(edge_id);
