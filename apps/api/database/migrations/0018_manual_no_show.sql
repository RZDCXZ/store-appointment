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
    status = 'no_show'
    AND occupancy_starts_at IS NOT NULL
    AND occupancy_ends_at IS NOT NULL
    AND occupancy_starts_at <= starts_at
    AND occupancy_ends_at > occupancy_starts_at
    AND occupancy_ends_at <= original_occupancy_ends_at
  )
  OR
  (
    status NOT IN ('cancelled', 'no_show')
    AND occupancy_starts_at IS NOT NULL
    AND occupancy_ends_at IS NOT NULL
    AND occupancy_starts_at <= starts_at
    AND ends_at <= occupancy_ends_at
    AND occupancy_ends_at > occupancy_starts_at
  )
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
    'booking_no_show'
  )
);
