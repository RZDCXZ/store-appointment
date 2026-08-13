CREATE TABLE app_metadata (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app_metadata IS 'Local demo metadata populated by the explicit seed command.';
