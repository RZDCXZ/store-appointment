ALTER TABLE pet_photos
DROP CONSTRAINT pet_photos_public_path_check;

UPDATE pet_photos
SET public_path = '/miniapp/pet-photos/' || id || '/content';

ALTER TABLE pet_photos
ADD CONSTRAINT pet_photos_public_path_check
CHECK (public_path ~ '^/miniapp/pet-photos/[^/]+/content$');

ALTER TABLE privacy_consents
ALTER COLUMN consented_at DROP DEFAULT;
