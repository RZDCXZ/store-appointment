ALTER TABLE booking_idempotency_keys
DROP CONSTRAINT booking_idempotency_keys_command_type_check,
DROP CONSTRAINT booking_idempotency_keys_booking_id_key,
DROP CONSTRAINT booking_idempotency_result_check,
ADD CONSTRAINT booking_idempotency_keys_command_type_check CHECK (
  command_type IN ('create_booking', 'customer_cancel', 'customer_reschedule')
),
ADD CONSTRAINT booking_idempotency_result_check CHECK (
  (
    booking_id IS NOT NULL
    AND (
      (response_status IS NULL AND response_body IS NULL)
      OR (
        response_status BETWEEN 200 AND 299
        AND jsonb_typeof(response_body) = 'object'
      )
    )
  )
  OR
  (
    booking_id IS NULL
    AND response_status BETWEEN 400 AND 599
    AND jsonb_typeof(response_body) = 'object'
  )
);

COMMENT ON COLUMN booking_idempotency_keys.response_body IS
  'First stable error or success fact snapshot; successful verification codes are never stored.';

ALTER TABLE bookings
ALTER COLUMN occupancy_starts_at DROP NOT NULL,
ALTER COLUMN occupancy_ends_at DROP NOT NULL;

UPDATE bookings
SET occupancy_starts_at = NULL,
    occupancy_ends_at = NULL
WHERE status = 'cancelled';

ALTER TABLE bookings
DROP CONSTRAINT bookings_occupancy_bounds_check,
ADD CONSTRAINT bookings_occupancy_bounds_check CHECK (
  (
    occupancy_starts_at IS NULL
    AND occupancy_ends_at IS NULL
    AND status IN ('cancelled', 'no_show')
  )
  OR
  (
    occupancy_starts_at IS NOT NULL
    AND occupancy_ends_at IS NOT NULL
    AND status <> 'cancelled'
    AND occupancy_starts_at <= starts_at
    AND ends_at <= occupancy_ends_at
    AND occupancy_ends_at > occupancy_starts_at
  )
);

ALTER TABLE booking_events
DROP CONSTRAINT booking_events_event_type_check,
ADD CONSTRAINT booking_events_event_type_check CHECK (
  event_type IN ('booking_confirmed', 'booking_cancelled', 'booking_rescheduled')
),
ADD COLUMN sequence bigint GENERATED ALWAYS AS IDENTITY;

ALTER TABLE audit_events
DROP CONSTRAINT audit_events_event_type_check,
ADD CONSTRAINT audit_events_event_type_check CHECK (
  event_type IN ('booking_created', 'customer_booking_cancelled', 'customer_booking_rescheduled')
);

ALTER TABLE notification_outbox
DROP CONSTRAINT notification_outbox_notification_type_check,
DROP CONSTRAINT notification_outbox_booking_id_notification_type_key,
ADD CONSTRAINT notification_outbox_notification_type_check CHECK (
  notification_type IN (
    'booking_confirmed',
    'booking_cancelled',
    'booking_rescheduled',
    'booking_reminder'
  )
),
ADD COLUMN sequence bigint GENERATED ALWAYS AS IDENTITY;

UPDATE notification_outbox AS notification
SET payload = notification.payload || jsonb_build_object(
  'petName', booking.pet_name_snapshot,
  'serviceName', booking.primary_service_name_snapshot,
  'staffName', booking.staff_display_name_snapshot,
  'startsAt', booking.starts_at
)
FROM bookings AS booking
WHERE notification.booking_id = booking.id
  AND notification.notification_type = 'booking_confirmed';
