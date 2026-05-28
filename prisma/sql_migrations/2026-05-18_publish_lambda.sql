-- Lambda-based publish flow: new columns in track + asset
ALTER TABLE track ADD COLUMN IF NOT EXISTS publishing_started_at TIMESTAMP NULL;
ALTER TABLE track ADD COLUMN IF NOT EXISTS publishing_job_id VARCHAR NULL;
ALTER TABLE track ADD COLUMN IF NOT EXISTS published_at TIMESTAMP NULL;
ALTER TABLE track ADD COLUMN IF NOT EXISTS error_phase VARCHAR NULL;
ALTER TABLE track ADD COLUMN IF NOT EXISTS aborted_at TIMESTAMP NULL;
ALTER TABLE track ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL;

ALTER TABLE asset ADD COLUMN IF NOT EXISTS s3_deleted_at TIMESTAMP NULL;

CREATE INDEX IF NOT EXISTS idx_track_history
  ON track (id_profile, archived_at, published_at DESC);
