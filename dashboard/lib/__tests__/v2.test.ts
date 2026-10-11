import assert from 'assert';
import {
  classifyV2State, v2StateLabel, v1Admitted, v2Admitted, detectDisagreement,
  formatOpportunityScore, formatPriorityBucket, formatNeedsReview,
  getRoleFamilySection, getExperienceSection, getLocationSection,
  getSkillFitSection, getOpportunitySection, matchesFilter,
  type V2ApplicationRow,
} from '../v2';

// Same lightweight assertion pattern as agents/matcher/v2/run-tests.ts — no
// test framework dependency added, since neither package has one today.

type Test = () => void;
const tests: Record<string, Test> = {};

function baseRow(overrides: Partial<V2ApplicationRow> = {}): V2ApplicationRow {
  return {
    id: 'job-1',
    company: 'Acme',
    role: 'AI Engineer',
    location: 'Bengaluru, India',
    ats_type: 'greenhouse',
    jd_url: 'https://example.com/jobs/1',
    status: 'scraped',
    match_score: null,
    match_justification: null,
    engine_version: null,
    role_family: null,
    opportunity_score: null,
    priority_bucket: null,
    needs_review: null,
    v2_scored_at: null,
    v2_result: null,
    ...overrides,
  };
}

const gatesOnlyResult = {
  engine_version: '2.2.0',
  gates: {
    vetoed: false,
    failing_reasons: [],
    role_family: { family: 'ai_ml_engineer', passed: true, confidence: 'high', reason: 'title match', evidence: { top_family_hits: 2 } },
    experience: { requirement: { min_years: 2, max_years: null }, tier: 'acceptable', passed: true, reason: '2 years, acceptable', evidence: { effective_years: 2 } },
    location: { passed: true, reason: 'onsite_india — eligible', location: { category: 'onsite_india', country: 'in', city: 'bengaluru' }, evidence: {} },
  },
  scoring: null,
  scored_at: '2026-01-01T00:00:00.000Z',
};

const fullyScoredResult = {
  ...gatesOnlyResult,
  scoring: {
    skill_fit: {
      score: 80, needs_review: false, reason: '2/2 matched',
      evidence: {
        extraction_model: 'gemini-3.5-flash-lite',
        requirements: [
          { requirement: { skill: 'Python', requirement_type: 'required', quoted_context: '2 years of Python' }, match_strength: 'exact', matched_evidence: 'Python' },
          { requirement: { skill: 'Kubernetes', requirement_type: 'preferred', quoted_context: 'Kubernetes a plus' }, match_strength: 'missing', matched_evidence: null },
        ],
      },
    },
    seniority_fit: { score: 100, reason: 'acceptable tier' },
    freshness: { score: 90, reason: 'scraped 2 days ago' },
    compensation: { status: 'not_disclosed', score: 50, reason: 'no salary field' },
    overall: 78,
    weights_used: { skill_fit: 0.4, seniority_fit: 0.25, freshness: 0.15, compensation: 0.2 },
  },
};

// --- classifyV2State ---

tests['not_evaluated when engine_version is null (default/expected today)'] = () => {
  const row = baseRow();
  assert.strictEqual(classifyV2State(row), 'not_evaluated');
};

tests['not_evaluated when engine_version is "v1"'] = () => {
  const row = baseRow({ engine_version: 'v1' });
  assert.strictEqual(classifyV2State(row), 'not_evaluated');
};

tests['gates_only when v2_result.gates present but no scoring — the CURRENT expected shape'] = () => {
  const row = baseRow({ engine_version: '2.2.0', role_family: 'ai_ml_engineer', needs_review: false, v2_result: gatesOnlyResult, opportunity_score: null });
  assert.strictEqual(classifyV2State(row), 'gates_only');
};

tests['fully_scored when v2_result.scoring AND opportunity_score are both present'] = () => {
  const row = baseRow({ engine_version: '2.2.0', v2_result: fullyScoredResult, opportunity_score: 78 });
  assert.strictEqual(classifyV2State(row), 'fully_scored');
};

tests['v2StateLabel: gates_only never reads as a failure'] = () => {
  const label = v2StateLabel('gates_only');
  assert.strictEqual(label, 'V2 gates evaluated — scoring not run');
  assert.ok(!/fail|error/i.test(label));
};

// --- V1/V2 admit and disagreement detection ---

tests['v1Admitted: status !== "filtered" is admitted'] = () => {
  assert.strictEqual(v1Admitted({ status: 'matched' }), true);
  assert.strictEqual(v1Admitted({ status: 'filtered' }), false);
};

tests['v2Admitted: null when V2 has not evaluated the row (not a rejection)'] = () => {
  assert.strictEqual(v2Admitted(baseRow()), null);
};

tests['V2 admit / V1 reject is distinguishable from V2 reject / V1 admit'] = () => {
  const v1RejectV2Admit = baseRow({
    status: 'filtered', engine_version: '2.2.0',
    v2_result: gatesOnlyResult, // vetoed: false -> V2 admits
  });
  const v1AdmitV2Reject = baseRow({
    status: 'matched', engine_version: '2.2.0',
    v2_result: { ...gatesOnlyResult, gates: { ...gatesOnlyResult.gates, vetoed: true } },
  });
  assert.strictEqual(detectDisagreement(v1RejectV2Admit), 'v1_reject_v2_admit');
  assert.strictEqual(detectDisagreement(v1AdmitV2Reject), 'v1_admit_v2_reject');
  assert.notStrictEqual(detectDisagreement(v1RejectV2Admit), detectDisagreement(v1AdmitV2Reject));
};

