ALTER TABLE bookings
ADD COLUMN verification_code_version smallint NOT NULL DEFAULT 1,
ADD COLUMN completed_at timestamptz,
ADD CONSTRAINT bookings_verification_code_version_check CHECK (verification_code_version > 0),
ADD CONSTRAINT bookings_completed_at_check CHECK (
  completed_at IS NULL OR status = 'completed'
);

COMMENT ON COLUMN bookings.verification_code_version IS
  'Non-secret rotation counter used with the server secret to reconstruct the current one-time code.';
COMMENT ON COLUMN bookings.completed_at IS
  'Customer-visible actual completion time; internal service records remain in their own boundary.';
