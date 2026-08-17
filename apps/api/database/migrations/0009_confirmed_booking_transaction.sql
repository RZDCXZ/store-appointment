ALTER TABLE bookings
ADD COLUMN pet_name_snapshot text,
ADD COLUMN pet_species_snapshot text,
ADD COLUMN pet_weight_kg_snapshot numeric(5, 2),
ADD COLUMN pet_size_snapshot text,
ADD COLUMN primary_service_id_snapshot text,
ADD COLUMN primary_service_name_snapshot text,
ADD COLUMN primary_service_price_cents integer,
ADD COLUMN primary_service_duration_minutes smallint,
ADD COLUMN addon_snapshots jsonb,
ADD COLUMN required_skill_ids_snapshot jsonb,
ADD COLUMN total_price_cents integer,
ADD COLUMN staff_display_name_snapshot text,
ADD COLUMN turnover_minutes smallint,
ADD COLUMN original_starts_at timestamptz,
ADD COLUMN original_ends_at timestamptz,
ADD COLUMN original_occupancy_starts_at timestamptz,
ADD COLUMN original_occupancy_ends_at timestamptz,
ADD COLUMN verification_code_digest char(64);

UPDATE bookings AS booking
SET pet_name_snapshot = pet.name,
    pet_species_snapshot = pet.species,
    pet_weight_kg_snapshot = pet.weight_kg,
    pet_size_snapshot = CASE
      WHEN pet.weight_kg <= 10 THEN 'small'
      WHEN pet.weight_kg <= 25 THEN 'medium'
      ELSE 'large'
    END,
    primary_service_id_snapshot = CASE
      WHEN pet.species = 'cat' THEN 'cat-care'
      ELSE 'dog-basic-care'
    END,
    primary_service_name_snapshot = CASE
      WHEN pet.species = 'cat' THEN '猫咪洗护'
      ELSE '犬基础洗护'
    END,
    primary_service_price_cents = CASE
      WHEN pet.species = 'cat' AND pet.weight_kg <= 10 THEN 16800
      WHEN pet.species = 'cat' AND pet.weight_kg <= 25 THEN 21800
      WHEN pet.species = 'cat' THEN 28800
      WHEN pet.weight_kg <= 10 THEN 12800
      WHEN pet.weight_kg <= 25 THEN 16800
      ELSE 22800
    END,
    primary_service_duration_minutes = booking.service_duration_minutes,
    addon_snapshots = '[]'::jsonb,
    required_skill_ids_snapshot = jsonb_build_array(
      CASE WHEN pet.species = 'cat' THEN 'cat-care' ELSE 'dog-basic-care' END
    ),
    total_price_cents = CASE
      WHEN pet.species = 'cat' AND pet.weight_kg <= 10 THEN 16800
      WHEN pet.species = 'cat' AND pet.weight_kg <= 25 THEN 21800
      WHEN pet.species = 'cat' THEN 28800
      WHEN pet.weight_kg <= 10 THEN 12800
      WHEN pet.weight_kg <= 25 THEN 16800
      ELSE 22800
    END,
    staff_display_name_snapshot = account.display_name,
    turnover_minutes = (
      extract(epoch FROM (booking.occupancy_ends_at - booking.ends_at)) / 60
    )::smallint,
    original_starts_at = booking.starts_at,
    original_ends_at = booking.ends_at,
    original_occupancy_starts_at = booking.occupancy_starts_at,
    original_occupancy_ends_at = booking.occupancy_ends_at,
    verification_code_digest = repeat('0', 64)
FROM pets AS pet,
     backoffice_accounts AS account
WHERE pet.id = booking.pet_id
  AND account.id = booking.staff_id;

