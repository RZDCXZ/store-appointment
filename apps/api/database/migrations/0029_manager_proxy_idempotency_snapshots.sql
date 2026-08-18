ALTER TABLE manager_proxy_booking_idempotency_keys
  ALTER COLUMN booking_id DROP NOT NULL,
  ADD COLUMN response_status smallint NOT NULL DEFAULT 201,
  ADD COLUMN response_body jsonb NOT NULL DEFAULT '{"kind":"manager_proxy_booking_legacy_success"}'::jsonb;

ALTER TABLE manager_proxy_booking_idempotency_keys
  ALTER COLUMN response_status DROP DEFAULT,
  ALTER COLUMN response_body DROP DEFAULT,
  ADD CONSTRAINT manager_proxy_booking_idempotency_result_check CHECK (
    (
      booking_id IS NOT NULL
      AND response_status BETWEEN 200 AND 299
    )
    OR (
      booking_id IS NULL
      AND response_status BETWEEN 400 AND 599
    )
  );

COMMENT ON TABLE manager_proxy_booking_idempotency_keys IS
  'Manager-scoped first-result snapshots for proxy-booking retries; verification codes are re-derived and never stored as plaintext.';
