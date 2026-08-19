ALTER TABLE capacity_change_booking_resolutions
ADD COLUMN response_body jsonb CHECK (
  response_body IS NULL OR jsonb_typeof(response_body) = 'object'
);

ALTER TABLE capacity_change_booking_resolutions
DROP CONSTRAINT capacity_change_booking_resolutions_action_check,
ADD CONSTRAINT capacity_change_booking_resolutions_action_check CHECK (
  action IN ('change_staff', 'reschedule', 'cancel', 'acknowledge_existing')
);

ALTER TABLE manager_booking_change_idempotency_keys
DROP CONSTRAINT manager_booking_change_idempotency_keys_command_type_check,
ADD CONSTRAINT manager_booking_change_idempotency_keys_command_type_check CHECK (
  command_type IN (
    'manager_reschedule',
    'manager_cancel',
    'manager_content_correction',
    'capacity_impact_resolution'
  )
);
