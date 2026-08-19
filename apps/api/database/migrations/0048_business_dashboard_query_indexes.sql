CREATE INDEX bookings_business_starts_at_idx ON bookings (starts_at);

COMMENT ON INDEX bookings_business_starts_at_idx IS
  'Supports Shanghai business-period dashboard scans using UTC half-open bounds.';
