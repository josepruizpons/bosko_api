-- Waitlist for the landing page (public sign-ups, no auth)
CREATE TABLE IF NOT EXISTS waitlist (
  id          SERIAL PRIMARY KEY,
  email       VARCHAR(320) NOT NULL UNIQUE,
  source      VARCHAR(64) NULL,
  locale      VARCHAR(8) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON waitlist (created_at DESC);
