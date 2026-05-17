-- Migration: add VIDEO_LOOP asset type + track.id_video_loop FK + asset.duration
-- Apply manually before running `npm run db`.

BEGIN;

-- 1) Seed new asset type
INSERT INTO e_asset_type (name) VALUES ('VIDEO_LOOP') ON CONFLICT (name) DO NOTHING;

-- 2) Add asset.duration
ALTER TABLE asset ADD COLUMN IF NOT EXISTS duration DOUBLE PRECISION;

-- 3) Add track.id_video_loop + FK
ALTER TABLE track ADD COLUMN IF NOT EXISTS id_video_loop CHAR(11);

ALTER TABLE track DROP CONSTRAINT IF EXISTS video_loop_fk;
ALTER TABLE track
  ADD CONSTRAINT video_loop_fk
  FOREIGN KEY (id_video_loop) REFERENCES asset(id)
  ON DELETE SET NULL;

COMMIT;
