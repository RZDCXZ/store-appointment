ALTER TABLE bookings
ADD COLUMN verification_code_seed text;

UPDATE bookings AS booking
SET verification_code_seed = COALESCE(
  (
    SELECT idempotency.idempotency_key
    FROM booking_idempotency_keys AS idempotency
    WHERE idempotency.booking_id = booking.id
    ORDER BY idempotency.created_at, idempotency.idempotency_key
    LIMIT 1
  ),
  booking.id
);

ALTER TABLE bookings
ALTER COLUMN verification_code_seed SET NOT NULL,
ADD CONSTRAINT bookings_verification_code_seed_check CHECK (
  char_length(verification_code_seed) BETWEEN 2 AND 128
);

COMMENT ON COLUMN bookings.verification_code_seed IS
  'Non-secret deterministic input for code recovery and rotation; never a reusable verification code.';
