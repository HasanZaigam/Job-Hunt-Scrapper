import type { OpportunityScore, SkillFitResult, SeniorityFitResult, FreshnessResult, CompensationResult } from '../types';

const WEIGHTS = { skill_fit: 0.40, seniority_fit: 0.25, freshness: 0.15, compensation: 0.20 };

// Strict fallback: skill_fit is the one dimension with a real failure mode
// (LLM extraction can error or come back empty). If it did, this returns
// overall=null rather than silently scoring on the other three.
//
// Compensation's weight is now FIXED at 0.20 and never redistributed:
// computeCompensation() always returns a real score (50 = neutral/unknown,
// 70 = disclosed), so all four dimensions always contribute. This closes
// the earlier bug where an undisclosed salary deleted the dimension and
// inflated the other three, making "employer said nothing about pay"
// structurally easier to score 100 than "employer disclosed an average
// number."
export function computeOpportunityScore(
  skillFit: SkillFitResult,
  seniorityFit: SeniorityFitResult,
  freshness: FreshnessResult,
  compensation: CompensationResult
): OpportunityScore {
  if (skillFit.status === 'error' || skillFit.score === null) {
    return { skill_fit: skillFit, seniority_fit: seniorityFit, freshness, compensation, overall: null, weights_used: {} };
  }

  const overall = Math.round(
    WEIGHTS.skill_fit * skillFit.score +
    WEIGHTS.seniority_fit * seniorityFit.score +
    WEIGHTS.freshness * freshness.score +
    WEIGHTS.compensation * compensation.score
  );

  return {
    skill_fit: skillFit,
    seniority_fit: seniorityFit,
    freshness,
    compensation,
    overall,
    weights_used: { ...WEIGHTS },
  };
}
