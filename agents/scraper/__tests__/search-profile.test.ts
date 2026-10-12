import assert from 'assert';
import { titleRank, skipReason, monthlyInr, FALLBACK_RANK, US_HOURS_MIN_MONTHLY_INR } from '../search-profile';
import { gateReason } from '../quality-gate';

type Test = () => void;
const tests: Record<string, Test> = {};
const PAD = ' We build products used by thousands of customers and value clear communication.'.repeat(6);
const AI = ' You will build LLM applications, RAG pipelines and AI agents with Python and OpenAI.';

// ------------------------------------------------------------ title priority
tests['title 1: AI Engineer (LLM / Agents) family'] = () => {
  for (const t of ['AI Engineer', 'Senior AI Engineer', 'LLM Engineer', 'Applied AI Engineer', 'AI Agent Engineer', 'Agentic AI Engineer', 'AI Software Engineer', 'AI agent engineer', 'Junior AI Engineer']) {
    assert.strictEqual(titleRank(t)?.rank, 1, t);
  }
};
tests['title 2: Generative AI Developer'] = () => {
  for (const t of ['Generative AI Developer', 'GenAI Developer', 'Gen AI Developer', 'AI Developer']) assert.strictEqual(titleRank(t)?.rank, 2, t);
};
tests['title 3: AI Automation Engineer'] = () => {
  for (const t of ['AI Automation Engineer', 'Intelligent Automation Engineer', 'LLM Automation Developer', 'Automation Engineer (AI workflows)']) assert.strictEqual(titleRank(t)?.rank, 3, t);
  assert.notStrictEqual(titleRank('QA Automation Engineer')?.rank, 3, 'plain automation is not AI automation');
};
tests['title 4: LLM Application Developer'] = () => {
  for (const t of ['LLM Application Developer', 'LLM App Developer', 'RAG Engineer', 'LLM Developer', 'Prompt Engineer']) assert.strictEqual(titleRank(t)?.rank, 4, t);
};
tests['title 5: Associate AI Python Engineer'] = () => {
  for (const t of ['Associate AI Python Engineer', 'Python AI Engineer', 'Associate Machine Learning Engineer', 'Graduate AI Developer']) {
    const r = titleRank(t)?.rank;
    assert.ok(r !== undefined && r <= 5, `${t} -> ${r}`);
  }
  assert.strictEqual(titleRank('Associate AI Python Engineer')?.rank, 5);
};
tests['other AI/ML titles are the fallback rank; non-AI titles are not targets'] = () => {
  assert.strictEqual(titleRank('Machine Learning Engineer')?.rank, FALLBACK_RANK);
  assert.strictEqual(titleRank('Retail Sales Associate'), null);
  assert.strictEqual(titleRank('Email Marketing Manager'), null);
};

