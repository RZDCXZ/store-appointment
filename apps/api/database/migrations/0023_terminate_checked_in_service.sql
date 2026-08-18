ALTER TABLE booking_fulfilment_idempotency_keys
DROP CONSTRAINT booking_fulfilment_idempotency_keys_command_type_check,
ADD CONSTRAINT booking_fulfilment_idempotency_keys_command_type_check CHECK (
  command_type IN ('check_in', 'late_check_in', 'no_show', 'complete', 'terminate')
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
    'booking_completed',
    'booking_terminated'
  )
);
