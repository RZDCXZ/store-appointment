CREATE TABLE booking_fulfilment_idempotency_keys (
  actor_id text NOT NULL REFERENCES backoffice_accounts(id) ON DELETE RESTRICT,
  command_type text NOT NULL CHECK (
    command_type IN ('check_in', 'late_check_in', 'no_show')
  ),
  idempotency_key varchar(128) NOT NULL CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
  ),
  booking_id text NOT NULL,
  request_digest char(64) NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  response_body jsonb NOT NULL CHECK (jsonb_typeof(response_body) = 'object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (actor_id, command_type, idempotency_key)
);

COMMENT ON TABLE booking_fulfilment_idempotency_keys IS
  'Backoffice-scoped first success snapshots for retryable booking fulfilment commands.';
COMMENT ON COLUMN booking_fulfilment_idempotency_keys.response_body IS
  'The first fulfilment result; verification-code plaintext is never retained.';
