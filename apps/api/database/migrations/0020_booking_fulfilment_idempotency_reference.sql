ALTER TABLE booking_fulfilment_idempotency_keys
ADD CONSTRAINT booking_fulfilment_idempotency_booking_id_fkey
FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
