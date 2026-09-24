ALTER TABLE "user" ADD COLUMN twoFactorEnabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session ADD COLUMN assurance TEXT NOT NULL DEFAULT 'none';

CREATE TABLE twoFactor (
  id TEXT NOT NULL PRIMARY KEY,
  secret TEXT NOT NULL,
  backupCodes TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  verified INTEGER NOT NULL DEFAULT 1,
  failedVerificationCount INTEGER NOT NULL DEFAULT 0,
  lockedUntil DATE
);

CREATE INDEX twoFactor_secret_idx ON twoFactor(secret);
CREATE INDEX twoFactor_userId_idx ON twoFactor(userId);
