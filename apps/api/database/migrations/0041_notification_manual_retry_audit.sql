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
    'capacity_change_revoked',
    'notification_manual_retry_requested'
  )
),
DROP CONSTRAINT audit_events_subject_type_check,
ADD CONSTRAINT audit_events_subject_type_check CHECK (
  subject_type IN (
    'booking', 'primary_service', 'addon', 'staff',
    'schedule_template', 'schedule_draft', 'published_schedule',
    'staff_time_off', 'store_closure', 'notification'
  )
);
