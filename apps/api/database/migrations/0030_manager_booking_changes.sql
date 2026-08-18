CREATE TABLE manager_booking_change_idempotency_keys (
  manager_id text NOT NULL REFERENCES backoffice_accounts(id) ON DELETE RESTRICT,
  command_type text NOT NULL CHECK (
    command_type IN ('manager_reschedule', 'manager_cancel')
  ),
  idempotency_key varchar(128) NOT NULL CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
  ),
  request_digest char(64) NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  booking_id text REFERENCES bookings(id) ON DELETE CASCADE,
  response_status smallint NOT NULL CHECK (response_status BETWEEN 200 AND 599),
  response_body jsonb NOT NULL CHECK (jsonb_typeof(response_body) = 'object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (manager_id, command_type, idempotency_key),
  CONSTRAINT manager_booking_change_idempotency_result_check CHECK (
    (booking_id IS NOT NULL AND response_status BETWEEN 200 AND 299)
    OR (booking_id IS NULL AND response_status BETWEEN 400 AND 599)
  )
);

COMMENT ON TABLE manager_booking_change_idempotency_keys IS
  'Manager-scoped first-result snapshots for reschedule and cancellation retries; verification-code plaintext is never retained.';

ALTER TABLE audit_events
DROP CONSTRAINT audit_events_event_type_check,
ADD CONSTRAINT audit_events_event_type_check CHECK (
  event_type IN (
    'booking_created',
    'customer_booking_cancelled',
    'customer_booking_rescheduled',
    'customer_phone_revealed',
    'manager_booking_cancelled',
    'manager_booking_rescheduled'
  )
);
