CREATE TABLE staff_members (
  id text PRIMARY KEY REFERENCES backoffice_accounts(id) ON DELETE RESTRICT,
  employee_number smallint NOT NULL UNIQUE CHECK (employee_number BETWEEN 1 AND 4),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE staff_skills (
  staff_id text NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  skill_id text NOT NULL CHECK (
    skill_id IN (
      'dog-basic-care',
      'dog-styling',
      'cat-care',
      'nail-care',
      'deshedding-care',
      'oral-care'
    )
  ),
  PRIMARY KEY (staff_id, skill_id)
);

CREATE TABLE store_business_hours (
  weekday smallint PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
  opens_at time,
  closes_at time,
  CHECK (
    (opens_at IS NULL AND closes_at IS NULL)
    OR (opens_at IS NOT NULL AND closes_at IS NOT NULL AND closes_at > opens_at)
  )
);

CREATE TABLE weekly_shift_templates (
  id text PRIMARY KEY,
  staff_id text NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  active boolean NOT NULL DEFAULT true,
  CHECK (ends_at > starts_at),
  UNIQUE (staff_id, weekday)
);

CREATE TABLE weekly_shift_template_breaks (
  id text PRIMARY KEY,
  template_id text NOT NULL REFERENCES weekly_shift_templates(id) ON DELETE CASCADE,
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  CHECK (ends_at > starts_at)
);

CREATE TABLE staff_schedule_days (
  id text PRIMARY KEY,
  staff_id text NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  publication_status text NOT NULL CHECK (publication_status IN ('draft', 'published')),
  source text NOT NULL CHECK (source IN ('weekly_template', 'date_exception')),
  exception_kind text CHECK (
    exception_kind IS NULL OR exception_kind IN ('adjusted_shift', 'special_break', 'day_off')
  ),
  exception_note text,
  published_at timestamptz,
  CHECK (
    (publication_status = 'published' AND published_at IS NOT NULL)
    OR (publication_status = 'draft' AND published_at IS NULL)
  ),
  CHECK (
    (source = 'weekly_template' AND exception_kind IS NULL AND exception_note IS NULL)
    OR (source = 'date_exception' AND exception_kind IS NOT NULL AND exception_note IS NOT NULL)
  ),
  UNIQUE (staff_id, local_date, publication_status)
);

CREATE INDEX staff_schedule_days_window_idx
ON staff_schedule_days (local_date, publication_status, staff_id);

CREATE TABLE staff_schedule_shifts (
  id text PRIMARY KEY,
  schedule_day_id text NOT NULL REFERENCES staff_schedule_days(id) ON DELETE CASCADE,
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  CHECK (ends_at > starts_at)
);

CREATE INDEX staff_schedule_shifts_day_idx ON staff_schedule_shifts (schedule_day_id);

CREATE TABLE staff_schedule_breaks (
  id text PRIMARY KEY,
  schedule_shift_id text NOT NULL REFERENCES staff_schedule_shifts(id) ON DELETE CASCADE,
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  CHECK (ends_at > starts_at)
);

CREATE INDEX staff_schedule_breaks_shift_idx ON staff_schedule_breaks (schedule_shift_id);

COMMENT ON TABLE weekly_shift_templates IS
  'Weekly recurring schedule rules. Templates never form bookable capacity.';
COMMENT ON TABLE staff_schedule_days IS
  'Concrete local-date schedule drafts and publications; only published rows can form capacity.';
COMMENT ON TABLE staff_schedule_shifts IS
  'Concrete employee shifts for one local-date schedule day.';
COMMENT ON TABLE staff_schedule_breaks IS
  'Non-bookable breaks inside a concrete employee shift.';
