-- 005_notified_at.sql — lets the Telegram digest send each matched job only once.
-- ADDITIVE ONLY and optional: the digest works without it (it falls back to a
-- 72-hour window and may repeat jobs between runs). Apply in the Supabase SQL editor.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS notified_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_applications_notified_at ON applications (notified_at) WHERE notified_at IS NULL;
