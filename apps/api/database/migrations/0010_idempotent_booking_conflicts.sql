ALTER TABLE booking_idempotency_keys
ALTER COLUMN booking_id DROP NOT NULL,
ADD COLUMN response_status smallint,
ADD COLUMN response_body jsonb,
ADD CONSTRAINT booking_idempotency_result_check CHECK (
  (
    booking_id IS NOT NULL
    AND response_status IS NULL
    AND response_body IS NULL
  )
  OR
  (
    booking_id IS NULL
    AND response_status BETWEEN 400 AND 599
    AND jsonb_typeof(response_body) = 'object'
  )
);

COMMENT ON COLUMN booking_idempotency_keys.response_body IS
  'First stable business-error response for an idempotent command; successful verification codes are never stored.';
