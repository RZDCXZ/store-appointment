ALTER TABLE manager_booking_change_idempotency_keys
DROP CONSTRAINT manager_booking_change_idempotency_keys_command_type_check,
ADD CONSTRAINT manager_booking_change_idempotency_keys_command_type_check CHECK (
  command_type IN ('manager_reschedule', 'manager_cancel', 'manager_content_correction')
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
    'booking_terminated',
    'booking_content_corrected'
  )
);

ALTER TABLE audit_events
DROP CONSTRAINT audit_events_event_type_check,
ADD CONSTRAINT audit_events_event_type_check CHECK (
  event_type IN (
    'booking_created',
    'customer_booking_cancelled',
    'customer_booking_rescheduled',
    'customer_phone_revealed',
    'manager_booking_cancelled',
    'manager_booking_rescheduled',
    'manager_booking_content_corrected'
  )
);

ALTER TABLE notification_outbox
DROP CONSTRAINT notification_outbox_notification_type_check,
ADD CONSTRAINT notification_outbox_notification_type_check CHECK (
  notification_type IN (
    'booking_confirmed',
    'booking_cancelled',
    'booking_rescheduled',
    'booking_reminder',
    'booking_content_corrected'
  )
);

COMMENT ON TABLE manager_booking_change_idempotency_keys IS
  'Manager-scoped first-result snapshots for reschedule, cancellation, and content-correction retries; verification-code plaintext is never retained.';
