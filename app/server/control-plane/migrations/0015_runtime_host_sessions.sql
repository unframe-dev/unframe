CREATE TABLE runtime_hosts_next (
  runtime_id TEXT PRIMARY KEY NOT NULL,
  endpoint TEXT NOT NULL,
  accepting INTEGER NOT NULL CHECK (accepting IN (0, 1)),
  last_seen_at TEXT NOT NULL,
  boot_id TEXT NOT NULL,
  boot_started_at TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 0),
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 256)
);
INSERT INTO runtime_hosts_next (runtime_id, endpoint, accepting, last_seen_at, boot_id, boot_started_at, generation, capacity)
  SELECT runtime_id, endpoint, 0, last_seen_at, '', '', 0, 1 FROM runtime_hosts;
DROP TABLE runtime_hosts;
ALTER TABLE runtime_hosts_next RENAME TO runtime_hosts;
ALTER TABLE runtime_assignments ADD COLUMN host_generation INTEGER;
ALTER TABLE runtime_assignments ADD COLUMN execution_state TEXT NOT NULL DEFAULT 'starting' CHECK (execution_state IN ('starting', 'recovering', 'ready', 'stopping', 'stopped', 'failed'));
CREATE INDEX runtime_assignments_host_generation ON runtime_assignments (runtime_id, host_generation, session_id, epoch);
ALTER TABLE runtime_assignments ADD COLUMN execution_boot_id TEXT;
