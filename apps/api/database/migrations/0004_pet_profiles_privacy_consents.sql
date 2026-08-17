CREATE TABLE pet_photos (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png')),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 524288),
  storage_key text NOT NULL UNIQUE,
  public_path text NOT NULL UNIQUE CHECK (public_path LIKE '/uploads/pets/%'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pets (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 30),
  species text NOT NULL CHECK (species IN ('dog', 'cat')),
  weight_kg numeric(5, 2) NOT NULL CHECK (weight_kg BETWEEN 0.1 AND 99.99),
  breed text CHECK (breed IS NULL OR char_length(btrim(breed)) BETWEEN 1 AND 50),
  sex text CHECK (sex IS NULL OR sex IN ('male', 'female')),
  birth_date date,
  coat_type text CHECK (
    coat_type IS NULL OR coat_type IN ('short', 'long', 'double', 'curly', 'hairless', 'other')
  ),
  seed_photo_path text,
  photo_id text REFERENCES pet_photos(id) ON DELETE SET NULL,
  care_notes text CHECK (care_notes IS NULL OR char_length(care_notes) <= 500),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, customer_id)
);

CREATE INDEX pets_customer_archived_idx ON pets (customer_id, archived_at, created_at);

CREATE TABLE pet_care_tags (
  pet_id text NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  tag text NOT NULL CHECK (
    tag IN ('怕吹风', '对陌生犬敏感', '不喜欢碰脚', '易紧张', '需要慢速吹干', '耳部需轻柔')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pet_id, tag)
);

CREATE TABLE bookings (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  pet_id text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL CHECK (
    status IN ('confirmed', 'checked_in', 'completed', 'terminated', 'cancelled', 'no_show')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  FOREIGN KEY (pet_id, customer_id) REFERENCES pets(id, customer_id) ON DELETE RESTRICT
);

CREATE INDEX bookings_pet_future_idx ON bookings (pet_id, starts_at)
WHERE status IN ('confirmed', 'checked_in');

CREATE TABLE privacy_notices (
  version text PRIMARY KEY CHECK (version ~ '^[0-9]{4}\.[0-9]{2}$'),
  title text NOT NULL,
  summary text NOT NULL,
  published_at timestamptz NOT NULL,
  is_current boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX privacy_notices_one_current_idx ON privacy_notices (is_current)
WHERE is_current;

CREATE TABLE privacy_consents (
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  notice_version text NOT NULL REFERENCES privacy_notices(version) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('miniapp_booking', 'manager_offline')),
  consented_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, notice_version)
);

COMMENT ON TABLE pets IS 'Current customer-maintained pet profile; size is derived from current weight rather than stored.';
COMMENT ON TABLE pet_care_tags IS 'Structured care information for fulfilment safety and preferences; never a medical diagnosis.';
COMMENT ON TABLE bookings IS 'Booking identity and pet/time link introduced for archive safety; later booking slices add service and capacity facts.';
COMMENT ON TABLE privacy_consents IS 'Append-only customer consent fact for a specific privacy notice version and source.';
