ALTER TABLE bookings
ADD COLUMN staff_id text REFERENCES staff_members(id) ON DELETE RESTRICT,
ADD COLUMN service_duration_minutes smallint CHECK (service_duration_minutes > 0);

UPDATE bookings
SET staff_id = 'chenjia',
    service_duration_minutes = 90
WHERE id = 'booking-bohe-future';

CREATE INDEX bookings_staff_capacity_idx
ON bookings (staff_id, starts_at, ends_at)
WHERE staff_id IS NOT NULL AND status NOT IN ('cancelled', 'no_show');

COMMENT ON COLUMN bookings.staff_id IS
  'Employee whose real capacity is occupied; nullable only for booking facts created before capacity assignment existed.';
COMMENT ON COLUMN bookings.service_duration_minutes IS
  'Planned customer-visible service minutes used for deterministic fastest-available workload ties.';
