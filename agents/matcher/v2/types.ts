// Shared types for the v2 hard-veto gates.
// Milestone 1 shipped experience + location. Milestone 2 (this one) adds
// role-family classification and combines all three into one gate phase.
// Soft scoring (skill fit, seniority distance, freshness, compensation) and
// priority buckets are still not built — that remains a later milestone.

export type ExperienceBand =
  | 'entry_0_2'
  | 'junior_2_4'
  | 'mid_4_6'
  | 'senior_6_9'
  | 'staff_plus_9'
  | 'unknown';

export interface ExperienceRequirement {
  min_years: number | null;
  max_years: number | null;
  band: ExperienceBand;
  source: 'explicit_range' | 'single_number' | 'seniority_title_inferred' | 'unknown';
}

export interface ExperienceEvidence {
  matched_phrase: string | null;
  years_found: number[];
  effective_years: number | null; // the single number the tier decision was actually made on
}

// Tiered years-of-experience policy, replacing the old band+tolerance model.
// The CTO's explicit correction: a 5-year requirement must never sneak
// through merely because a band-tolerance window happened to be wide
// enough — 5+ years is now a hard reject regardless of band math.
export type ExperienceTier = 'acceptable' | 'ideal' | 'stretch' | 'hard_reject' | 'unknown';

export interface ExperienceGateResult {
  requirement: ExperienceRequirement;
  tier: ExperienceTier;
  passed: boolean;
  needs_review: boolean;
  reason: string;
  evidence: ExperienceEvidence;
}

export type RemoteFlag = 'remote' | 'hybrid' | 'onsite' | 'unspecified';

// Location category — the actual eligibility decision, not just the raw
// remote/hybrid/onsite flag. The CTO's explicit requirement: "remote" alone
// is not enough information — a remote job restricted to a region the
// candidate isn't in must be rejected the same as an onsite job elsewhere.
export type LocationCategory =
  | 'remote_india'
  | 'remote_global'
  | 'remote_asia'
  | 'remote_us_only'
  | 'remote_canada_only'
  | 'remote_uk_only'
  | 'remote_eu_only'
  | 'remote_other_country_only'
  | 'onsite_india'
  | 'hybrid_india'
  | 'onsite_non_india'
  | 'hybrid_non_india'
  | 'ambiguous';

export interface LocationEligibility {
  raw_location: string;
  country: string | null;
  city: string | null;
  remote_flag: RemoteFlag;
  category: LocationCategory;
}

export interface LocationEvidence {
  matched_country_hint: string | null;
  matched_city_hint: string | null;
  matched_onsite_city: string | null;
  matched_qualifier: string | null; // the raw region/country qualifier text found, if any (e.g. "US", "Europe")
}

export interface LocationGateResult {
  location: LocationEligibility;
  passed: boolean;
  needs_review: boolean;
  reason: string;
  evidence: LocationEvidence;
}

// Tiered years-of-experience policy — configurable per candidate profile
// (base-resume.json's `experience_policy`), not hardcoded. Replaces the old
// band+tolerance model.
export interface ExperiencePolicy {
  acceptable_max_years: number;  // <= this: acceptable, no review
  ideal_min_years: number;       // informational — the "sweet spot" floor
  ideal_max_years: number;       // <= this: ideal, no review
  stretch_max_years: number;     // <= this: stretch, passes but needs_review
  hard_reject_min_years: number; // >= this: hard reject, regardless of band
}

export interface LocationProfile {
  countries: string[];            // ISO-ish country codes/names, lowercased — eligible countries besides "remote, no restriction stated"
  remote_ok_from_anywhere: boolean; // whether an unrestricted ("remote_global") posting is eligible
  onsite_cities: string[];        // lowercased — NOT used as an eligibility gate (onsite/hybrid India is nationwide); kept for possible future ranking/filtering only
}

export type RoleFamily =
  | 'ai_ml_engineer'
  | 'backend_engineer'
  | 'data_scientist'
  | 'genai_applied'
  | 'devops_infra'
  | 'other_engineering'
  | 'non_engineering'
  | 'unknown';

