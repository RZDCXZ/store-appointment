ALTER TABLE weekly_shift_templates
DROP CONSTRAINT weekly_shift_templates_staff_id_weekday_key;

ALTER TABLE staff_schedule_days
DROP CONSTRAINT staff_schedule_days_exception_kind_check,
ADD CONSTRAINT staff_schedule_days_exception_kind_check CHECK (
  exception_kind IS NULL
  OR exception_kind IN ('adjusted_shift', 'overtime', 'special_break', 'day_off')
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
    'schedule_exception_updated'
  )
),
DROP CONSTRAINT audit_events_subject_type_check,
ADD CONSTRAINT audit_events_subject_type_check CHECK (
  subject_type IN (
    'booking', 'primary_service', 'addon', 'staff',
    'schedule_template', 'schedule_draft', 'published_schedule'
  )
);

COMMENT ON TABLE weekly_shift_templates IS
  'Weekly recurring employee shift rules; multiple shifts per weekday are allowed and never form capacity.';