tests['no disagreement when both engines agree'] = () => {
  const row = baseRow({ status: 'matched', engine_version: '2.2.0', v2_result: gatesOnlyResult });
  assert.strictEqual(detectDisagreement(row), 'none');
};

tests['disagreement is "unknown", not "none", when V2 has not evaluated the row'] = () => {
  const row = baseRow({ status: 'matched' });
  assert.strictEqual(detectDisagreement(row), 'unknown');
};

// --- null-safety formatters ---

tests['formatOpportunityScore: null renders as "Not scored", never "0"'] = () => {
  assert.strictEqual(formatOpportunityScore(null), 'Not scored');
  assert.notStrictEqual(formatOpportunityScore(null), '0');
  assert.strictEqual(formatOpportunityScore(0), '0'); // a REAL score of 0 must still render as 0, not "Not scored"
  assert.strictEqual(formatOpportunityScore(78), '78');
};

tests['formatPriorityBucket: null renders as "Not assigned", never derived from a score'] = () => {
  assert.strictEqual(formatPriorityBucket(null), 'Not assigned');
  assert.strictEqual(formatPriorityBucket(undefined), 'Not assigned');
  assert.strictEqual(formatPriorityBucket('apply_now'), 'apply_now');
};

tests['formatNeedsReview renders true/false|null distinctly'] = () => {
  assert.strictEqual(formatNeedsReview(true), 'Needs review');
  assert.strictEqual(formatNeedsReview(false), 'No');
  assert.strictEqual(formatNeedsReview(null), 'No');
};

// --- section extractors: present vs. missing ---

tests['getRoleFamilySection: present on a gates-only row'] = () => {
  const row = baseRow({ v2_result: gatesOnlyResult });
  const section = getRoleFamilySection(row);
  assert.ok(section);
  assert.strictEqual(section!.family, 'ai_ml_engineer');
  assert.strictEqual(section!.passed, true);
};

tests['getRoleFamilySection: null when v2_result is entirely absent (not_evaluated row) — no crash'] = () => {
  const section = getRoleFamilySection(baseRow());
  assert.strictEqual(section, null);
};

tests['getExperienceSection and getLocationSection are present on a gates-only row'] = () => {
  const row = baseRow({ v2_result: gatesOnlyResult });
  assert.ok(getExperienceSection(row));
  assert.strictEqual(getExperienceSection(row)!.tier, 'acceptable');
  assert.ok(getLocationSection(row));
  assert.strictEqual(getLocationSection(row)!.category, 'onsite_india');
};

tests['getSkillFitSection and getOpportunitySection are null on a gates-only row (scoring did not run)'] = () => {
  const row = baseRow({ v2_result: gatesOnlyResult });
  assert.strictEqual(getSkillFitSection(row), null);
  assert.strictEqual(getOpportunitySection(row), null);
};

tests['getSkillFitSection: present and preserves the full nested requirement audit trail on a fully-scored row'] = () => {
  const row = baseRow({ v2_result: fullyScoredResult, opportunity_score: 78 });
  const section = getSkillFitSection(row);
  assert.ok(section);
  assert.strictEqual(section!.score, 80);
  assert.strictEqual(section!.requirements.length, 2);
  assert.strictEqual(section!.requirements[0].skill, 'Python');
  assert.strictEqual(section!.requirements[0].match_strength, 'exact');
  assert.strictEqual(section!.requirements[1].match_strength, 'missing');
  assert.strictEqual(section!.extraction_model, 'gemini-3.5-flash-lite');
};

tests['getOpportunitySection: preserves component scores without inventing calculations'] = () => {
  const row = baseRow({ v2_result: fullyScoredResult, opportunity_score: 78 });
  const section = getOpportunitySection(row);
  assert.ok(section);
  assert.strictEqual(section!.overall, 78);
  assert.strictEqual(section!.seniority_fit!.score, 100);
  assert.strictEqual(section!.compensation!.status, 'not_disclosed');
  assert.deepStrictEqual(section!.weights_used, fullyScoredResult.scoring.weights_used);
};

tests['missing optional V2 sections do not crash extraction on a completely empty v2_result'] = () => {
  const row = baseRow({ engine_version: '2.2.0', v2_result: {} });
  assert.strictEqual(getRoleFamilySection(row), null);
  assert.strictEqual(getExperienceSection(row), null);
  assert.strictEqual(getLocationSection(row), null);
  assert.strictEqual(getSkillFitSection(row), null);
  assert.strictEqual(getOpportunitySection(row), null);
};

// --- filters ---

tests['matchesFilter: needs_review filter only matches rows with needs_review === true'] = () => {
  const yes = baseRow({ needs_review: true });
  const no = baseRow({ needs_review: false });
  assert.strictEqual(matchesFilter(yes, 'needs_review'), true);
  assert.strictEqual(matchesFilter(no, 'needs_review'), false);
};

tests['matchesFilter: gate_only vs fully_scored are mutually exclusive'] = () => {
  const gateOnlyRow = baseRow({ engine_version: '2.2.0', v2_result: gatesOnlyResult, opportunity_score: null });
  const scoredRow = baseRow({ engine_version: '2.2.0', v2_result: fullyScoredResult, opportunity_score: 78 });
  assert.strictEqual(matchesFilter(gateOnlyRow, 'gate_only'), true);
  assert.strictEqual(matchesFilter(gateOnlyRow, 'fully_scored'), false);
  assert.strictEqual(matchesFilter(scoredRow, 'gate_only'), false);
  assert.strictEqual(matchesFilter(scoredRow, 'fully_scored'), true);
};

tests['matchesFilter: "all" always matches'] = () => {
  assert.strictEqual(matchesFilter(baseRow(), 'all'), true);
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