ALTER TABLE bookings
ALTER COLUMN pet_name_snapshot SET NOT NULL,
ALTER COLUMN pet_species_snapshot SET NOT NULL,
ALTER COLUMN pet_weight_kg_snapshot SET NOT NULL,
ALTER COLUMN pet_size_snapshot SET NOT NULL,
ALTER COLUMN primary_service_id_snapshot SET NOT NULL,
ALTER COLUMN primary_service_name_snapshot SET NOT NULL,
ALTER COLUMN primary_service_price_cents SET NOT NULL,
ALTER COLUMN primary_service_duration_minutes SET NOT NULL,
ALTER COLUMN addon_snapshots SET NOT NULL,
ALTER COLUMN required_skill_ids_snapshot SET NOT NULL,
ALTER COLUMN total_price_cents SET NOT NULL,
ALTER COLUMN staff_display_name_snapshot SET NOT NULL,
ALTER COLUMN turnover_minutes SET NOT NULL,
ALTER COLUMN original_starts_at SET NOT NULL,
ALTER COLUMN original_ends_at SET NOT NULL,
ALTER COLUMN original_occupancy_starts_at SET NOT NULL,
ALTER COLUMN original_occupancy_ends_at SET NOT NULL,
ALTER COLUMN verification_code_digest SET NOT NULL,
ADD CONSTRAINT bookings_pet_species_snapshot_check CHECK (pet_species_snapshot IN ('dog', 'cat')),
ADD CONSTRAINT bookings_pet_size_snapshot_check CHECK (pet_size_snapshot IN ('small', 'medium', 'large')),
ADD CONSTRAINT bookings_snapshot_amounts_check CHECK (
  pet_weight_kg_snapshot > 0
  AND primary_service_price_cents >= 0
  AND primary_service_duration_minutes > 0
  AND total_price_cents >= primary_service_price_cents
  AND turnover_minutes >= 0
),
ADD CONSTRAINT bookings_snapshot_json_check CHECK (
  jsonb_typeof(addon_snapshots) = 'array'
  AND jsonb_typeof(required_skill_ids_snapshot) = 'array'
),
ADD CONSTRAINT bookings_original_intervals_check CHECK (
  original_starts_at < original_ends_at
  AND original_occupancy_starts_at <= original_starts_at
  AND original_ends_at <= original_occupancy_ends_at
),
ADD CONSTRAINT bookings_verification_code_digest_check CHECK (
  verification_code_digest ~ '^[0-9a-f]{64}$'
);

CREATE TABLE booking_idempotency_keys (
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  command_type text NOT NULL CHECK (command_type IN ('create_booking')),
  idempotency_key varchar(128) NOT NULL CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
  ),
  request_digest char(64) NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  booking_id text NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, command_type, idempotency_key)
);

CREATE TABLE booking_events (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('booking_confirmed')),
  actor_type text NOT NULL CHECK (actor_type IN ('customer', 'staff', 'manager', 'system')),
  actor_id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL
);

CREATE INDEX booking_events_booking_time_idx ON booking_events (booking_id, occurred_at, id);

CREATE TABLE audit_events (
  id text PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN ('booking_created')),
  actor_type text NOT NULL CHECK (actor_type IN ('customer', 'staff', 'manager', 'system')),
  actor_id text NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('booking')),
  subject_id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL
);

CREATE INDEX audit_events_subject_time_idx
ON audit_events (subject_type, subject_id, occurred_at, id);

CREATE TABLE notification_outbox (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  notification_type text NOT NULL CHECK (notification_type IN ('booking_confirmed')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'sent', 'retry', 'failed')
  ),
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  available_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (booking_id, notification_type)
);

CREATE INDEX notification_outbox_pending_idx
ON notification_outbox (available_at, id)
WHERE status IN ('pending', 'retry');

COMMENT ON TABLE booking_idempotency_keys IS
  'Customer-scoped command results; only the booking identity is retained, never the plaintext verification code.';
COMMENT ON COLUMN bookings.verification_code_digest IS
  'Keyed irreversible digest of the six-digit verification code; plaintext is never persisted.';
COMMENT ON TABLE booking_events IS
  'Application-append-only booking lifecycle facts.';
COMMENT ON TABLE audit_events IS
  'Application-append-only audit facts; database immutability is introduced by the dedicated audit ticket.';
COMMENT ON TABLE notification_outbox IS
  'Transactional notification work written in the same transaction as the booking fact.';
