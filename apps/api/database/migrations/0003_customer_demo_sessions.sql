CREATE TABLE customers (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  phone varchar(11) NOT NULL CHECK (phone ~ '^1[3-9][0-9]{9}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE demo_customer_profiles (
  customer_id text PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  demo_key text NOT NULL UNIQUE CHECK (demo_key ~ '^[a-z0-9-]+$'),
  story text NOT NULL CHECK (story IN ('正常预约', '已有未来预约', '取消或爽约历史')),
  sort_order smallint NOT NULL UNIQUE CHECK (sort_order BETWEEN 1 AND 3)
);

CREATE TABLE customer_sessions (
  token_hash char(64) PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX customer_sessions_customer_id_idx ON customer_sessions (customer_id);
CREATE INDEX customer_sessions_expires_at_idx ON customer_sessions (expires_at);

COMMENT ON TABLE demo_customer_profiles IS 'Three explicitly labelled local-demo customer shortcuts; not real WeChat identities.';
COMMENT ON TABLE customer_sessions IS 'Short-lived server-issued mini-program Bearer sessions stored by opaque token hash.';
