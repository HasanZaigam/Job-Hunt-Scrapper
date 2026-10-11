import assert from 'assert';
import { buildV2PersistencePayload, persistV2Result } from '../persistence';
import { V2_ENGINE_VERSION } from '../version';
import type { HardVetoResult, OpportunityScore, RoleFamilyGateResult, ExperienceGateResult, LocationGateResult } from '../types';

// No network calls anywhere in this file — buildV2PersistencePayload is a
// pure function, and persistV2Result is tested against a hand-rolled fake
// Supabase client that only records what it was called with.

type Test = () => void | Promise<void>;
const tests: Record<string, Test> = {};

const roleFamily: RoleFamilyGateResult = {
  family: 'ai_ml_engineer',
  confidence: 'high',
  passed: true,
  needs_review: false,
  reason: 'test',
  evidence: { matched_keywords: {}, top_family_hits: 2, runner_up_family: null, runner_up_hits: 0, engineering_signals: [], non_engineering_signals: [] },
};

const experience: ExperienceGateResult = {
  requirement: { min_years: 2, max_years: null, band: 'junior_2_4', source: 'single_number' },
  tier: 'acceptable',
  passed: true,
  needs_review: false,
  reason: 'test',
  evidence: { matched_phrase: '2 years', years_found: [2], effective_years: 2 },
};

const location: LocationGateResult = {
  location: { raw_location: 'Bengaluru, India', country: 'in', city: 'bengaluru', remote_flag: 'onsite', category: 'onsite_india' },
  passed: true,
  needs_review: false,
  reason: 'test',
  evidence: { matched_country_hint: 'India', matched_city_hint: 'bengaluru', matched_onsite_city: 'bengaluru', matched_qualifier: null },
};

function makeGate(overrides: Partial<HardVetoResult> = {}): HardVetoResult {
  return {
    vetoed: false,
    needs_review: false,
    reason: null,
    failing_reasons: [],
    gates: { role_family: roleFamily, experience, location },
    experience,
    location,
    ...overrides,
  };
}

const skillFitOk: OpportunityScore['skill_fit'] = {
  score: 80, matched_skills: ['Python'], missing_skills: [], status: 'ok', needs_review: false, reason: 'test',
  evidence: { requirements: [], extraction_model: 'gemini-3.5-flash-lite', extraction_error: null, weights_applied: { requirement_type: { required: 1, preferred: 0.4 }, match_strength: { exact: 1, strong_semantic: 0.8, related: 0.35, missing: 0 } } },
};

function makeOpportunity(overrides: Partial<OpportunityScore> = {}): OpportunityScore {
  return {
    skill_fit: skillFitOk,
    seniority_fit: { score: 100, band_distance: 0, reason: 'test' },
    freshness: { score: 100, days_old: 0, reason: 'test' },
    compensation: { status: 'not_disclosed', raw: null, score: 50, reason: 'test' },
    overall: 90,
    weights_used: { skill_fit: 0.4, seniority_fit: 0.25, freshness: 0.15, compensation: 0.2 },
    ...overrides,
  };
}

// --- buildV2PersistencePayload: pure mapping tests ---

tests['maps engine_version from the version constant'] = () => {
  const payload = buildV2PersistencePayload(makeGate(), null, new Date('2026-01-01T00:00:00Z'));
  assert.strictEqual(payload.engine_version, V2_ENGINE_VERSION);
  assert.strictEqual(payload.v2_result.engine_version, V2_ENGINE_VERSION);
};

tests['maps role_family from gates.role_family.family'] = () => {
  const payload = buildV2PersistencePayload(makeGate(), null, new Date());
  assert.strictEqual(payload.role_family, 'ai_ml_engineer');
};

tests['opportunity_score is null when opportunity is null (gates-only path)'] = () => {
  const payload = buildV2PersistencePayload(makeGate(), null, new Date());
  assert.strictEqual(payload.opportunity_score, null);
};

tests['opportunity_score maps from opportunity.overall when scoring ran'] = () => {
  const payload = buildV2PersistencePayload(makeGate(), makeOpportunity({ overall: 73 }), new Date());
  assert.strictEqual(payload.opportunity_score, 73);
};

tests['priority_bucket is ALWAYS null — thresholds are not approved yet, never fabricated'] = () => {
  const payload1 = buildV2PersistencePayload(makeGate(), null, new Date());
  const payload2 = buildV2PersistencePayload(makeGate(), makeOpportunity({ overall: 95 }), new Date());
  assert.strictEqual(payload1.priority_bucket, null);
  assert.strictEqual(payload2.priority_bucket, null, 'even a high score must not produce a fabricated bucket');
};

tests['needs_review reduces to gate.needs_review alone when opportunity is null'] = () => {
  const gate = makeGate({ needs_review: true });
  const payload = buildV2PersistencePayload(gate, null, new Date());
  assert.strictEqual(payload.needs_review, true);
};

tests['needs_review is the union of gate and skill_fit needs_review'] = () => {
  const gate = makeGate({ needs_review: false });
  const opportunity = makeOpportunity({ skill_fit: { ...skillFitOk, needs_review: true } });
  const payload = buildV2PersistencePayload(gate, opportunity, new Date());
  assert.strictEqual(payload.needs_review, true);
};

