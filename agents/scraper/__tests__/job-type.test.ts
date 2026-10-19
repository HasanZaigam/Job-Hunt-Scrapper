// Run: cd agents && npx ts-node scraper/__tests__/job-type.test.ts
import assert from 'assert';
import { classifyJobType } from '../job-type';

type Test = () => void;
const tests: Record<string, Test> = {};

tests['"Software Engineer – AI Evaluation Expert (Contractual)" -> contract_gig'] = () => {
  const jd = 'This is a contract role evaluating AI model outputs for quality and accuracy. '.repeat(5);
  assert.strictEqual(classifyJobType('Software Engineer – AI Evaluation Expert (Contractual)', jd, { isManualRequired: true }), 'contract_gig');
};

tests['"Software Engineer, AI Coding Tasks" with per-task pay -> contract_gig'] = () => {
  const jd = 'Complete AI coding tasks and get paid per task. Flexible freelance work. '.repeat(5);
  assert.strictEqual(classifyJobType('Software Engineer, AI Coding Tasks', jd, { isManualRequired: true, salaryRange: '$20-40 per hour' }), 'contract_gig');
};

tests['"AI Trainer" data-labeling gig -> contract_gig'] = () => {
  const jd = 'Independent contractor role doing AI model training and data annotation tasks. '.repeat(5);
  assert.strictEqual(classifyJobType('AI Trainer', jd, { isManualRequired: true }), 'contract_gig');
};

tests['a normal ATS full-time JD with no gig signal -> full_time'] = () => {
  const jd = 'We are hiring a full-time AI Engineer to join our growing team and build LLM features. '.repeat(5);
  assert.strictEqual(classifyJobType('AI Engineer', jd), 'full_time');
};

tests['a normal ATS JD with NO signal either way defaults to full_time (greenhouse/lever/ashby norm)'] = () => {
  const jd = 'We build LLM applications with Python and need an engineer to ship AI features. '.repeat(6);
  assert.strictEqual(classifyJobType('AI Engineer', jd), 'full_time');
};

tests['a manual-apply (remote board) posting with NO signal either way -> unknown, not assumed full_time'] = () => {
  const jd = 'We build LLM applications with Python and need an engineer to ship AI features. '.repeat(6);
  assert.strictEqual(classifyJobType('AI Engineer', jd, { isManualRequired: true }), 'unknown');
};

tests['explicit "Permanent" on a manual-apply posting still resolves to full_time'] = () => {
  const jd = 'This is a permanent, full-time remote position building AI features. '.repeat(5);
  assert.strictEqual(classifyJobType('AI Engineer', jd, { isManualRequired: true }), 'full_time');
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log(' ✓', name); }
  catch (e: any) { failed++; console.log(' ✗', name, '\n   ', e.message); }
}
console.log(`\n--- ${Object.keys(tests).length - failed} passed, ${failed} failed (${Object.keys(tests).length} total) ---`);
if (failed) process.exit(1);
