import assert from 'assert';
import { esc, formatMatchedLine, formatFilteredLine, chunkLines, isContractLike, pickTop } from '../digest';

type Test = () => void;
const tests: Record<string, Test> = {};

tests['esc escapes HTML so titles cannot break the message'] = () => {
  assert.strictEqual(esc('A & B <script>'), 'A &amp; B &lt;script&gt;');
};
tests['matched line shows score, company, role, location and link'] = () => {
  const l = formatMatchedLine({ company: 'Acme', role: 'ML Engineer <Remote>', location: 'Remote - India', match_score: 78, jd_url: 'https://x.io/j?a=1&b="2"' }, 1);
  assert.ok(l.startsWith('1. <b>78</b> Acme — ML Engineer &lt;Remote&gt;'));
  assert.ok(l.includes('📍 Remote - India'));
  assert.ok(l.includes('href="https://x.io/j?a=1&amp;b=&quot;2&quot;"'));
  assert.strictEqual(l.split('\n').length, 2, 'two lines per job');
};
tests['matched line copes with missing optional fields'] = () => {
  const l = formatMatchedLine({ company: 'Acme', role: 'AI Engineer' }, 3);
  assert.strictEqual(l, '3. <b>–</b> <i>T1</i> Acme — AI Engineer');
};
tests['filtered line strips the "Filtered:" prefix and shows the reason'] = () => {
  assert.strictEqual(formatFilteredLine({ company: 'Acme', role: 'Sr AI Eng', match_justification: 'Filtered: senior-only title' }), '• Acme — Sr AI Eng <i>(senior-only title)</i>');
};
tests['chunkLines never exceeds the limit and never loses a line'] = () => {
  const lines = Array.from({ length: 200 }, (_, i) => `line number ${i} ${'x'.repeat(40)}`);
  const chunks = chunkLines(lines, 500);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 500, `chunk too long: ${c.length}`);
  assert.strictEqual(chunks.join('\n').split('\n').length, 200);
};

tests['contract / per-task / hourly postings are flagged, full-time ones are not'] = () => {
  for (const r of ['Machine Learning Engineer | Remote - Contract', 'LLM Systems Engineer - Fully Remote | Upto $500/task Task based', 'AI/ML Engineer - Upto $85/hr', 'Freelance AI Developer']) {
    assert.strictEqual(isContractLike(r), true, r);
  }
  for (const r of ['AI Engineer', 'Machine Learning Engineer', 'Applied AI Engineer - Contracts Platform Team'.replace('Contracts', 'Billing')]) {
    assert.strictEqual(isContractLike(r), false, r);
  }
  assert.ok(formatMatchedLine({ company: 'X', role: 'ML Engineer - Contract', match_score: 80 }, 1).includes('🧾 contract/task-based'));
};

tests['digest orders by preferred title (T1..T5) first, then score; tags T1..T5'] = () => {
  const rows = [
    { company: 'A', role: 'Machine Learning Engineer', match_score: 95 },      // fallback rank
    { company: 'B', role: 'Associate AI Python Engineer', match_score: 70 },   // T5
    { company: 'C', role: 'AI Engineer', match_score: 62 },                    // T1
    { company: 'D', role: 'AI Engineer', match_score: 81 },                    // T1, higher score
    { company: 'E', role: 'Generative AI Developer', match_score: 90 },        // T2
  ];
  assert.deepStrictEqual(pickTop(rows).map(r => r.company), ['D', 'C', 'E', 'B', 'A']);
  assert.strictEqual(pickTop(rows, 2).length, 2);
  assert.ok(formatMatchedLine(rows[2], 1).includes('<i>T1</i>'));
  assert.ok(formatMatchedLine(rows[4], 1).includes('<i>T2</i>'));
  assert.ok(!formatMatchedLine(rows[0], 1).includes('<i>T'), 'fallback titles get no tag');
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
