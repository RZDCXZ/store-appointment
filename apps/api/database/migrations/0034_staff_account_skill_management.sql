ALTER TABLE staff_members
DROP CONSTRAINT staff_members_employee_number_check,
ADD CONSTRAINT staff_members_employee_number_check CHECK (
  employee_number BETWEEN 1 AND 32767
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
    'staff_account_deactivated'
  )
),
DROP CONSTRAINT audit_events_subject_type_check,
ADD CONSTRAINT audit_events_subject_type_check CHECK (
  subject_type IN ('booking', 'primary_service', 'addon', 'staff')
);

COMMENT ON TABLE staff_skills IS
  'Current employee qualifications; availability reads these facts for every request.';
