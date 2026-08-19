CREATE OR REPLACE VIEW effective_audit_events AS
SELECT audit.id,
       audit.event_type,
       audit.actor_type,
       COALESCE(redaction.actor_id, audit.actor_id) AS actor_id,
       audit.subject_type,
       CASE
         WHEN redaction.audit_event_id IS NOT NULL THEN
           'anonymized-' || substr(md5(audit.id), 1, 12)
         ELSE audit.subject_id
       END AS subject_id,
       COALESCE(redaction.payload, audit.payload) AS payload,
       audit.occurred_at
FROM audit_events AS audit
LEFT JOIN audit_event_redactions AS redaction ON redaction.audit_event_id = audit.id;

COMMENT ON VIEW effective_audit_events IS
  'Application-readable audit facts with privacy redactions and non-reversible per-fact aliases instead of original business subject identifiers.';
