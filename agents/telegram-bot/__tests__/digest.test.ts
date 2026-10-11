import assert from 'assert';
import { esc, formatMatchedLine, formatFilteredLine, chunkLines } from '../digest';

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
  assert.strictEqual(l, '3. <b>–</b> Acme — AI Engineer');
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
