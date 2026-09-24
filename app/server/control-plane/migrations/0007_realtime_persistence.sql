CREATE TABLE session_checkpoints (
  session_id TEXT NOT NULL REFERENCES presentation_sessions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 0),
  last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0),
  idempotency_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (session_id, version),
  UNIQUE (session_id, idempotency_key)
);

CREATE TABLE session_completions (
  session_id TEXT PRIMARY KEY REFERENCES presentation_sessions(id) ON DELETE CASCADE,
  checkpoint_version INTEGER NOT NULL CHECK (checkpoint_version >= 0),
  last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0),
  idempotency_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  participant_count INTEGER NOT NULL CHECK (participant_count BETWEEN 1 AND 50),
  participants TEXT NOT NULL,
  final_state TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (session_id, idempotency_key)
);
