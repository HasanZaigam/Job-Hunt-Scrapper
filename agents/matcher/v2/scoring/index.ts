import { evaluateHardVeto } from '../hard-veto';
import { computeSkillFit } from './skill-fit';
import { computeSeniorityFit } from './seniority-fit';
import { computeFreshness } from './freshness';
import { computeCompensation } from './compensation';
import { computeOpportunityScore } from './opportunity-score';
import type { OpportunityScore, HardVetoResult } from '../types';

export interface ScoringInput {
  role: string;
  jdText: string;
  location: string;
  salaryRange: string | null | undefined;
  scrapedAt: Date;
  candidateSkills: Record<string, string[]> | undefined | null;
}

export interface ScoringOutcome {
  gate: HardVetoResult;
  scored: boolean;
  opportunity: OpportunityScore | null;
  skip_reason: string | null;
}

/**
 * Scoring only ever runs on jobs that already passed the hard-veto gates —
 * this is the one entry point that enforces that ordering, so a caller
 * can't accidentally score a job that role-family/experience/location
 * already rejected. Gates and scoring stay in separate modules
 * (agents/matcher/v2/gates/ vs agents/matcher/v2/scoring/); this file is
 * only the seam between them, not a place where their logic mixes.
 */
export async function runShadowScoring(input: ScoringInput, now: Date): Promise<ScoringOutcome> {
  const gate = evaluateHardVeto(input.role, input.jdText, input.location);

  if (gate.vetoed) {
    return { gate, scored: false, opportunity: null, skip_reason: `gate vetoed — not scored: ${gate.reason}` };
  }

  const skillFit = await computeSkillFit(input.jdText, input.candidateSkills);
  const seniorityFit = computeSeniorityFit(gate.gates.experience);
  const freshness = computeFreshness(input.scrapedAt, now);
  const compensation = computeCompensation(input.salaryRange);

  const opportunity = computeOpportunityScore(skillFit, seniorityFit, freshness, compensation);
  return { gate, scored: true, opportunity, skip_reason: null };
}
