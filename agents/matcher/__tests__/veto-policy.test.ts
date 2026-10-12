import assert from 'assert';
import { effectiveVeto } from '../veto-policy';
import { evaluateHardVeto } from '../v2/hard-veto';

type Test = () => void;
const tests: Record<string, Test> = {};
const INDIA = 'Bengaluru, India';

// A JD whose body vocabulary pulls the keyword classifier away from the title.
const INFRA_BODY = 'Own our DevOps and infrastructure engineering practice, platform engineering, SRE and site reliability, cloud engineer duties with CI/CD pipeline work.' + ' We build AI products.'.repeat(30);

tests['a role-family-only veto is overridden when the title is a preferred title'] = () => {
  for (const title of ['AI Software Engineer (Python)', 'Applied AI Engineer, Agents & Automations']) {
    const v2 = evaluateHardVeto(title, INFRA_BODY, INDIA);
    assert.strictEqual(v2.vetoed, true, `precondition: v2 alone vetoes "${title}"`);
    assert.ok(v2.failing_reasons.every(r => r.startsWith('role_family:')), 'precondition: only the role-family gate failed');
    assert.strictEqual(effectiveVeto(title, v2), null, title);
  }
};

tests['the same body under a non-preferred title keeps the veto'] = () => {
  const v2 = evaluateHardVeto('Platform Reliability Engineer', INFRA_BODY, INDIA);
  assert.strictEqual(v2.vetoed, true);
  assert.ok(effectiveVeto('Platform Reliability Engineer', v2));
};

tests['experience and location vetoes are never overridden, even for a preferred title'] = () => {
  const exp = evaluateHardVeto('AI Engineer', 'Requires 6+ years of experience building LLM applications. ' + ' We build AI products.'.repeat(30), INDIA);
  assert.strictEqual(exp.vetoed, true);
  assert.ok(effectiveVeto('AI Engineer', exp), 'experience veto must stand');
  const loc = evaluateHardVeto('AI Engineer', 'Build LLM applications with Python. ' + ' We build AI products.'.repeat(30), 'San Francisco, CA');
  assert.strictEqual(loc.vetoed, true);
  assert.ok(effectiveVeto('AI Engineer', loc), 'location veto must stand');
};

tests['a job that was not vetoed is never vetoed by the policy'] = () => {
  const v2 = evaluateHardVeto('AI Engineer', 'Build LLM applications with Python and RAG. 2 years of experience. ' + ' We build AI products.'.repeat(30), INDIA);
  assert.strictEqual(effectiveVeto('AI Engineer', v2), null);
};

export function run() {
  return Object.entries(tests).map(([name, fn]) => {
    try { fn(); return { name, passed: true }; }
    catch (e: any) { return { name, passed: false, error: e?.message || String(e) }; }
  });
}
if (require.main === module) {
  const results = run();
  let failed = 0;
  for (const r of results) { console.log(`${r.passed ? '  ✓' : '  ✗'} ${r.name}${r.passed ? '' : `\n    ${(r as any).error}`}`); if (!r.passed) failed++; }
  console.log(`\n--- ${results.length - failed} passed, ${failed} failed (${results.length} total) ---`);
  if (failed) process.exitCode = 1;
}
