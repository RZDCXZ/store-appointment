CREATE TABLE service_catalog_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO service_catalog_state (singleton, revision) VALUES (true, 1);

CREATE TABLE service_catalog_items (
  id text PRIMARY KEY,
  item_type text NOT NULL CHECK (item_type IN ('primary_service', 'addon')),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  description text NOT NULL CHECK (char_length(description) <= 500),
  applicable_species text[] NOT NULL CHECK (
    cardinality(applicable_species) BETWEEN 1 AND 2
    AND applicable_species <@ ARRAY['dog', 'cat']::text[]
  ),
  required_skill_ids text[] NOT NULL CHECK (
    cardinality(required_skill_ids) BETWEEN 1 AND 6
    AND required_skill_ids <@ ARRAY[
      'dog-basic-care', 'dog-styling', 'cat-care',
      'nail-care', 'deshedding-care', 'oral-care'
    ]::text[]
  ),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE service_catalog_specifications (
  id text PRIMARY KEY,
  item_id text NOT NULL REFERENCES service_catalog_items(id) ON DELETE RESTRICT,
  pet_size text NOT NULL CHECK (pet_size IN ('small', 'medium', 'large')),
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  duration_minutes integer NOT NULL CHECK (
    duration_minutes BETWEEN 5 AND 480 AND duration_minutes % 5 = 0
  ),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, pet_size)
);

CREATE TABLE service_catalog_primary_addons (
  primary_service_id text NOT NULL REFERENCES service_catalog_items(id) ON DELETE RESTRICT,
  addon_id text NOT NULL REFERENCES service_catalog_items(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (primary_service_id, addon_id),
  CHECK (primary_service_id <> addon_id)
);

CREATE INDEX service_catalog_items_type_active_idx
  ON service_catalog_items (item_type, active, created_at, id);
CREATE INDEX service_catalog_specifications_item_active_idx
  ON service_catalog_specifications (item_id, active, pet_size);

INSERT INTO service_catalog_items (
  id, item_type, name, description, applicable_species, required_skill_ids
)
VALUES
  (
    'dog-basic-care', 'primary_service', '犬基础洗护',
    '洗护、基础梳理、耳部与眼周清洁。', ARRAY['dog'], ARRAY['dog-basic-care']
  ),
  (
    'dog-styling', 'primary_service', '犬造型美容',
    '在完整洗护基础上完成犬只造型修剪。', ARRAY['dog'], ARRAY['dog-styling']
  ),
  (
    'cat-care', 'primary_service', '猫咪洗护',
    '为猫咪提供低刺激洗护、梳理与基础清洁。', ARRAY['cat'], ARRAY['cat-care']
  ),
  (
    'nail-care', 'addon', '修甲护理',
    '修整趾甲并检查足部状态。', ARRAY['dog', 'cat'], ARRAY['nail-care']
  ),
  (
    'deshedding-care', 'addon', '除废毛护理',
    '按体型增加梳理时间，温和去除浮毛。', ARRAY['dog', 'cat'], ARRAY['deshedding-care']
  ),
  (
    'oral-care', 'addon', '口腔清洁',
    '完成非医疗性质的日常口腔清洁。', ARRAY['dog', 'cat'], ARRAY['oral-care']
  );

INSERT INTO service_catalog_specifications (
  id, item_id, pet_size, price_cents, duration_minutes
)
VALUES
  ('spec-dog-basic-care-small', 'dog-basic-care', 'small', 12800, 60),
  ('spec-dog-basic-care-medium', 'dog-basic-care', 'medium', 16800, 90),
  ('spec-dog-basic-care-large', 'dog-basic-care', 'large', 22800, 120),
  ('spec-dog-styling-small', 'dog-styling', 'small', 22800, 120),
  ('spec-dog-styling-medium', 'dog-styling', 'medium', 32800, 150),
  ('spec-dog-styling-large', 'dog-styling', 'large', 45800, 180),
  ('spec-cat-care-small', 'cat-care', 'small', 16800, 90),
  ('spec-cat-care-medium', 'cat-care', 'medium', 21800, 120),
  ('spec-cat-care-large', 'cat-care', 'large', 28800, 150),
  ('spec-nail-care-small', 'nail-care', 'small', 3000, 15),
  ('spec-nail-care-medium', 'nail-care', 'medium', 3000, 15),
  ('spec-nail-care-large', 'nail-care', 'large', 3000, 15),
  ('spec-deshedding-care-small', 'deshedding-care', 'small', 6000, 30),
  ('spec-deshedding-care-medium', 'deshedding-care', 'medium', 9000, 45),
  ('spec-deshedding-care-large', 'deshedding-care', 'large', 12000, 60),
  ('spec-oral-care-small', 'oral-care', 'small', 3500, 15),
  ('spec-oral-care-medium', 'oral-care', 'medium', 3500, 15),
  ('spec-oral-care-large', 'oral-care', 'large', 3500, 15);

INSERT INTO service_catalog_primary_addons (primary_service_id, addon_id)
SELECT primary_service.id, addon.id
FROM service_catalog_items AS primary_service
CROSS JOIN service_catalog_items AS addon
WHERE primary_service.item_type = 'primary_service' AND addon.item_type = 'addon';

ALTER TABLE audit_events
DROP CONSTRAINT audit_events_event_type_check,
ADD CONSTRAINT audit_events_event_type_check CHECK (
  event_type IN (
    'booking_created',
    'customer_booking_cancelled',
    'customer_booking_rescheduled',
    'customer_phone_revealed',
    'manager_booking_cancelled',
    'manager_booking_rescheduled',
    'manager_booking_content_corrected',
    'service_catalog_created',
    'service_catalog_updated',
    'service_catalog_deactivated'
  )
),
DROP CONSTRAINT audit_events_subject_type_check,
ADD CONSTRAINT audit_events_subject_type_check CHECK (
  subject_type IN ('booking', 'primary_service', 'addon')
);

COMMENT ON TABLE service_catalog_items IS
  'Mutable major services and add-ons; bookings retain independent immutable snapshots.';
COMMENT ON TABLE service_catalog_specifications IS
  'One current size semantic per catalog item; inactive rows remain addressable for management history.';
COMMENT ON TABLE service_catalog_state IS
  'Single revision used for optimistic concurrency across related service configuration.';
