CREATE INDEX IF NOT EXISTS assets_unfinalized_expires_at ON assets(status, expires_at);
