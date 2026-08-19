CREATE TABLE pet_photo_deletion_outbox (
  id text PRIMARY KEY,
  storage_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);

COMMENT ON TABLE pet_photo_deletion_outbox IS
  'Identity-free durable work for deleting detached local pet-photo files after privacy transactions commit.';
