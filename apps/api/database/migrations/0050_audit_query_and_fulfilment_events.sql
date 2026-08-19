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
    'booking_checked_in',
    'booking_late_checked_in',
    'booking_completed',
    'booking_no_show',
    'booking_terminated',
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
    'notification_manual_retry_requested',
    'data_exported',
    'customer_data_anonymized',
    'demo_time_advanced',
    'demo_data_reset'
  )
);

CREATE INDEX audit_events_time_idx
ON audit_events (occurred_at DESC, id DESC);

CREATE INDEX audit_events_actor_time_idx
ON audit_events (actor_type, actor_id, occurred_at DESC, id DESC);

CREATE INDEX audit_events_action_time_idx
ON audit_events (event_type, occurred_at DESC, id DESC);

COMMENT ON TABLE audit_events IS
  'Server-appended audit facts. UPDATE and DELETE are rejected; deterministic demo reset uses TRUNCATE and full reseed.';
