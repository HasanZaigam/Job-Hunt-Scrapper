import assert from 'assert';
import { scoreRequirements } from '../skill-fit';
import type { ExtractedRequirement } from '../../types';

type Test = () => void;
const tests: Record<string, Test> = {};

const req = (skill: string, requirement_type: 'required' | 'preferred' = 'required'): ExtractedRequirement => ({
  skill,
  requirement_type,
  quoted_context: '',
});

tests['all-exact-required scores 100'] = () => {
  const result = scoreRequirements([req('Python'), req('FastAPI')], ['Python', 'FastAPI'], null);
  assert.strictEqual(result.score, 100);
};

tests['all-missing scores 0'] = () => {
  const result = scoreRequirements([req('Swift'), req('Kotlin')], ['Python', 'FastAPI'], null);
  assert.strictEqual(result.score, 0);
};

tests['REQUIRED vs PREFERRED: missing a required skill hurts more than missing a preferred one'] = () => {
  // Case A: 1 required matched (exact) + 1 preferred missing
  const caseA = scoreRequirements(
    [req('Python', 'required'), req('Kubernetes', 'preferred')],
    ['Python'],
    null
  );
  // Case B: 1 required missing + 1 preferred matched (exact)
  const caseB = scoreRequirements(
    [req('Kubernetes', 'required'), req('Python', 'preferred')],
    ['Python'],
    null
  );
  assert.ok(caseA.score! > caseB.score!, `expected caseA (${caseA.score}) > caseB (${caseB.score}) — missing a required skill must cost more than missing a preferred one`);
};

tests['weighting formula matches hand computation'] = () => {
  // required Python (exact, weight 1.0*1.0=1.0) + preferred Kubernetes (missing, weight 0.4*0=0)
  // weightSum = 1.0 + 0.4 = 1.4; contributionSum = 1.0; score = round(1.0/1.4*100) = 71
  const result = scoreRequirements(
    [req('Python', 'required'), req('Kubernetes', 'preferred')],
    ['Python'],
    null
  );
  assert.strictEqual(result.score, 71);
};

tests['strong_semantic and related both earn partial credit, missing earns none'] = () => {
  // required GenAI (strong_semantic vs LLM Integration, weight 1.0*0.8=0.8)
  const exactCase = scoreRequirements([req('LLM Integration', 'required')], ['LLM Integration'], null);
  const semanticCase = scoreRequirements([req('GenAI', 'required')], ['LLM Integration'], null);
  const relatedCase = scoreRequirements([req('Gemini API', 'required')], ['LangChain'], null);
  const missingCase = scoreRequirements([req('RAG', 'required')], ['Docker'], null);
  assert.ok(exactCase.score! > semanticCase.score!, 'exact must score higher than strong_semantic');
  assert.ok(semanticCase.score! > relatedCase.score!, 'strong_semantic must score higher than related');
  assert.ok(relatedCase.score! > missingCase.score!, 'related must score higher than missing');
  assert.strictEqual(missingCase.score, 0);
};

tests['zero requirements extracted -> score null, needs_review true (unchanged strict-fallback behavior)'] = () => {
  const result = scoreRequirements([], ['Python'], null);
  assert.strictEqual(result.score, null);
  assert.strictEqual(result.needs_review, true);
};

tests['per-requirement audit trail is present for every scored requirement'] = () => {
  const result = scoreRequirements([req('Python', 'required')], ['Python'], 'gemini-3.5-flash-lite');
  assert.strictEqual(result.evidence.requirements.length, 1);
  const r = result.evidence.requirements[0];
  assert.strictEqual(r.match_strength, 'exact');
  assert.ok(typeof r.contribution === 'number');
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
  assert.strictEqual(result.evidence.extraction_model, 'gemini-3.5-flash-lite');
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
