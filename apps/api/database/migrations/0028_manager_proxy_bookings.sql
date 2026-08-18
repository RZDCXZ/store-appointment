CREATE TABLE manager_proxy_booking_records (
  booking_id text PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  privacy_notice_version text NOT NULL REFERENCES privacy_notices(version) ON DELETE RESTRICT,
  offline_consent_source text NOT NULL CHECK (
    offline_consent_source IN ('phone', 'chat', 'in_store')
  ),
  manager_id text NOT NULL REFERENCES backoffice_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL
);

CREATE TABLE manager_proxy_booking_idempotency_keys (
  manager_id text NOT NULL REFERENCES backoffice_accounts(id) ON DELETE RESTRICT,
  idempotency_key varchar(128) NOT NULL CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
  ),
  request_digest char(64) NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  booking_id text NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (manager_id, idempotency_key)
);

COMMENT ON TABLE manager_proxy_booking_records IS
  'Manager-created booking fact recording the current privacy notice, offline confirmation channel, and executing manager.';

COMMENT ON TABLE manager_proxy_booking_idempotency_keys IS
  'Manager-scoped idempotent proxy-booking command result; plaintext verification codes are never stored.';
