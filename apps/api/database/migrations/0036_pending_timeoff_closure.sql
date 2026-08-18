ALTER TABLE staff_time_off_intervals
ADD COLUMN created_by text REFERENCES backoffice_accounts(id) ON DELETE RESTRICT,
ADD COLUMN target_capacity_minutes integer NOT NULL DEFAULT 0
  CHECK (target_capacity_minutes >= 0),
ADD COLUMN affected_booking_count integer NOT NULL DEFAULT 0
  CHECK (affected_booking_count >= 0),
ADD COLUMN impact_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(impact_snapshot) = 'array'),
ADD COLUMN activated_at timestamptz;

ALTER TABLE store_closure_intervals
ADD COLUMN created_by text REFERENCES backoffice_accounts(id) ON DELETE RESTRICT,
ADD COLUMN target_capacity_minutes integer NOT NULL DEFAULT 0
  CHECK (target_capacity_minutes >= 0),
ADD COLUMN affected_booking_count integer NOT NULL DEFAULT 0
  CHECK (affected_booking_count >= 0),
ADD COLUMN impact_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(impact_snapshot) = 'array'),
ADD COLUMN activated_at timestamptz;

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
    'capacity_change_status_changed'
  )
),
DROP CONSTRAINT audit_events_subject_type_check,
ADD CONSTRAINT audit_events_subject_type_check CHECK (
  subject_type IN (
    'booking', 'primary_service', 'addon', 'staff',
    'schedule_template', 'schedule_draft', 'published_schedule',
    'staff_time_off', 'store_closure'
  )
);

COMMENT ON COLUMN staff_time_off_intervals.impact_snapshot IS
  'Immutable-at-creation JSON snapshot of bookings affected by this employee time off.';
COMMENT ON COLUMN store_closure_intervals.impact_snapshot IS
  'Immutable-at-creation JSON snapshot of bookings affected by this store-wide closure.';
