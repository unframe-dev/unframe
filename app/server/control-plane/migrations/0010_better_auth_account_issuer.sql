CREATE TABLE account_with_issuer (
  id TEXT NOT NULL PRIMARY KEY,
  issuer TEXT NOT NULL,
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

INSERT INTO account_with_issuer (
  id,
  issuer,
  accountId,
  providerId,
  userId,
  accessToken,
  refreshToken,
  idToken,
  accessTokenExpiresAt,
  refreshTokenExpiresAt,
  scope,
  password,
  createdAt,
  updatedAt
)
SELECT
  id,
  CASE providerId
    WHEN 'credential' THEN 'local:credential'
    WHEN 'google' THEN 'https://accounts.google.com'
    ELSE 'local:oauth:' || providerId
  END,
  accountId,
  providerId,
  userId,
  accessToken,
  refreshToken,
  idToken,
  accessTokenExpiresAt,
  refreshTokenExpiresAt,
  scope,
  password,
  createdAt,
  updatedAt
FROM account;

DROP TABLE account;
ALTER TABLE account_with_issuer RENAME TO account;

CREATE INDEX account_userId_idx ON account(userId);
CREATE UNIQUE INDEX account_issuer_accountId_uidx ON account(issuer, accountId);
