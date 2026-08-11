CREATE TABLE "user" (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL,
  image TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL,
  globalRole TEXT NOT NULL DEFAULT 'user' CHECK (globalRole IN ('admin', 'user'))
);

CREATE TABLE session (
  id TEXT NOT NULL PRIMARY KEY,
  expiresAt DATE NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE INDEX session_userId_idx ON session(userId);

CREATE TABLE account (
  id TEXT NOT NULL PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt DATE,
  refreshTokenExpiresAt DATE,
  scope TEXT,
  password TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);

CREATE INDEX account_userId_idx ON account(userId);

CREATE TABLE verification (
  id TEXT NOT NULL PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt DATE NOT NULL,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);

CREATE INDEX verification_identifier_idx ON verification(identifier);

CREATE TABLE deviceCode (
  id TEXT NOT NULL PRIMARY KEY,
  deviceCode TEXT NOT NULL,
  userCode TEXT NOT NULL,
  userId TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  expiresAt DATE NOT NULL,
  status TEXT NOT NULL,
  lastPolledAt DATE,
  pollingInterval INTEGER,
  clientId TEXT,
  scope TEXT
);

CREATE UNIQUE INDEX deviceCode_deviceCode_idx ON deviceCode(deviceCode);
CREATE UNIQUE INDEX deviceCode_userCode_idx ON deviceCode(userCode);
CREATE INDEX deviceCode_userId_idx ON deviceCode(userId);
