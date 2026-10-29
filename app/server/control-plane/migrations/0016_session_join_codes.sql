ALTER TABLE presentation_sessions ADD COLUMN join_code TEXT;
CREATE INDEX presentation_sessions_presenter_created ON presentation_sessions(presenter_id, created_at DESC, id DESC);
