import type { ExperienceGateResult, SeniorityFitResult } from '../types';

// Purely deterministic — reuses the tier already computed by the
// experience gate (agents/matcher/v2/gates/experience.ts), never a second
// LLM opinion. Replaces the old band+tolerance distance calculation with a
// direct mapping from the gate's own tiered policy decision (acceptable /
// ideal / stretch / unknown — hard_reject never reaches this function,
// since the gate would already have vetoed the job).

const TIER_SCORE: Record<string, number> = {
  acceptable: 100,
  ideal: 90,
  stretch: 70,
  unknown: 60,
};

export function computeSeniorityFit(experience: ExperienceGateResult): SeniorityFitResult {
  const score = TIER_SCORE[experience.tier] ?? 60;
  return {
    score,
    band_distance: experience.tier === 'stretch' ? 1 : 0,
    reason: `experience tier "${experience.tier}" (${experience.reason})`,
  };
}
