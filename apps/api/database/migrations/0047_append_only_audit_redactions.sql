CREATE TABLE audit_event_redactions (
  audit_event_id text PRIMARY KEY REFERENCES audit_events(id) ON DELETE RESTRICT,
  actor_id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  redacted_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (reason = 'customer_data_anonymized')
);

CREATE TRIGGER audit_event_redactions_immutable
BEFORE UPDATE OR DELETE ON audit_event_redactions
FOR EACH ROW
EXECUTE FUNCTION reject_audit_event_mutation();

CREATE VIEW effective_audit_events AS
SELECT audit.id,
       audit.event_type,
       audit.actor_type,
       COALESCE(redaction.actor_id, audit.actor_id) AS actor_id,
       audit.subject_type,
       audit.subject_id,
       COALESCE(redaction.payload, audit.payload) AS payload,
       audit.occurred_at
FROM audit_events AS audit
LEFT JOIN audit_event_redactions AS redaction ON redaction.audit_event_id = audit.id;

COMMENT ON TABLE audit_event_redactions IS
  'Append-only privacy overlay; original audit facts stay immutable while application readers use identity-free payloads.';

COMMENT ON VIEW effective_audit_events IS
  'Application-readable audit facts with append-only privacy redactions applied.';
