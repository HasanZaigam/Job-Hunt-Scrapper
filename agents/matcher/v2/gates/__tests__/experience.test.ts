import assert from 'assert';
import { classifyExperienceRequirement, evaluateExperienceGate } from '../experience';
import type { ExperiencePolicy } from '../../types';

// Plain assertion-based unit tests — no test framework dependency added.
// Run via agents/matcher/v2/run-tests.ts.

const POLICY: ExperiencePolicy = {
  acceptable_max_years: 2,
  ideal_min_years: 1,
  ideal_max_years: 3,
  stretch_max_years: 4,
  hard_reject_min_years: 5,
};

type Test = () => void;
const tests: Record<string, Test> = {};

// --- parsing (unchanged behavior) ---
tests['explicit range "3-5 years" uses the upper bound (5) as the effective figure'] = () => {
  const { requirement, evidence } = classifyExperienceRequirement('Backend Engineer', 'Looking for 3-5 years of experience.');
  assert.strictEqual(requirement.source, 'explicit_range');
  assert.strictEqual(evidence.effective_years, 5);
};

tests['single number "8+ years" -> effective_years 8, max_years null'] = () => {
  const { requirement, evidence } = classifyExperienceRequirement('AI Engineer', 'Requires 8+ years of experience.');
  assert.strictEqual(requirement.max_years, null);
  assert.strictEqual(requirement.min_years, 8);
  assert.strictEqual(evidence.effective_years, 8);
};

tests['spelled-out "a decade" -> effective_years 10, no digits present'] = () => {
  const { evidence } = classifyExperienceRequirement('AI Engineer', 'a decade of experience required');
  assert.strictEqual(evidence.effective_years, 10);
  assert.strictEqual(evidence.matched_phrase, 'a decade');
};

tests['title-inferred effective years only used when JD has zero numeric signal'] = () => {
  const { evidence } = classifyExperienceRequirement('Staff Engineer', 'Own our platform architecture and mentor the team.');
  assert.strictEqual(evidence.effective_years, 10);
};

tests['explicit years in JD always override a senior-sounding title'] = () => {
  const { evidence } = classifyExperienceRequirement('Staff Engineer', 'Actually just 1 year of experience needed for this apprenticeship-style role.');
  assert.strictEqual(evidence.effective_years, 1);
};

tests['no signal anywhere -> unknown tier, gate passes provisionally with needs_review'] = () => {
  const result = evaluateExperienceGate('Software Engineer', 'Join our team and build great products.', POLICY);
  assert.strictEqual(result.tier, 'unknown');
  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.needs_review, true);
};

// --- CTO P1 #4 boundary tests: 1, 2, 3, 4, 5, 6+, 10+ years ---
tests['1 year -> acceptable, passes, no review'] = () => {
  const result = evaluateExperienceGate('AI Engineer', '1 year of experience required.', POLICY);
  assert.strictEqual(result.tier, 'acceptable');
  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.needs_review, false);
};

tests['2 years -> acceptable, passes, no review'] = () => {
  const result = evaluateExperienceGate('AI Engineer', '2 years of experience required.', POLICY);
  assert.strictEqual(result.tier, 'acceptable');
  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.needs_review, false);
};

tests['3 years -> ideal, passes, no review'] = () => {
  const result = evaluateExperienceGate('AI Engineer', '3 years of experience required.', POLICY);
  assert.strictEqual(result.tier, 'ideal');
  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.needs_review, false);
};

tests['4 years -> stretch, passes but flagged for review'] = () => {
  const result = evaluateExperienceGate('AI Engineer', '4 years of experience required.', POLICY);
  assert.strictEqual(result.tier, 'stretch');
  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.needs_review, true);
};

tests['5 years -> HARD REJECT (must never sneak through via tolerance)'] = () => {
  const result = evaluateExperienceGate('AI Engineer', '5 years of experience required.', POLICY);
  assert.strictEqual(result.tier, 'hard_reject');
  assert.strictEqual(result.passed, false);
};

tests['6+ years -> hard reject'] = () => {
  const result = evaluateExperienceGate('AI Engineer', '6+ years of experience required.', POLICY);
  assert.strictEqual(result.tier, 'hard_reject');
  assert.strictEqual(result.passed, false);
};

tests['10+ years -> hard reject'] = () => {
  const result = evaluateExperienceGate('AI Engineer', '10+ years of experience required.', POLICY);
  assert.strictEqual(result.tier, 'hard_reject');
  assert.strictEqual(result.passed, false);
};

tests['title suffix "I" / "II" style annotations do not affect an explicit-years job'] = () => {
  const { requirement } = classifyExperienceRequirement('AI Software Engineer I', '2 years of experience with Python required.');
  assert.strictEqual(requirement.min_years, 2);
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
