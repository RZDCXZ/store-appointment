CREATE OR REPLACE FUNCTION reject_store_service_record_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND current_setting('rongguang.service_record_anonymization', true) = 'on' THEN
    IF TG_TABLE_NAME = 'store_service_records' THEN
      IF NEW.id = OLD.id
         AND NEW.booking_id = OLD.booking_id
         AND NEW.pet_snapshot = jsonb_set(
           jsonb_set(
             OLD.pet_snapshot,
             '{id}',
             to_jsonb(('anonymized-' || OLD.id)::text),
             true
           ),
           '{name}',
           to_jsonb('已匿名宠物'::text),
           true
         )
         AND NEW.primary_service_snapshot = OLD.primary_service_snapshot
         AND NEW.addon_snapshots = OLD.addon_snapshots
         AND NEW.staff_snapshot = OLD.staff_snapshot
         AND NEW.actual_starts_at = OLD.actual_starts_at
         AND NEW.actual_ends_at = OLD.actual_ends_at
         AND NEW.care_tags = '[]'::jsonb
         AND NEW.internal_text IS NULL
         AND NEW.created_at = OLD.created_at THEN
        RETURN NEW;
      END IF;
    ELSIF TG_TABLE_NAME = 'store_service_record_notes' THEN
      IF NEW.id = OLD.id
         AND NEW.service_record_id = OLD.service_record_id
         AND NEW.kind = OLD.kind
         AND NEW.note_text = '[原说明已匿名化]'
         AND NEW.author_type = OLD.author_type
         AND NEW.author_id = OLD.author_id
         AND NEW.author_display_name = OLD.author_display_name
         AND NEW.created_at = OLD.created_at THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  RAISE EXCEPTION 'store service records are immutable';
END;
$$;

CREATE OR REPLACE FUNCTION anonymize_store_service_records_for_customer(target_customer_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  anonymized_count integer;
BEGIN
  PERFORM set_config('rongguang.service_record_anonymization', 'on', true);

  UPDATE store_service_records AS record
  SET pet_snapshot = jsonb_set(
        jsonb_set(
          record.pet_snapshot,
          '{id}',
          to_jsonb(('anonymized-' || record.id)::text),
          true
        ),
        '{name}',
        to_jsonb('已匿名宠物'::text),
        true
      ),
      care_tags = '[]'::jsonb,
      internal_text = NULL
  FROM bookings AS booking
  WHERE record.booking_id = booking.id
    AND booking.customer_id = target_customer_id;

  GET DIAGNOSTICS anonymized_count = ROW_COUNT;

  UPDATE store_service_record_notes AS note
  SET note_text = '[原说明已匿名化]'
  FROM store_service_records AS record
  JOIN bookings AS booking ON booking.id = record.booking_id
  WHERE note.service_record_id = record.id
    AND booking.customer_id = target_customer_id;

  UPDATE booking_events AS event
  SET payload = event.payload - 'serviceRecord' - 'reason'
  FROM bookings AS booking
  WHERE event.booking_id = booking.id
    AND booking.customer_id = target_customer_id
    AND event.event_type IN ('booking_completed', 'booking_terminated');

  DELETE FROM booking_fulfilment_idempotency_keys AS idempotency
  USING bookings AS booking
  WHERE idempotency.booking_id = booking.id
    AND booking.customer_id = target_customer_id;

  PERFORM set_config('rongguang.service_record_anonymization', 'off', true);
  RETURN anonymized_count;
END;
$$;

REVOKE ALL ON FUNCTION anonymize_store_service_records_for_customer(text) FROM PUBLIC;

COMMENT ON FUNCTION anonymize_store_service_records_for_customer(text) IS
  'Controlled privacy-deletion seam: redacts identity-bearing service text and care data, minimizes outcome events, and drops transient idempotency snapshots while preserving service facts.';
