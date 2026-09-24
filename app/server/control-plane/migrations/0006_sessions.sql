CREATE TABLE presentation_sessions (
  id TEXT PRIMARY KEY,
  presentation_id TEXT NOT NULL REFERENCES presentations(id) ON DELETE RESTRICT,
  presenter_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  join_code_hash TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('Waiting', 'Presenting', 'Ended')),
  participant_count INTEGER NOT NULL DEFAULT 1 CHECK (participant_count BETWEEN 1 AND 50),
  max_participants INTEGER NOT NULL DEFAULT 50 CHECK (max_participants = 50),
  created_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE INDEX presentation_sessions_presentation_id ON presentation_sessions(presentation_id);

CREATE TABLE session_participants (
  session_id TEXT NOT NULL REFERENCES presentation_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('presenter', 'viewer')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (session_id, user_id)
);

CREATE INDEX session_participants_session_id ON session_participants(session_id);

CREATE TABLE session_join_attempts (
  code_hash TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);

CREATE INDEX session_join_attempts_code ON session_join_attempts(code_hash, attempted_at);
CREATE INDEX session_join_attempts_user ON session_join_attempts(user_id, attempted_at);
CREATE INDEX session_join_attempts_ip ON session_join_attempts(ip_address, attempted_at);
