-- 004_v2_persistence.sql
-- V2 matcher persistence foundation. ADDITIVE ONLY.
--
-- This migration does not:
--   - drop, rename, or alter any existing column
--   - change any existing default or constraint
--   - rewrite, update, or backfill any existing row
--   - change what any row's `status` is
--
-- `engine_version` gets a DEFAULT of 'v1'. In Postgres 11+, adding a column
-- with a DEFAULT is a metadata-only operation — existing rows are not
-- rewritten, but they read back as 'v1', which is an honest label (every
-- row in this table today really was produced by V1) rather than a
-- fabricated backfill.
--
-- Every other new column is nullable with no default: every existing row
-- gets NULL for role_family / opportunity_score / priority_bucket /
-- v2_result / v2_scored_at, and `false` for needs_review, until a future V2
-- run explicitly processes that specific row. Nothing in this migration or
-- in agents/matcher/v2/persistence.ts performs a backfill.
--
-- NOT APPLIED as part of this change — file only, per the "database safety"
-- instruction. Apply manually (psql or the Supabase SQL editor) only when
-- explicitly approved.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS engine_version    text DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS role_family       text,
  ADD COLUMN IF NOT EXISTS opportunity_score integer,
  ADD COLUMN IF NOT EXISTS priority_bucket   text,
  ADD COLUMN IF NOT EXISTS needs_review      boolean NOT NULL DEFAULT false,
  -- Recommended addition beyond the five headline columns — see the
  -- accompanying report for why. Full structured V2 result (gate evidence,
  -- per-requirement skill audit trail, seniority/freshness/compensation
  -- breakdown, extraction model) so a future dashboard can explain any
  -- decision without another schema change.
  ADD COLUMN IF NOT EXISTS v2_result         jsonb,
  -- When V2 actually processed this row — distinct from `updated_at`,
  -- which V1 already touches for its own writes via the existing trigger.
  ADD COLUMN IF NOT EXISTS v2_scored_at      timestamptz;

-- Matches the existing repo convention for score columns (match_score has
-- the same style of check, see database/schema.sql). Postgres has no
-- `ADD CONSTRAINT IF NOT EXISTS`, so this is guarded explicitly — safe to
-- re-run without erroring if applied twice.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_opportunity_score_range'
  ) THEN
    ALTER TABLE applications
      ADD CONSTRAINT chk_opportunity_score_range
      CHECK (opportunity_score IS NULL OR opportunity_score BETWEEN 0 AND 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_applications_engine_version  ON applications (engine_version);
CREATE INDEX IF NOT EXISTS idx_applications_priority_bucket ON applications (priority_bucket);
CREATE INDEX IF NOT EXISTS idx_applications_needs_review    ON applications (needs_review) WHERE needs_review = true;
