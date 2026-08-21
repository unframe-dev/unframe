ALTER TABLE venue_edges ADD COLUMN runtime_id TEXT;
CREATE UNIQUE INDEX venue_edges_runtime_id ON venue_edges(runtime_id) WHERE runtime_id IS NOT NULL;

CREATE TABLE runtime_assignments (
  session_id TEXT NOT NULL REFERENCES presentation_sessions(id) ON DELETE CASCADE,
  runtime_id TEXT NOT NULL,
  runtime_kind TEXT NOT NULL CHECK (runtime_kind IN ('Cloud', 'VenueEdge')),
  endpoint TEXT NOT NULL,
  certificate_fingerprint TEXT,
  provisioning_edge_id TEXT REFERENCES venue_edges(id) ON DELETE RESTRICT,
  epoch INTEGER NOT NULL CHECK (epoch > 0),
  revision INTEGER NOT NULL CHECK (revision > 0),
  issued_at TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  released_at TEXT,
  PRIMARY KEY (session_id, epoch),
  CHECK ((runtime_kind = 'VenueEdge') = (provisioning_edge_id IS NOT NULL))
);

INSERT INTO runtime_assignments (
  session_id, runtime_id, runtime_kind, endpoint, certificate_fingerprint,
  provisioning_edge_id, epoch, revision, issued_at, lease_expires_at, released_at
)
SELECT assignment.session_id, assignment.edge_id, 'VenueEdge', edge.local_endpoint,
  edge.certificate_fingerprint, assignment.edge_id, assignment.assignment_epoch,
  assignment.presentation_revision, assignment.issued_at, assignment.lease_expires_at,
  COALESCE(assignment.released_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM session_edge_assignments AS assignment
JOIN venue_edges AS edge ON edge.id = assignment.edge_id;

CREATE INDEX runtime_assignments_active_lease
  ON runtime_assignments(session_id, lease_expires_at, released_at);
CREATE INDEX runtime_assignments_provisioning_edge_id
  ON runtime_assignments(provisioning_edge_id);

DROP TABLE session_edge_assignments;
