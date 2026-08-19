ALTER TABLE notification_outbox
DROP CONSTRAINT notification_outbox_attempt_count_check,
ADD CONSTRAINT notification_outbox_attempt_count_check CHECK (attempt_count >= 0),
ADD COLUMN simulated_failures_remaining smallint NOT NULL DEFAULT 0 CHECK (
  simulated_failures_remaining BETWEEN 0 AND 50
);

CREATE TABLE notification_delivery_attempts (
  id text PRIMARY KEY,
  notification_id text NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  mode text NOT NULL CHECK (mode IN ('automatic', 'manual')),
  result text NOT NULL CHECK (result IN ('sent', 'failed')),
  detail text NOT NULL,
  attempted_at timestamptz NOT NULL,
  UNIQUE (notification_id, attempt_number)
);

COMMENT ON TABLE notification_delivery_attempts IS
  'Immutable observable results for every simulated WeChat delivery attempt.';
