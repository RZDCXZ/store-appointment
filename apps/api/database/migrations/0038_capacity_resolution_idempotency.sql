ALTER TABLE capacity_change_booking_resolutions
ADD COLUMN idempotency_key text NOT NULL,
ADD COLUMN request_digest text NOT NULL;

CREATE UNIQUE INDEX capacity_change_booking_resolution_idempotency_idx
ON capacity_change_booking_resolutions (manager_id, idempotency_key);
