import fs from 'fs';
import path from 'path';
import { gateReason } from '../../../scraper/quality-gate';
import { evaluateHardVeto } from '../hard-veto';

// Milestone 1 benchmark: measures whether the new experience+location hard
// veto gates correctly reject the out-of-scope jobs the audit flagged as
// leaking past v1's gateReason() (senior/sr. titles, year-ranges, spelled-out
// durations, wrong-country/ambiguous locations) without rejecting any of the
// true-positive "good fit" fixtures. No network calls, no DB access, no
// Gemini — pure function comparison against hand-labeled expectations.

interface LabeledJob {
  id: string;
  company: string;
  role: string;
  location: string;
  jd_text: string;
  expected_vetoed: boolean;
  expected_reason_contains: string | null;
  note: string;
}

function loadFixtures(): LabeledJob[] {
  const p = path.resolve(__dirname, 'labeled-jobs.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function main() {
  const fixtures = loadFixtures();

  let v1Correct = 0;
  let v2Correct = 0;
  const rows: string[] = [];
  const v1Misses: LabeledJob[] = [];
  const v2Misses: LabeledJob[] = [];

  for (const job of fixtures) {
    const v1Reason = gateReason(job.role, job.jd_text);
    const v1Vetoed = !!v1Reason;
    const v1Match = v1Vetoed === job.expected_vetoed;
    if (v1Match) v1Correct++; else v1Misses.push(job);

    const v2 = evaluateHardVeto(job.role, job.jd_text, job.location);
    const v2Match = v2.vetoed === job.expected_vetoed;
    if (v2Match) v2Correct++; else v2Misses.push(job);

    rows.push(
      [
        job.id.padEnd(28),
        `expected=${job.expected_vetoed ? 'VETO' : 'pass'}`.padEnd(15),
        `v1=${v1Vetoed ? 'VETO' : 'pass'}${v1Match ? '' : ' ✗'}`.padEnd(18),
        `v2=${v2.vetoed ? 'VETO' : 'pass'}${v2Match ? '' : ' ✗'}${v2.needs_review ? ' (review)' : ''}`,
      ].join(' | ')
    );
  }

  const total = fixtures.length;
  console.log('\n=== Job Matching v2 — Milestone 1 Benchmark (experience + location hard veto) ===\n');
  console.log(rows.join('\n'));
  console.log('\n--- Summary ---');
  console.log(`Fixtures: ${total}`);
  console.log(`v1 (current live gate)  accuracy: ${v1Correct}/${total} (${Math.round((v1Correct / total) * 100)}%)`);
  console.log(`v2 (shadow hard veto)   accuracy: ${v2Correct}/${total} (${Math.round((v2Correct / total) * 100)}%)`);

  if (v1Misses.length) {
    console.log('\nCases v1 gets wrong (leaks or false rejects):');
    for (const m of v1Misses) console.log(`  - ${m.id}: ${m.note}`);
  }
  if (v2Misses.length) {
    console.log('\nCases v2 still gets wrong:');
    for (const m of v2Misses) console.log(`  - ${m.id}: ${m.note}`);
  } else {
    console.log('\nv2 has zero misses on this fixture set.');
  }

  const improvement = v2Correct - v1Correct;
  console.log(`\nNet accuracy improvement: ${improvement >= 0 ? '+' : ''}${improvement} fixtures (${Math.round((improvement / total) * 100)} pts)`);
}

main();
