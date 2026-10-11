import type { SupabaseClient } from '@supabase/supabase-js';
import type { HardVetoResult, OpportunityScore } from './types';
import { V2_ENGINE_VERSION } from './version';

// V2 persistence foundation. Writes ONLY the additive V2 columns from
// database/migrations/004_v2_persistence.sql — never `status`,
// `match_score`, `score_breakdown`, `resume_storage_url`,
// `cover_letter_storage_url`, or any other V1/application-lifecycle field.
// Calling this never changes what stage a job is in, never triggers resume
// generation, and never triggers auto-apply.
//
// This module is deliberately inert unless a caller explicitly invokes it
// with a real Supabase client — it has no side effects on import, and the
// only current caller (agents/matcher/index.ts) only does so behind
// MATCHER_ENGINE_V2_ENABLED, which stays false by default.

export interface V2PersistencePayload {
  engine_version: string;
  role_family: string | null;
  opportunity_score: number | null;
  // Always null in this milestone: priority-bucket thresholds have not been
  // approved yet (a separate, explicit decision — see the architecture
  // proposal). The column exists so a future derivePriorityBucket() can
  // populate it without another migration; nothing computes a value into
  // it today.
  priority_bucket: null;
  needs_review: boolean;
  // Full structured result — everything the gates and (if run) the scorer
  // produced, so a future dashboard can explain any decision without a
  // second schema change. Nothing here is invented beyond what
  // HardVetoResult/OpportunityScore already contain.
  v2_result: {
    engine_version: string;
    gates: {
      vetoed: boolean;
      failing_reasons: string[];
      role_family: HardVetoResult['gates']['role_family'];
      experience: HardVetoResult['gates']['experience'];
      location: HardVetoResult['gates']['location'];
    };
    scoring: OpportunityScore | null;
    scored_at: string;
  };
  v2_scored_at: string;
}

/**
 * Pure mapping from the existing, already-validated V2 result types to the
 * exact shape persisted to the `applications` table. No new fields are
 * invented — every value here is read directly off HardVetoResult /
 * OpportunityScore, which are unchanged by this task.
 *
 * `opportunity` is null whenever the caller only ran the deterministic
 * gates (e.g. the live shadow-logging path in matcher/index.ts, which makes
 * zero Gemini calls) — in that case opportunity_score stays null and
 * needs_review reduces to the gates' own needs_review flag.
 */
export function buildV2PersistencePayload(
  gate: HardVetoResult,
  opportunity: OpportunityScore | null,
  scoredAt: Date
): V2PersistencePayload {
  const needs_review = gate.needs_review || (opportunity?.skill_fit.needs_review ?? false);
  const scored_at_iso = scoredAt.toISOString();

  return {
    engine_version: V2_ENGINE_VERSION,
    role_family: gate.gates.role_family.family,
    opportunity_score: opportunity?.overall ?? null,
    priority_bucket: null,
    needs_review,
    v2_result: {
      engine_version: V2_ENGINE_VERSION,
      gates: {
        vetoed: gate.vetoed,
        failing_reasons: gate.failing_reasons,
        role_family: gate.gates.role_family,
        experience: gate.gates.experience,
        location: gate.gates.location,
      },
      scoring: opportunity,
      scored_at: scored_at_iso,
    },
    v2_scored_at: scored_at_iso,
  };
}

export interface PersistResult {
  ok: boolean;
  error?: string;
}

/**
 * Writes the payload to the single row identified by jobId. Only ever
 * issues one UPDATE, scoped to this row's V2 columns — never an insert,
 * never a bulk/backfill query, never touches any other row. Caller is
 * responsible for only invoking this when the V2 engine flag is enabled.
 */
export async function persistV2Result(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  jobId: string,
  payload: V2PersistencePayload
): Promise<PersistResult> {
  const { error } = await supabase
    .from('applications')
    .update(payload as any)
    .eq('id', jobId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
