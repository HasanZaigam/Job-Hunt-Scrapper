import assert from 'assert';
import { fromRemotive, fromRemoteOk, fromHimalayas, fromJobicy, fromArbeitnow, fromHnComment, htmlToText } from '../remote-boards';
import { isEligibleLocation } from '../filters';

type Test = () => void;
const tests: Record<string, Test> = {};

tests['htmlToText strips tags/entities and keeps line breaks'] = () => {
  assert.strictEqual(htmlToText('<p>Build &amp; ship</p><ul><li>RAG</li><li>LLMs</li></ul>'), 'Build & ship\nRAG\nLLMs');
};

tests['htmlToText decodes hex numeric entities (HN API uses these, not decimal)'] = () => {
  assert.strictEqual(htmlToText('We&#x27;re hiring &#x2F; AI&#x2F;ML'), "We're hiring / AI/ML");
  assert.strictEqual(htmlToText('&#39; and &#x27; both decode to an apostrophe'), "' and ' both decode to an apostrophe");
};

tests['Remotive: worldwide is eligible, region-locked is not'] = () => {
  const base = { url: 'https://remotive.com/j/1', title: 'AI Engineer', company_name: 'Acme', description: '<p>x</p>' };
  const open = fromRemotive({ ...base, candidate_required_location: 'Worldwide' })!;
  assert.strictEqual(open.location, 'Remote - Worldwide');
  assert.strictEqual(isEligibleLocation(open.location), true);
  for (const where of ['USA Only', 'Europe', 'UK', 'Canada']) {
    assert.strictEqual(isEligibleLocation(fromRemotive({ ...base, candidate_required_location: where })!.location), false, where);
  }
  assert.strictEqual(isEligibleLocation(fromRemotive({ ...base, candidate_required_location: 'India' })!.location), true);
  assert.strictEqual(isEligibleLocation(fromRemotive({ ...base, candidate_required_location: 'APAC' })!.location), true);
};

tests['RemoteOK: maps fields, salary, tags; skips the legal-notice row'] = () => {
  const j = fromRemoteOk({ url: 'https://remoteok.com/remote-jobs/1', position: 'LLM Engineer', company: 'Foo', location: 'Worldwide', salary_min: 60000, salary_max: 90000, tags: ['ai', 'python'], description: '<p>Hi</p>' })!;
  assert.strictEqual(j.salary_range, '60000-90000 USD');
  assert.ok(j.jd_text.includes('Tags: ai python'));
  assert.strictEqual(isEligibleLocation(j.location), true);
  assert.strictEqual(fromRemoteOk({ legal: 'terms…' }), null);
  assert.strictEqual(fromRemoteOk({ url: 'u', position: 'p', company: 'c', location: 'United States' })!.location, 'Remote - United States');
  assert.strictEqual(isEligibleLocation('Remote - United States'), false);
  assert.strictEqual(fromRemoteOk({ url: 'u', position: 'p', company: 'c', salary_min: 0, salary_max: 0 })!.salary_range, null);
};

tests['Himalayas: empty restrictions = worldwide; country list must include India'] = () => {
  const base = { guid: 'https://himalayas.app/jobs/x', title: 'Applied AI Engineer', companyName: 'Bar', description: '<p>d</p>' };
  assert.strictEqual(isEligibleLocation(fromHimalayas({ ...base, locationRestrictions: [] })!.location), true);
  assert.strictEqual(isEligibleLocation(fromHimalayas({ ...base, locationRestrictions: ['United States'] })!.location), false);
  assert.strictEqual(isEligibleLocation(fromHimalayas({ ...base, locationRestrictions: ['United States', 'India'] })!.location), true);
  assert.strictEqual(fromHimalayas({ ...base, minSalary: 50000, maxSalary: 70000, currency: 'EUR' })!.salary_range, '50000-70000 EUR');
  assert.strictEqual(fromHimalayas({ title: 'x' }), null);
};

tests['Jobicy: maps fields, falls back to Worldwide when jobGeo is blank'] = () => {
  const j = fromJobicy({ url: 'https://jobicy.com/jobs/1', jobTitle: 'LLM Engineer', companyName: 'Acme', jobGeo: 'India', jobDescription: '<p>x</p>', salaryMin: 50000, salaryMax: 70000, salaryCurrency: 'USD' })!;
  assert.strictEqual(j.location, 'Remote - India');
  assert.strictEqual(isEligibleLocation(j.location), true);
  assert.strictEqual(j.salary_range, '50000-70000 USD');
  assert.strictEqual(fromJobicy({ url: 'u', jobTitle: 't', companyName: 'c', jobGeo: '', jobDescription: 'd' })!.location, 'Remote - Worldwide');
  assert.strictEqual(fromJobicy({ jobTitle: 'x' }), null);
};

tests['Arbeitnow: only remote:true rows map; location field is unreliable (base city, not a restriction)'] = () => {
  assert.strictEqual(fromArbeitnow({ url: 'u', title: 't', company_name: 'c', remote: false, location: 'Berlin', description: 'd' }), null);
  const j = fromArbeitnow({ url: 'https://arbeitnow.com/jobs/1', title: 'AI Engineer', company_name: 'Acme', remote: true, location: 'Worldwide', description: '<p>x</p>' })!;
  assert.strictEqual(j.location, 'Remote - Worldwide');
  assert.strictEqual(isEligibleLocation(j.location), true);
  assert.strictEqual(fromArbeitnow({ title: 'x' }), null);
};

tests['HN: requires both "remote" and an AI/ML word, parses company/role from the first line'] = () => {
  const aiRemote = { id: 123, text: 'Acme Corp (Remote, Worldwide) | AI Engineer | Python, LLMs<p>We build AI products.' };
  const j = fromHnComment(999, aiRemote)!;
  assert.strictEqual(j.company, 'Acme Corp');
  assert.ok(j.role.includes('AI Engineer'));
  assert.strictEqual(j.jd_url, 'https://news.ycombinator.com/item?id=123');
  assert.strictEqual(isEligibleLocation(j.location), true);

  // Remote but no AI/ML word at all -> not collected by this source.
  assert.strictEqual(fromHnComment(999, { id: 1, text: 'Acme (Remote) | Backend Engineer | Ruby on Rails' }), null);
  // AI/ML word but not remote -> not collected (onsite-only posts aren't this source's job).
  assert.strictEqual(fromHnComment(999, { id: 2, text: 'Acme (SF, onsite) | AI Engineer | Python' }), null);
  // A US-only remote AI role is correctly rejected by the shared location parser.
  const usOnly = fromHnComment(999, { id: 3, text: 'Acme (Remote, US only) | ML Engineer | Python, PyTorch' })!;
  assert.strictEqual(isEligibleLocation(usOnly.location), false);
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
