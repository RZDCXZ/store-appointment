ALTER TABLE booking_fulfilment_idempotency_keys
ADD COLUMN response_status smallint;

UPDATE booking_fulfilment_idempotency_keys
SET response_status = 201;

ALTER TABLE booking_fulfilment_idempotency_keys
ALTER COLUMN response_status SET NOT NULL,
ALTER COLUMN booking_id DROP NOT NULL,
ADD CONSTRAINT booking_fulfilment_idempotency_response_status_check CHECK (
  response_status BETWEEN 100 AND 599
);

COMMENT ON TABLE booking_fulfilment_idempotency_keys IS
  'Backoffice-scoped first result snapshots for retryable booking fulfilment commands.';
COMMENT ON COLUMN booking_fulfilment_idempotency_keys.booking_id IS
  'Referenced booking when it exists; null permits a stable not-found result.';
COMMENT ON COLUMN booking_fulfilment_idempotency_keys.response_body IS
  'The first success or business-error response; verification-code plaintext is never retained.';