export type RoleFamilyConfidence = 'high' | 'medium' | 'low';

export interface RoleFamilyEvidence {
  matched_keywords: Record<string, string[]>; // family -> keywords matched, for every family with >=1 hit
  top_family_hits: number;
  runner_up_family: RoleFamily | null;
  runner_up_hits: number;
  engineering_signals: string[];     // functional evidence of actual engineering responsibilities
  non_engineering_signals: string[]; // functional evidence of ops/business/product responsibilities
}

export interface RoleFamilyGateResult {
  family: RoleFamily;
  confidence: RoleFamilyConfidence;
  passed: boolean;
  needs_review: boolean;
  reason: string;
  evidence: RoleFamilyEvidence;
}

export interface RoleFamilyProfile {
  acceptable_role_families: RoleFamily[];
}

// --- Soft scoring (this milestone) ---------------------------------------
// Runs ONLY on jobs that already passed the hard-veto gates above. Kept in
// entirely separate modules (agents/matcher/v2/scoring/) so the deterministic
// gates are never mixed with LLM-backed scoring logic.

export type RequirementType = 'required' | 'preferred';
export type MatchStrength = 'exact' | 'strong_semantic' | 'related' | 'missing';

export interface ExtractedRequirement {
  skill: string;
  requirement_type: RequirementType;
  quoted_context: string;         // short verbatim JD snippet — audit trail for why this was extracted
}

export interface ScoredRequirement {
  requirement: ExtractedRequirement;
  match_strength: MatchStrength;
  matched_evidence: string | null; // the candidate skill string that produced the best match, if any
  contribution: number;            // this requirement's weighted contribution (0-1), for audit
  reason: string;
}

export interface SkillFitEvidence {
  requirements: ScoredRequirement[];
  extraction_model: string | null;
  extraction_error: string | null;
  weights_applied: {
    requirement_type: Record<RequirementType, number>;
    match_strength: Record<MatchStrength, number>;
  };
}

export interface SkillFitResult {
  score: number | null;               // null on strict-fallback failure — never fabricated
  matched_skills: string[];           // derived convenience view: requirements with match_strength !== 'missing'
  missing_skills: string[];           // derived convenience view: requirements with match_strength === 'missing'
  status: 'ok' | 'error';
  needs_review: boolean;
  reason: string;
  evidence: SkillFitEvidence;
}

export interface SeniorityFitResult {
  score: number;
  band_distance: number;
  reason: string;
}

export interface FreshnessResult {
  score: number;
  days_old: number;
  reason: string;
}

export type CompensationStatus = 'disclosed' | 'not_disclosed' | 'invalid';

export interface CompensationResult {
  status: CompensationStatus;
  raw: string | null;
  // Always a number — 50 is an explicit neutral/unknown signal, not a
  // fabricated estimate of actual pay, for both 'not_disclosed' and
  // 'invalid'. Never null: this dimension's weight is never redistributed
  // away from the other three, so a score must always be present.
  score: number;
  reason: string;
}

export interface OpportunityScore {
  skill_fit: SkillFitResult;
  seniority_fit: SeniorityFitResult;
  freshness: FreshnessResult;
  compensation: CompensationResult;
  overall: number | null;             // null if skill_fit failed — strict fallback, never fabricated
  weights_used: Record<string, number>;
}

export interface HardVetoResult {
  vetoed: boolean;
  needs_review: boolean;
  reason: string | null;          // first failing gate, for quick display
  failing_reasons: string[];       // every gate that failed, for full auditability
  gates: {
    role_family: RoleFamilyGateResult;
    experience: ExperienceGateResult;
    location: LocationGateResult;
  };
  // Deprecated flat accessors kept for callers written against Milestone 1
  // (agents/matcher/index.ts, the Milestone 1 benchmark scripts) — mirror
  // gates.experience / gates.location so nothing that already shipped breaks.
  experience: ExperienceGateResult;
  location: LocationGateResult;
}
