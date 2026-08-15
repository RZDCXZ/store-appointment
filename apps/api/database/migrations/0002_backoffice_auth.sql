CREATE TABLE backoffice_accounts (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('manager', 'staff')),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE backoffice_sessions (
  token_hash char(64) PRIMARY KEY,
  account_id text NOT NULL REFERENCES backoffice_accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX backoffice_sessions_account_id_idx ON backoffice_sessions (account_id);
CREATE INDEX backoffice_sessions_expires_at_idx ON backoffice_sessions (expires_at);

COMMENT ON TABLE backoffice_accounts IS 'Local demo manager and employee identities; passwords are stored only as scrypt hashes.';
COMMENT ON TABLE backoffice_sessions IS 'Server-side backoffice sessions addressed by a hash of the opaque Cookie token.';
