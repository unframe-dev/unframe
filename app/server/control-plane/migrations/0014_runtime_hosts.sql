CREATE TABLE runtime_hosts (
  runtime_id TEXT PRIMARY KEY NOT NULL,
  endpoint TEXT NOT NULL,
  accepting INTEGER NOT NULL CHECK (accepting IN (0, 1)),
  last_seen_at TEXT NOT NULL,
  serving_session_id TEXT,
  serving_assignment_epoch INTEGER,
  CHECK ((serving_session_id IS NULL) = (serving_assignment_epoch IS NULL)),
  CHECK (serving_assignment_epoch IS NULL OR serving_assignment_epoch > 0)
);
