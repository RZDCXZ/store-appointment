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
        AND occupancy_ends_at <= original_occupancy_ends_at
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
    AND occupancy_ends_at <= original_occupancy_ends_at
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
