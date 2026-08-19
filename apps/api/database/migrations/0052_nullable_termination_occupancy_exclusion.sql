ALTER TABLE bookings
DROP CONSTRAINT bookings_staff_occupancy_exclusion,
ADD CONSTRAINT bookings_staff_occupancy_exclusion EXCLUDE USING gist (
  staff_id WITH =,
  tstzrange(occupancy_starts_at, occupancy_ends_at, '[)') WITH &&
) WHERE (
  status NOT IN ('cancelled', 'no_show')
  AND occupancy_starts_at IS NOT NULL
  AND occupancy_ends_at IS NOT NULL
);

COMMENT ON CONSTRAINT bookings_staff_occupancy_exclusion ON bookings IS
  'Only bookings with a concrete remaining employee-occupancy interval participate in overlap exclusion.';
