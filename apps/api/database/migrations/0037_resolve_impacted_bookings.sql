CREATE TABLE capacity_change_booking_resolutions (
  id text PRIMARY KEY,
  staff_time_off_id text REFERENCES staff_time_off_intervals(id) ON DELETE CASCADE,
  store_closure_id text REFERENCES store_closure_intervals(id) ON DELETE CASCADE,
  booking_id text NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('change_staff', 'reschedule', 'cancel')),
  manager_id text NOT NULL REFERENCES backoffice_accounts(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 2 AND 120),
  original_snapshot jsonb NOT NULL CHECK (jsonb_typeof(original_snapshot) = 'object'),
  result_summary jsonb CHECK (result_summary IS NULL OR jsonb_typeof(result_summary) = 'object'),
  booking_event_id text NOT NULL REFERENCES booking_events(id) ON DELETE RESTRICT,
  resolved_at timestamptz NOT NULL,
  CHECK (num_nonnulls(staff_time_off_id, store_closure_id) = 1)
);

CREATE UNIQUE INDEX capacity_change_booking_resolution_time_off_idx
ON capacity_change_booking_resolutions (staff_time_off_id, booking_id)
WHERE staff_time_off_id IS NOT NULL;

CREATE UNIQUE INDEX capacity_change_booking_resolution_closure_idx
ON capacity_change_booking_resolutions (store_closure_id, booking_id)
WHERE store_closure_id IS NOT NULL;

ALTER TABLE staff_time_off_intervals
ADD COLUMN cancelled_at timestamptz,
ADD COLUMN cancelled_by text REFERENCES backoffice_accounts(id) ON DELETE RESTRICT,
ADD COLUMN cancellation_reason text CHECK (
  cancellation_reason IS NULL OR char_length(btrim(cancellation_reason)) BETWEEN 2 AND 120
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
    'manager_booking_content_corrected',
    'service_catalog_created',
    'service_catalog_updated',
    'service_catalog_deactivated',
    'staff_account_created',
    'staff_skills_updated',
    'staff_account_deactivated',
    'schedule_template_updated',
    'schedule_drafts_generated',
    'schedule_draft_updated',
    'schedule_published',
    'schedule_exception_updated',
    'capacity_change_created',
    'capacity_change_status_changed',
    'capacity_change_booking_resolved',
    'capacity_change_revoked'
  )
);

COMMENT ON TABLE capacity_change_booking_resolutions IS
  'Append-only outcomes linking each impacted booking to its capacity change and booking history event.';
