CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE bookings
ADD COLUMN occupancy_starts_at timestamptz,
ADD COLUMN occupancy_ends_at timestamptz;

UPDATE bookings
SET occupancy_starts_at = starts_at,
    occupancy_ends_at = ends_at + interval '15 minutes';

ALTER TABLE bookings
ALTER COLUMN staff_id SET NOT NULL,
ALTER COLUMN service_duration_minutes SET NOT NULL,
ALTER COLUMN occupancy_starts_at SET NOT NULL,
ALTER COLUMN occupancy_ends_at SET NOT NULL,
ADD CONSTRAINT bookings_occupancy_bounds_check CHECK (
  occupancy_starts_at <= starts_at
  AND ends_at <= occupancy_ends_at
  AND occupancy_ends_at > occupancy_starts_at
),
ADD CONSTRAINT bookings_staff_occupancy_exclusion EXCLUDE USING gist (
  staff_id WITH =,
  tstzrange(occupancy_starts_at, occupancy_ends_at, '[)') WITH &&
) WHERE (status NOT IN ('cancelled', 'no_show')),
ADD CONSTRAINT bookings_pet_service_exclusion EXCLUDE USING gist (
  pet_id WITH =,
  tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (status NOT IN ('cancelled', 'no_show'));

CREATE TABLE staff_time_off_intervals (
  id text PRIMARY KEY,
  staff_id text NOT NULL REFERENCES staff_members(id) ON DELETE RESTRICT,
  local_date date NOT NULL,
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'active', 'cancelled')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX staff_time_off_capacity_idx
ON staff_time_off_intervals (local_date, staff_id, starts_at, ends_at)
WHERE status IN ('pending', 'active');

CREATE TABLE store_closure_intervals (
  id text PRIMARY KEY,
  local_date date NOT NULL,
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'active', 'cancelled')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX store_closure_capacity_idx
ON store_closure_intervals (local_date, starts_at, ends_at)
WHERE status IN ('pending', 'active');

COMMENT ON COLUMN bookings.occupancy_starts_at IS
  'Independent actual employee-capacity occupation start used by PostgreSQL exclusion.';
COMMENT ON COLUMN bookings.occupancy_ends_at IS
  'Independent actual employee-capacity occupation end including turnover.';
COMMENT ON TABLE staff_time_off_intervals IS
  'Employee-specific capacity blocks; both pending and active facts stop new bookings.';
COMMENT ON TABLE store_closure_intervals IS
  'Store-wide closure facts; never represented as duplicated employee time off.';
