ALTER TABLE booking_fulfilment_idempotency_keys
DROP CONSTRAINT booking_fulfilment_idempotency_keys_command_type_check,
ADD CONSTRAINT booking_fulfilment_idempotency_keys_command_type_check CHECK (
  command_type IN ('check_in', 'late_check_in', 'no_show', 'complete')
);

ALTER TABLE booking_events
DROP CONSTRAINT booking_events_event_type_check,
ADD CONSTRAINT booking_events_event_type_check CHECK (
  event_type IN (
    'booking_confirmed',
    'booking_cancelled',
    'booking_rescheduled',
    'booking_checked_in',
    'booking_late_checked_in',
    'booking_no_show',
    'booking_completed'
  )
);

ALTER TABLE bookings
DROP CONSTRAINT bookings_occupancy_bounds_check,
ADD CONSTRAINT bookings_occupancy_bounds_check CHECK (
  (
    status = 'cancelled'
    AND occupancy_starts_at IS NULL
    AND occupancy_ends_at IS NULL
  )
  OR
  (
    status IN ('no_show', 'completed', 'terminated')
    AND occupancy_starts_at IS NOT NULL
    AND occupancy_ends_at IS NOT NULL
    AND occupancy_starts_at <= starts_at
    AND occupancy_ends_at > occupancy_starts_at
    AND occupancy_ends_at <= original_occupancy_ends_at
  )
  OR
  (
    status IN ('confirmed', 'checked_in')
    AND occupancy_starts_at IS NOT NULL
    AND occupancy_ends_at IS NOT NULL
    AND occupancy_starts_at <= starts_at
    AND ends_at <= occupancy_ends_at
    AND occupancy_ends_at > occupancy_starts_at
  )
);

CREATE TABLE store_service_records (
  id text PRIMARY KEY,
  booking_id text NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
  pet_snapshot jsonb NOT NULL CHECK (jsonb_typeof(pet_snapshot) = 'object'),
  primary_service_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(primary_service_snapshot) = 'object'
  ),
  addon_snapshots jsonb NOT NULL CHECK (jsonb_typeof(addon_snapshots) = 'array'),
  staff_snapshot jsonb NOT NULL CHECK (jsonb_typeof(staff_snapshot) = 'object'),
  actual_starts_at timestamptz NOT NULL,
  actual_ends_at timestamptz NOT NULL,
  care_tags jsonb NOT NULL CHECK (jsonb_typeof(care_tags) = 'array'),
  internal_text text CHECK (
    internal_text IS NULL OR char_length(internal_text) BETWEEN 1 AND 1000
  ),
  created_at timestamptz NOT NULL,
  CHECK (actual_ends_at >= actual_starts_at)
);

COMMENT ON TABLE store_service_records IS
  'Immutable internal record generated exactly once when a checked-in booking is completed.';

CREATE FUNCTION reject_store_service_record_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'store service records are immutable';
END;
$$;

CREATE TRIGGER store_service_records_reject_update
BEFORE UPDATE ON store_service_records
FOR EACH ROW EXECUTE FUNCTION reject_store_service_record_change();

CREATE TRIGGER store_service_records_reject_delete
BEFORE DELETE ON store_service_records
FOR EACH ROW EXECUTE FUNCTION reject_store_service_record_change();
