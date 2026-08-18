ALTER TABLE booking_events
DROP CONSTRAINT booking_events_event_type_check,
ADD CONSTRAINT booking_events_event_type_check CHECK (
  event_type IN (
    'booking_confirmed',
    'booking_cancelled',
    'booking_rescheduled',
    'booking_checked_in'
  )
);
