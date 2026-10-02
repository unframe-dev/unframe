CREATE TABLE presentation_builds (
  presentation_id TEXT NOT NULL REFERENCES presentations(id) ON DELETE RESTRICT,
  build_id TEXT NOT NULL,
  target_revision INTEGER NOT NULL CHECK (target_revision > 0),
  artifacts TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (presentation_id, build_id)
);

CREATE TABLE presentation_publications (
  presentation_id TEXT NOT NULL REFERENCES presentations(id) ON DELETE RESTRICT,
  epoch INTEGER NOT NULL CHECK (epoch > 0),
  build_id TEXT NOT NULL,
  manifest TEXT NOT NULL,
  published_at TEXT NOT NULL,
  PRIMARY KEY (presentation_id, epoch),
  FOREIGN KEY (presentation_id, build_id)
    REFERENCES presentation_builds(presentation_id, build_id) ON DELETE RESTRICT
);

CREATE INDEX presentation_publications_latest
  ON presentation_publications(presentation_id, epoch DESC);

ALTER TABLE presentation_sessions ADD COLUMN publication_epoch INTEGER;

CREATE TABLE session_participant_capabilities (
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  capability_profile_id TEXT NOT NULL,
  capability_json TEXT NOT NULL,
  projection_profile_id TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  PRIMARY KEY (session_id, user_id),
  FOREIGN KEY (session_id, user_id)
    REFERENCES session_participants(session_id, user_id) ON DELETE CASCADE
);
