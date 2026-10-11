import assert from 'assert';
import { isEligibleLocation, matchesAiKeywords, matchesKeywords } from '../filters';
import { gateReason } from '../quality-gate';
import { ashbyLocation } from '../ashby';

type Test = () => void;
const tests: Record<string, Test> = {};
const JD = 'We build LLM applications with Python and need an engineer to ship AI features. '.repeat(6);

// ---- location (problems 1 & 2)
tests['US-only remote is rejected'] = () => {
  for (const l of ['Remote - US', 'Remote (USA only)', 'Remote, United States', 'Remote - Canada', 'Remote - UK', 'Remote - Europe']) {
    assert.strictEqual(isEligibleLocation(l), false, l);
  }
};
tests['"Indianapolis" is not India'] = () => {
  assert.strictEqual(isEligibleLocation('Indianapolis, IN'), false);
};
tests['remote open to India / worldwide is kept'] = () => {
  for (const l of ['Remote', 'Remote - India', 'Worldwide', 'Remote, Asia', 'APAC (Remote)']) {
    assert.strictEqual(isEligibleLocation(l), true, l);
  }
};
tests['India onsite / hybrid is kept (cities and states)'] = () => {
  for (const l of ['Noida, India', 'Bengaluru, Karnataka, India', 'Pune, Maharashtra', 'Gurugram', 'Hybrid - Hyderabad', 'Jaipur']) {
    assert.strictEqual(isEligibleLocation(l), true, l);
  }
};
tests['onsite outside India and unknown locations are rejected'] = () => {
  for (const l of ['San Francisco', 'London, UK', 'Berlin, Germany', 'Unknown', '']) {
    assert.strictEqual(isEligibleLocation(l), false, l);
  }
};
tests['Ashby remote jobs keep their region'] = () => {
  const us = ashbyLocation({ isRemote: true, location: 'United States' });
  assert.strictEqual(isEligibleLocation(us), false, us);
  const india = ashbyLocation({ isRemote: true, location: 'India' });
  assert.strictEqual(isEligibleLocation(india), true, india);
  assert.strictEqual(ashbyLocation({ isRemote: true }), 'Remote');
  assert.strictEqual(ashbyLocation({ location: 'Bengaluru', address: { postalAddress: { addressCountry: 'India' } } }), 'Bengaluru; India');
};

// ---- title matching (problem 3)
tests['AI/ML terms match as whole words only'] = () => {
  for (const t of ['AI Engineer', 'Senior ML Engineer', 'AI/ML Engineer', 'Generative AI Developer', 'LLMs Platform Engineer', 'MLOps Engineer', 'Gen-AI Lead']) {
    assert.strictEqual(matchesAiKeywords(t), true, t);
  }
};
tests['look-alike substrings no longer match'] = () => {
  for (const t of ['Email Marketing Manager', 'Retail Sales Associate', 'HTML Email Developer', 'Maintenance Technician', 'Senior Account Executive, Domain']) {
    assert.strictEqual(matchesAiKeywords(t), false, t);
  }
};
tests['matchesKeywords is empty-safe'] = () => {
  assert.strictEqual(matchesKeywords('', ['AI']), false);
};

// ---- quality gate (problems 3 & 4)
tests['v1 gate now blocks "Senior" titles'] = () => {
  for (const r of ['Senior AI Engineer', 'Sr. ML Engineer', 'AI Architect']) {
    assert.strictEqual(gateReason(r, JD), 'senior-only title', r);
  }
  assert.strictEqual(gateReason('AI Engineer', JD), null);
};
tests['gate no longer passes a job with an empty title and no AI content'] = () => {
  const plain = 'We sell insurance and manage claims for retail customers across the region. '.repeat(8);
  assert.ok(gateReason('', plain)?.startsWith('non-target'));
};
tests['gate rejects look-alike titles whose body has no AI content'] = () => {
  const plain = 'We sell insurance and manage claims for retail customers across the region. '.repeat(8);
  assert.ok(gateReason('Email Marketing Associate', plain)?.startsWith('non-target'));
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
  for (const r of results) {
    console.log(`${r.passed ? '  ✓' : '  ✗'} ${r.name}${r.passed ? '' : `\n    ${r.error}`}`);
    if (!r.passed) failed++;
  }
  console.log(`\n--- ${results.length - failed} passed, ${failed} failed (${results.length} total) ---`);
  if (failed) process.exitCode = 1;
}
