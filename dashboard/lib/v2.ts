// Pure, framework-free V2 review logic — no React/Next imports, so this can
// be unit-tested with a plain assertion runner (see lib/__tests__/v2.test.ts)
// and used identically from server (API route) or client (page/component)
// code. This module only ever READS the shape that agents/matcher/v2's
// persistence layer already writes (database/migrations/004_v2_persistence.sql,
// agents/matcher/v2/persistence.ts) — it never invents a field, never
// converts null to 0, and never derives a priority bucket from a score.

export type V2State = 'not_evaluated' | 'gates_only' | 'fully_scored';

export interface V2ApplicationRow {
  id: string;
  company: string;
  role: string;
  location: string | null;
  ats_type: string | null;
  jd_url: string;
  status: string;                      // V1 status
  match_score: number | null;          // V1 score
  match_justification: string | null;
  engine_version: string | null;
  role_family: string | null;
  opportunity_score: number | null;
  priority_bucket: string | null;
  needs_review: boolean | null;
  v2_scored_at: string | null;
  // The full JSONB blob written by agents/matcher/v2/persistence.ts:
  // { engine_version, gates: { vetoed, failing_reasons, role_family, experience, location }, scoring: OpportunityScore | null, scored_at }
  // Typed loosely (unknown-shaped nested reads) since this dashboard package
  // doesn't share types with the agents package — the extraction helpers
  // below are the single place that reads into it, defensively.
  v2_result: any | null;
}

/**
 * Classifies where a row stands in the V2 pipeline, without ever guessing.
 * - not_evaluated: V2 has never touched this row (engine_version is 'v1'/null,
 *   or no v2_result at all — this is the expected default for every row
 *   today, since the migration isn't applied and V2 isn't enabled).
 * - gates_only: V2 gates ran (v2_result.gates present) but scoring didn't —
 *   this is the CURRENT expected shape for any row V2 does touch, since the
 *   automatic daily loop only calls evaluateHardVeto(), never
 *   runShadowScoring(). This must never be displayed as a failure.
 * - fully_scored: a real OpportunityScore is present.
 */
export function classifyV2State(row: V2ApplicationRow): V2State {
  const hasEngine = !!row.engine_version && row.engine_version !== 'v1';
  const gates = row.v2_result?.gates;
  if (!hasEngine || !gates) return 'not_evaluated';
  const hasScoring = row.v2_result?.scoring != null && row.opportunity_score !== null;
  return hasScoring ? 'fully_scored' : 'gates_only';
}

export function v2StateLabel(state: V2State): string {
  if (state === 'not_evaluated') return 'V2 not evaluated';
  if (state === 'gates_only') return 'V2 gates evaluated — scoring not run';
  return 'V2 fully scored';
}

/** V1's own admit/reject reading of the row — 'filtered' is V1's own gate rejection. */
export function v1Admitted(row: Pick<V2ApplicationRow, 'status'>): boolean {
  return row.status !== 'filtered';
}

/**
 * V2's admit/reject reading, or null when V2 hasn't produced a gate verdict
 * at all (not_evaluated) — null is a real, distinct state, never coerced to
 * true/false.
 */
export function v2Admitted(row: V2ApplicationRow): boolean | null {
  if (classifyV2State(row) === 'not_evaluated') return null;
  const gates = row.v2_result?.gates;
  if (!gates || typeof gates.vetoed !== 'boolean') return null;
  return gates.vetoed === false;
}

export type DisagreementKind = 'none' | 'v1_admit_v2_reject' | 'v1_reject_v2_admit' | 'unknown';

export function detectDisagreement(row: V2ApplicationRow): DisagreementKind {
  const v2 = v2Admitted(row);
  if (v2 === null) return 'unknown';
  const v1 = v1Admitted(row);
  if (v1 === v2) return 'none';
  return v1 && !v2 ? 'v1_admit_v2_reject' : 'v1_reject_v2_admit';
}

/** Never renders null as 0 — that would silently claim "the worst possible score" for "we don't know." */
export function formatOpportunityScore(score: number | null | undefined): string {
  return score === null || score === undefined ? 'Not scored' : String(score);
}

/** No threshold logic exists yet — null always renders as this, never inferred from the score. */
export function formatPriorityBucket(bucket: string | null | undefined): string {
  return bucket === null || bucket === undefined || bucket === '' ? 'Not assigned' : bucket;
}

export function formatNeedsReview(needsReview: boolean | null | undefined): 'Needs review' | 'No' {
  return needsReview === true ? 'Needs review' : 'No';
}

// --- "Show the why" section extractors ------------------------------------
// Each returns null when the section genuinely isn't present in v2_result —
// callers render "Not available" for null, never a fabricated placeholder.

export interface RoleFamilySection {
  family: string | null;
  passed: boolean | null;
  confidence: string | null;
  reason: string | null;
  evidence: unknown;
}

export function getRoleFamilySection(row: V2ApplicationRow): RoleFamilySection | null {
  const rf = row.v2_result?.gates?.role_family;
  if (!rf) return null;
  return {
    family: rf.family ?? null,
    passed: typeof rf.passed === 'boolean' ? rf.passed : null,
    confidence: rf.confidence ?? null,
    reason: rf.reason ?? null,
    evidence: rf.evidence ?? null,
  };
}

