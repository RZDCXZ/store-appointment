ALTER TABLE audit_events
DROP CONSTRAINT audit_events_event_type_check,
ADD CONSTRAINT audit_events_event_type_check CHECK (
  event_type IN (
    'booking_created',
    'customer_booking_cancelled',
    'customer_booking_rescheduled',
    'customer_phone_revealed'
  )
);

CREATE OR REPLACE FUNCTION reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '审计记录不可修改或删除'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER audit_events_immutable
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION reject_audit_event_mutation();

COMMENT ON FUNCTION reject_audit_event_mutation() IS
  'Audit facts are append-only. Demo reset uses TRUNCATE and a full deterministic reseed.';
