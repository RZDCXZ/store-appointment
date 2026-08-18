ALTER TABLE bookings
DROP CONSTRAINT bookings_occupancy_bounds_check,
ADD CONSTRAINT bookings_occupancy_bounds_check CHECK (
  (
    status = 'cancelled'
    AND occupancy_starts_at IS NULL
    AND occupancy_ends_at IS NULL
  )
  OR
  (
    status = 'terminated'
    AND (
      (occupancy_starts_at IS NULL AND occupancy_ends_at IS NULL)
      OR (
        occupancy_starts_at IS NOT NULL
        AND occupancy_ends_at IS NOT NULL
        AND occupancy_starts_at <= starts_at
        AND occupancy_ends_at > occupancy_starts_at
        AND occupancy_ends_at <= ends_at + make_interval(mins => turnover_minutes)
      )
    )
  )
  OR
  (
    status IN ('no_show', 'completed')
    AND occupancy_starts_at IS NOT NULL
    AND occupancy_ends_at IS NOT NULL
    AND occupancy_starts_at <= starts_at
    AND occupancy_ends_at > occupancy_starts_at
    AND occupancy_ends_at <= ends_at + make_interval(mins => turnover_minutes)
  )
  OR
  (
    status IN ('confirmed', 'checked_in')
    AND occupancy_starts_at IS NOT NULL
    AND occupancy_ends_at IS NOT NULL
    AND occupancy_starts_at <= starts_at
    AND ends_at <= occupancy_ends_at
    AND occupancy_ends_at > occupancy_starts_at
  )
);

CREATE OR REPLACE FUNCTION reject_store_service_record_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND current_setting('rongguang.service_record_anonymization', true) = 'on' THEN
    IF TG_TABLE_NAME = 'store_service_records'
       AND NEW.id = OLD.id
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
       AND NEW.care_tags = OLD.care_tags
       AND NEW.internal_text IS NULL
       AND NEW.created_at = OLD.created_at THEN
      RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'store_service_record_notes'
       AND NEW.id = OLD.id
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

  RAISE EXCEPTION 'store service records are immutable';
END;
$$;

CREATE FUNCTION anonymize_store_service_records_for_customer(target_customer_id text)
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

  PERFORM set_config('rongguang.service_record_anonymization', 'off', true);
  RETURN anonymized_count;
END;
$$;

REVOKE ALL ON FUNCTION anonymize_store_service_records_for_customer(text) FROM PUBLIC;

COMMENT ON FUNCTION anonymize_store_service_records_for_customer(text) IS
  'Controlled privacy-deletion seam: redacts identity-bearing free text while preserving immutable service facts.';