tests['needs_review is false only when neither gate nor skill_fit need review'] = () => {
  const payload = buildV2PersistencePayload(makeGate({ needs_review: false }), makeOpportunity(), new Date());
  assert.strictEqual(payload.needs_review, false);
};

tests['v2_result preserves the full gate evidence, not a trimmed subset'] = () => {
  const gate = makeGate();
  const payload = buildV2PersistencePayload(gate, null, new Date());
  assert.deepStrictEqual(payload.v2_result.gates.role_family, gate.gates.role_family);
  assert.deepStrictEqual(payload.v2_result.gates.experience, gate.gates.experience);
  assert.deepStrictEqual(payload.v2_result.gates.location, gate.gates.location);
  assert.strictEqual(payload.v2_result.gates.vetoed, gate.vetoed);
  assert.deepStrictEqual(payload.v2_result.gates.failing_reasons, gate.failing_reasons);
};

tests['v2_result.scoring is the full OpportunityScore object when scoring ran, not a summary'] = () => {
  const opportunity = makeOpportunity();
  const payload = buildV2PersistencePayload(makeGate(), opportunity, new Date());
  assert.deepStrictEqual(payload.v2_result.scoring, opportunity);
};

tests['v2_scored_at and v2_result.scored_at are the same ISO timestamp passed in'] = () => {
  const d = new Date('2026-03-15T10:30:00Z');
  const payload = buildV2PersistencePayload(makeGate(), null, d);
  assert.strictEqual(payload.v2_scored_at, d.toISOString());
  assert.strictEqual(payload.v2_result.scored_at, d.toISOString());
};

tests['payload never contains a status field or any V1/application-lifecycle key'] = () => {
  const payload: any = buildV2PersistencePayload(makeGate(), makeOpportunity(), new Date());
  const forbiddenKeys = ['status', 'match_score', 'match_justification', 'matched_skills', 'missing_skills', 'score_breakdown', 'resume_storage_url', 'cover_letter_storage_url', 'applied_at', 'starred'];
  for (const key of forbiddenKeys) {
    assert.strictEqual(key in payload, false, `payload must never contain "${key}"`);
  }
};

tests['a hard-vetoed job still gets a payload — role_family/needs_review persist, score/bucket stay null'] = () => {
  const gate = makeGate({ vetoed: true, failing_reasons: ['experience: hard reject'], reason: 'experience: hard reject' });
  const payload = buildV2PersistencePayload(gate, null, new Date());
  assert.strictEqual(payload.role_family, 'ai_ml_engineer');
  assert.strictEqual(payload.opportunity_score, null);
  assert.strictEqual(payload.priority_bucket, null);
  assert.strictEqual(payload.v2_result.gates.vetoed, true);
};

// --- persistV2Result: fake Supabase client, zero network calls ---

interface FakeCall {
  table: string;
  updatePayload: any;
  eqColumn: string;
  eqValue: string;
}

function makeFakeSupabase(errorToReturn: { message: string } | null = null) {
  const calls: FakeCall[] = [];
  const client: any = {
    from(table: string) {
      return {
        update(updatePayload: any) {
          return {
            eq(eqColumn: string, eqValue: string) {
              calls.push({ table, updatePayload, eqColumn, eqValue });
              return Promise.resolve({ error: errorToReturn, data: errorToReturn ? null : [{ id: eqValue }] });
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

tests['persistV2Result issues exactly one UPDATE, scoped to the given job id, on the applications table'] = async () => {
  const { client, calls } = makeFakeSupabase();
  const payload = buildV2PersistencePayload(makeGate(), null, new Date());
  const result = await persistV2Result(client, 'job-123', payload);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].table, 'applications');
  assert.strictEqual(calls[0].eqColumn, 'id');
  assert.strictEqual(calls[0].eqValue, 'job-123');
  assert.deepStrictEqual(calls[0].updatePayload, payload);
};

tests['persistV2Result propagates a Supabase error without throwing'] = async () => {
  const { client } = makeFakeSupabase({ message: 'connection refused' });
  const payload = buildV2PersistencePayload(makeGate(), null, new Date());
  const result = await persistV2Result(client, 'job-456', payload);

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'connection refused');
};

tests['persistV2Result never calls .from() on any table other than applications'] = async () => {
  const { client, calls } = makeFakeSupabase();
  const payload = buildV2PersistencePayload(makeGate(), makeOpportunity(), new Date());
  await persistV2Result(client, 'job-789', payload);
  assert.ok(calls.every(c => c.table === 'applications'));
};

export async function run(): Promise<{ name: string; passed: boolean; error?: string }[]> {
  const results: { name: string; passed: boolean; error?: string }[] = [];
  for (const [name, fn] of Object.entries(tests)) {
    try {
      await fn();
      results.push({ name, passed: true });
    } catch (err: any) {
      results.push({ name, passed: false, error: err?.message || String(err) });
    }
  }
  return results;
}
