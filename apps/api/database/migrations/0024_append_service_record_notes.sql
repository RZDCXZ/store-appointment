ALTER TABLE booking_fulfilment_idempotency_keys
DROP CONSTRAINT booking_fulfilment_idempotency_keys_command_type_check,
ADD CONSTRAINT booking_fulfilment_idempotency_keys_command_type_check CHECK (
  command_type IN (
    'check_in',
    'late_check_in',
    'no_show',
    'complete',
    'terminate',
    'service_record_note'
  )
);

CREATE TABLE store_service_record_notes (
  id text PRIMARY KEY,
  service_record_id text NOT NULL REFERENCES store_service_records(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('staff_note', 'manager_correction')),
  note_text text NOT NULL CHECK (char_length(note_text) BETWEEN 2 AND 500),
  author_type text NOT NULL CHECK (author_type IN ('staff', 'manager')),
  author_id text NOT NULL REFERENCES backoffice_accounts(id) ON DELETE RESTRICT,
  author_display_name text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX store_service_record_notes_record_time_idx
ON store_service_record_notes (service_record_id, created_at, id);

COMMENT ON TABLE store_service_record_notes IS
  'Append-only staff notes and manager corrections; the original service record remains unchanged.';

CREATE TRIGGER store_service_record_notes_reject_update
BEFORE UPDATE ON store_service_record_notes
FOR EACH ROW EXECUTE FUNCTION reject_store_service_record_change();

CREATE TRIGGER store_service_record_notes_reject_delete
BEFORE DELETE ON store_service_record_notes
FOR EACH ROW EXECUTE FUNCTION reject_store_service_record_change();
