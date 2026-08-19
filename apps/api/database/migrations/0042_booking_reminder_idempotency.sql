CREATE UNIQUE INDEX notification_outbox_booking_reminder_once_idx
ON notification_outbox (booking_id)
WHERE notification_type = 'booking_reminder';

COMMENT ON INDEX notification_outbox_booking_reminder_once_idx IS
  'A booking produces at most one customer reminder even if reminder scanning restarts.';
