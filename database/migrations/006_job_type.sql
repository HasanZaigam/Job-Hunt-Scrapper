-- 006_job_type.sql
-- Tags a job as full-time vs a contract/gig/eval-task posting, WITHOUT dropping
-- it — contract AI-eval gigs (Askable, Patronus AI-style) are a valid side-income
-- track, not noise. ADDITIVE ONLY, same safety shape as 004/005:
--   - no existing column dropped, renamed, or altered
--   - no existing row rewritten or backfilled — every existing row gets NULL
--     ('unknown') until a future scraper/matcher run explicitly classifies it
--   - nullable, no default, so a missing column read is just NULL, never an error
--
-- NOT APPLIED as part of this change — file only, per the "database safety"
-- instruction. Apply manually (Supabase SQL editor) only when explicitly approved.

ALTER TABLE applications ADD COLUMN IF NOT EXISTS job_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_job_type_values'
  ) THEN
    ALTER TABLE applications
      ADD CONSTRAINT chk_job_type_values
      CHECK (job_type IS NULL OR job_type IN ('full_time', 'contract_gig', 'unknown'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_applications_job_type ON applications (job_type);
