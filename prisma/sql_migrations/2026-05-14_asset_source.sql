-- Migration: drop asset.video_end_behavior (siempre 'loop'), añadir asset.source ('upload' | 'video_frame')
-- Apply manually before running `npm run db`.

BEGIN;

-- 1) Drop columna obsoleta video_end_behavior
ALTER TABLE asset DROP COLUMN IF EXISTS video_end_behavior;

-- 2) Añadir columna source
ALTER TABLE asset ADD COLUMN IF NOT EXISTS source VARCHAR(20);

-- 3) Backfill: todos los thumbnails existentes son uploads (el flujo de "frame del video" no estaba persistido)
UPDATE asset SET source = 'upload' WHERE type = 'THUMBNAIL' AND source IS NULL;

COMMIT;
