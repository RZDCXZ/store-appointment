ALTER TABLE service_catalog_items
ADD COLUMN display_order integer NOT NULL DEFAULT 1000,
ADD CONSTRAINT service_catalog_items_display_order_check CHECK (display_order >= 0);

UPDATE service_catalog_items
SET display_order = CASE id
  WHEN 'dog-basic-care' THEN 10
  WHEN 'dog-styling' THEN 20
  WHEN 'cat-care' THEN 30
  WHEN 'nail-care' THEN 10
  WHEN 'deshedding-care' THEN 20
  WHEN 'oral-care' THEN 30
  ELSE 1000
END;

CREATE INDEX service_catalog_items_type_order_idx
  ON service_catalog_items (item_type, display_order, created_at, id);
