import assert from 'assert';
import { computeCompensation } from '../compensation';
import { computeOpportunityScore } from '../opportunity-score';
import type { SkillFitResult, SeniorityFitResult, FreshnessResult } from '../../types';

type Test = () => void;
const tests: Record<string, Test> = {};

tests['empty/absent salary_range -> status not_disclosed, neutral score 50'] = () => {
  const result = computeCompensation(null);
  assert.strictEqual(result.status, 'not_disclosed');
  assert.strictEqual(result.score, 50);
};

tests['placeholder text ("TBD", "Competitive") -> status invalid, neutral score 50, distinct from not_disclosed'] = () => {
  const tbd = computeCompensation('TBD');
  const competitive = computeCompensation('Competitive');
  assert.strictEqual(tbd.status, 'invalid');
  assert.strictEqual(tbd.score, 50);
  assert.strictEqual(competitive.status, 'invalid');
  assert.notStrictEqual(tbd.status, 'not_disclosed', 'invalid must be recorded distinctly from not_disclosed');
};

tests['a real figure -> status disclosed, score 70'] = () => {
  const result = computeCompensation('$70,000 - $90,000');
  assert.strictEqual(result.status, 'disclosed');
  assert.strictEqual(result.score, 70);
};

const skillFit = (score: number): SkillFitResult => ({
  score, matched_skills: [], missing_skills: [], status: 'ok', needs_review: false, reason: '',
  evidence: { requirements: [], extraction_model: null, extraction_error: null, weights_applied: { requirement_type: { required: 1, preferred: 0.4 }, match_strength: { exact: 1, strong_semantic: 0.8, related: 0.35, missing: 0 } } },
});
const seniorityFit: SeniorityFitResult = { score: 100, band_distance: 0, reason: '' };
const freshness: FreshnessResult = { score: 100, days_old: 0, reason: '' };

tests['ANTI-INFLATION: compensation weight is NEVER redistributed — not_disclosed does not raise other dimensions relative weight'] = () => {
  const notDisclosed = computeOpportunityScore(skillFit(100), seniorityFit, freshness, computeCompensation(null));
  const disclosed = computeOpportunityScore(skillFit(100), seniorityFit, freshness, computeCompensation('$100,000'));
  assert.deepStrictEqual(notDisclosed.weights_used, disclosed.weights_used, 'weights_used must be identical regardless of disclosure — no redistribution');
  assert.strictEqual(notDisclosed.weights_used.compensation, 0.20);
};

tests['ANTI-INFLATION: a perfect skill/seniority/freshness job with undisclosed comp can no longer reach 100'] = () => {
  const result = computeOpportunityScore(skillFit(100), seniorityFit, freshness, computeCompensation(null));
  assert.ok(result.overall! < 100, `expected < 100 (neutral comp must pull the score down), got ${result.overall}`);
  // 0.40*100 + 0.25*100 + 0.15*100 + 0.20*50 = 90
  assert.strictEqual(result.overall, 90);
};

export function run(): { name: string; passed: boolean; error?: string }[] {
  return Object.entries(tests).map(([name, fn]) => {
    try {
      fn();
      return { name, passed: true };
    } catch (err: any) {
      return { name, passed: false, error: err?.message || String(err) };
    }
  });
}