// ----------------------------------------------------------------- skip rules
tests['skip: ML research / scientist / data scientist titles'] = () => {
  for (const t of ['Research Scientist, LLMs', 'ML Researcher', 'Applied Scientist', 'Research Engineer - Alignment', 'AI Scientist']) {
    assert.strictEqual(skipReason({ role: t, jdText: AI + PAD }), 'ML research / scientist role', t);
  }
  assert.strictEqual(skipReason({ role: 'Data Scientist', jdText: AI + PAD }), 'data scientist role');
  assert.strictEqual(skipReason({ role: 'Senior Data Science Engineer', jdText: AI + PAD }), 'data scientist role');
  assert.strictEqual(skipReason({ role: 'AI Engineer', jdText: AI + PAD }), null);
};
tests['skip: MLOps by title, and MLOps-heavy by content'] = () => {
  assert.strictEqual(skipReason({ role: 'MLOps Engineer', jdText: AI + PAD }), 'MLOps role');
  assert.strictEqual(skipReason({ role: 'ML Platform Engineer', jdText: AI + PAD }), 'MLOps role');
  const heavy = 'Own our MLflow tracking, Kubeflow pipelines, feature store and model registry on SageMaker.' + PAD;
  assert.strictEqual(skipReason({ role: 'AI Engineer', jdText: heavy }), 'MLOps-heavy');
  const light = 'Deploy models and track experiments with MLflow.' + AI + PAD;
  assert.strictEqual(skipReason({ role: 'AI Engineer', jdText: light }), null, 'one MLOps tool is not MLOps-heavy');
};
tests['skip: Databricks roles (company, title or content)'] = () => {
  assert.strictEqual(skipReason({ role: 'AI Engineer', company: 'Databricks', jdText: AI + PAD }), 'Databricks role');
  assert.strictEqual(skipReason({ role: 'Databricks Engineer', jdText: AI + PAD }), 'Databricks role');
  assert.strictEqual(skipReason({ role: 'AI Engineer', jdText: 'You know Databricks well; Databricks notebooks daily.' + AI + PAD }), 'Databricks role');
  assert.strictEqual(skipReason({ role: 'AI Engineer', jdText: 'Nice to have: Databricks.' + AI + PAD }), null);
};
tests['skip: strong DSA'] = () => {
  assert.strictEqual(skipReason({ role: 'AI Engineer', jdText: 'Strong DSA and problem solving.' + AI + PAD }), 'requires strong DSA');
  assert.strictEqual(skipReason({ role: 'AI Engineer', jdText: 'Strong knowledge of data structures and algorithms.' + AI + PAD }), 'requires strong DSA');
  assert.strictEqual(skipReason({ role: 'AI Engineer', jdText: 'LeetCode style coding rounds.' + AI + PAD }), 'requires strong DSA');
  assert.strictEqual(skipReason({ role: 'AI Engineer', jdText: 'You will design algorithms for ranking.' + AI + PAD }), null);
};
tests['skip: pure MERN, but not AI-focused full-stack'] = () => {
  const mern = 'We use MongoDB, Express, React and Node.js to build dashboards and CRUD apps.' + PAD;
  assert.strictEqual(skipReason({ role: 'MERN Stack Developer', jdText: mern }), 'pure MERN role');
  assert.strictEqual(skipReason({ role: 'Full Stack Developer', jdText: mern }), 'pure MERN role');
  const ai = 'We use MongoDB, Express, React and Node.js. You will build LLM agents, RAG pipelines with LangChain and OpenAI.' + PAD;
  assert.strictEqual(skipReason({ role: 'Full Stack AI Engineer', jdText: ai }), null);
};
tests['skip: fixed US-hour shifts unless pay is clearly high'] = () => {
  const shift = 'This role works the US night shift (9pm - 6am IST).' + AI + PAD;
  assert.strictEqual(skipReason({ role: 'AI Engineer', jdText: shift }), 'fixed US-hour shift (pay not stated)');
  assert.strictEqual(skipReason({ role: 'AI Engineer', jdText: shift, salaryRange: '$900/month' }), 'fixed US-hour shift (pay not high enough)');
  assert.strictEqual(skipReason({ role: 'AI Engineer', jdText: shift, salaryRange: '$4,000/month' }), null, 'clearly worth it -> keep');
  assert.strictEqual(skipReason({ role: 'AI Engineer', jdText: 'Must overlap with US Pacific hours.' + AI + PAD }), 'fixed US-hour shift (pay not stated)');
  assert.strictEqual(skipReason({ role: 'AI Engineer', jdText: 'Flexible hours; some meetings with the US team.' + AI + PAD }), null, 'soft overlap is fine');
  assert.strictEqual(skipReason({ role: 'AI Engineer', jdText: '9am - 6pm EST shift.' + AI + PAD }), 'fixed US-hour shift (pay not stated)');
};

tests['skip: creative / AI-training titles are not engineering roles'] = () => {
  for (const t of ['Generative AI Artist Fashion - Freelance', 'AI Trainer Image QA Evaluator', 'AI Content Writer', 'AI Designer', 'Data Annotator']) {
    assert.strictEqual(skipReason({ role: t, jdText: AI + PAD }), 'not an engineering role (creative / AI-training)', t);
  }
  assert.strictEqual(skipReason({ role: 'Generative AI Engineer', jdText: AI + PAD }), null);
  assert.strictEqual(skipReason({ role: 'Prompt Engineer', jdText: AI + PAD }), null);
};

// ------------------------------------------------------------------- salary
tests['monthlyInr reads common pay formats (lower bound)'] = () => {
  const near = (v: number | null, expected: number) => assert.ok(v !== null && Math.abs(v - expected) / expected < 0.02, `${v} vs ${expected}`);
  near(monthlyInr('$85/hr'), 85 * 160 * 88);
  near(monthlyInr('$60k-$90k'), 60000 / 12 * 88);
  near(monthlyInr('60000-90000 USD'), 60000 / 12 * 88);
  near(monthlyInr('₹25 LPA'), 25 * 100000 / 12);
  near(monthlyInr('25-35 LPA INR'), 25 * 100000 / 12);
  near(monthlyInr('€4,500/month'), 4500 * 95);
  assert.strictEqual(monthlyInr('Upto $500/task'), null);
  assert.strictEqual(monthlyInr('competitive'), null);
  assert.ok(US_HOURS_MIN_MONTHLY_INR >= 100_000);
};

// ----------------------------------------------------------- gate integration
tests['gateReason applies the preferences (company + salary passed through)'] = () => {
  assert.strictEqual(gateReason('AI Engineer', AI + PAD, { company: 'Databricks' }), 'Databricks role');
  assert.strictEqual(gateReason('AI Engineer', AI + PAD), null);
  assert.strictEqual(gateReason('Data Scientist', AI + PAD), 'data scientist role');
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