export interface ExperienceSection {
  min_years: number | null;
  max_years: number | null;
  effective_years: number | null;
  tier: string | null;
  passed: boolean | null;
  reason: string | null;
  evidence: unknown;
}

export function getExperienceSection(row: V2ApplicationRow): ExperienceSection | null {
  const exp = row.v2_result?.gates?.experience;
  if (!exp) return null;
  return {
    min_years: exp.requirement?.min_years ?? null,
    max_years: exp.requirement?.max_years ?? null,
    effective_years: exp.evidence?.effective_years ?? null,
    tier: exp.tier ?? null,
    passed: typeof exp.passed === 'boolean' ? exp.passed : null,
    reason: exp.reason ?? null,
    evidence: exp.evidence ?? null,
  };
}

export interface LocationSection {
  category: string | null;
  country: string | null;
  city: string | null;
  passed: boolean | null;
  reason: string | null;
  evidence: unknown;
}

export function getLocationSection(row: V2ApplicationRow): LocationSection | null {
  const loc = row.v2_result?.gates?.location;
  if (!loc) return null;
  return {
    category: loc.location?.category ?? null,
    country: loc.location?.country ?? null,
    city: loc.location?.city ?? null,
    passed: typeof loc.passed === 'boolean' ? loc.passed : null,
    reason: loc.reason ?? null,
    evidence: loc.evidence ?? null,
  };
}

export interface SkillFitRequirementRow {
  skill: string | null;
  requirement_type: string | null;
  match_strength: string | null;
  matched_evidence: string | null;
  quoted_context: string | null;
}

export interface SkillFitSection {
  score: number | null;
  needs_review: boolean | null;
  reason: string | null;
  extraction_model: string | null;
  requirements: SkillFitRequirementRow[];
}

/** Only present when scoring actually ran — null for a gates-only row. */
export function getSkillFitSection(row: V2ApplicationRow): SkillFitSection | null {
  const skillFit = row.v2_result?.scoring?.skill_fit;
  if (!skillFit) return null;
  const requirements: SkillFitRequirementRow[] = Array.isArray(skillFit.evidence?.requirements)
    ? skillFit.evidence.requirements.map((r: any) => ({
        skill: r?.requirement?.skill ?? null,
        requirement_type: r?.requirement?.requirement_type ?? null,
        match_strength: r?.match_strength ?? null,
        matched_evidence: r?.matched_evidence ?? null,
        quoted_context: r?.requirement?.quoted_context ?? null,
      }))
    : [];
  return {
    score: skillFit.score ?? null,
    needs_review: typeof skillFit.needs_review === 'boolean' ? skillFit.needs_review : null,
    reason: skillFit.reason ?? null,
    extraction_model: skillFit.evidence?.extraction_model ?? null,
    requirements,
  };
}

export interface OpportunitySection {
  overall: number | null;
  seniority_fit: { score: number | null; reason: string | null } | null;
  freshness: { score: number | null; reason: string | null } | null;
  compensation: { status: string | null; score: number | null; reason: string | null } | null;
  weights_used: Record<string, number> | null;
}

/** Only present when scoring actually ran — null for a gates-only row. */
export function getOpportunitySection(row: V2ApplicationRow): OpportunitySection | null {
  const scoring = row.v2_result?.scoring;
  if (!scoring) return null;
  return {
    overall: scoring.overall ?? null,
    seniority_fit: scoring.seniority_fit
      ? { score: scoring.seniority_fit.score ?? null, reason: scoring.seniority_fit.reason ?? null }
      : null,
    freshness: scoring.freshness
      ? { score: scoring.freshness.score ?? null, reason: scoring.freshness.reason ?? null }
      : null,
    compensation: scoring.compensation
      ? { status: scoring.compensation.status ?? null, score: scoring.compensation.score ?? null, reason: scoring.compensation.reason ?? null }
      : null,
    weights_used: scoring.weights_used ?? null,
  };
}

// --- Filters ----------------------------------------------------------------

export type ReviewFilter =
  | 'all'
  | 'v1_admit_v2_reject'
  | 'v1_reject_v2_admit'
  | 'needs_review'
  | 'gate_only'
  | 'fully_scored';

export const REVIEW_FILTERS: { value: ReviewFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'v1_admit_v2_reject', label: 'V1 admits / V2 rejects' },
  { value: 'v1_reject_v2_admit', label: 'V1 rejects / V2 admits' },
  { value: 'needs_review', label: 'V2 needs review' },
  { value: 'gate_only', label: 'V2 gate-only / not fully scored' },
  { value: 'fully_scored', label: 'V2 fully scored' },
];

export function matchesFilter(row: V2ApplicationRow, filter: ReviewFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'v1_admit_v2_reject':
      return detectDisagreement(row) === 'v1_admit_v2_reject';
    case 'v1_reject_v2_admit':
      return detectDisagreement(row) === 'v1_reject_v2_admit';
    case 'needs_review':
      return row.needs_review === true;
    case 'gate_only':
      return classifyV2State(row) === 'gates_only';
    case 'fully_scored':
      return classifyV2State(row) === 'fully_scored';
    default:
      return true;
  }
}
