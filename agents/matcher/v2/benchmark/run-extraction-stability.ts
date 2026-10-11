import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { computeSkillFit } from '../scoring/skill-fit';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env.local') });

// Measures extraction variance by calling the SAME skill-extraction call
// multiple times on IDENTICAL JD text — the strictest possible stability
// test, since any difference is pure model non-determinism, not input
// variation. Diagnostic only: does not tune weights or prompts based on
// the result, per the CTO's instruction.

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const RUNS_PER_JOB = 3;

function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 1 : intersection.size / union.size;
}

async function main() {
  const p = path.resolve(__dirname, 'scoring-set.json');
  const allJobs = JSON.parse(fs.readFileSync(p, 'utf-8'));
  // Sample 3 jobs of varying complexity for the stability check.
  const sample = [allJobs[0], allJobs[2], allJobs[5]];

  console.log('\n=== Extraction Stability — same JD text, 3 repeated calls each ===\n');

  const summary: any[] = [];

  for (const job of sample) {
    console.log(`--- ${job.company} — ${job.role} ---`);
    const runs: { count: number; skills: Set<string>; model: string | null }[] = [];

    for (let i = 0; i < RUNS_PER_JOB; i++) {
      const result = await computeSkillFit(job.jd_text, {});
      const skills = new Set(result.evidence.requirements.map(r => r.requirement.skill.toLowerCase().trim()));
      runs.push({ count: skills.size, skills, model: result.evidence.extraction_model });
      console.log(`  run ${i + 1}: ${skills.size} requirements extracted, model=${result.evidence.extraction_model}`);
      await sleep(3000);
    }

    const pairs: number[] = [];
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        pairs.push(jaccard(runs[i].skills, runs[j].skills));
      }
    }
    const avgJaccard = pairs.reduce((a, b) => a + b, 0) / pairs.length;
    const counts = runs.map(r => r.count);
    const countSpread = Math.max(...counts) - Math.min(...counts);

    console.log(`  requirement-count spread: ${countSpread} (min ${Math.min(...counts)}, max ${Math.max(...counts)})`);
    console.log(`  average pairwise Jaccard similarity of extracted skill-name sets: ${avgJaccard.toFixed(2)}`);
    console.log('');

    summary.push({
      job_id: job.id,
      company: job.company,
      role: job.role,
      run_counts: counts,
      count_spread: countSpread,
      avg_jaccard: Number(avgJaccard.toFixed(3)),
    });
  }

  const overallAvgJaccard = summary.reduce((s, x) => s + x.avg_jaccard, 0) / summary.length;
  console.log('--- Summary ---');
  console.log(`Jobs sampled: ${summary.length}, ${RUNS_PER_JOB} repeated calls each (${summary.length * RUNS_PER_JOB} total calls)`);
  console.log(`Overall average pairwise Jaccard similarity: ${overallAvgJaccard.toFixed(3)} (1.0 = identical every run, 0.0 = no overlap)`);

  const outDir = path.resolve(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'extraction-stability-log.json'), JSON.stringify({ summary, overallAvgJaccard }, null, 2));
  console.log(`Full log: ${path.join(outDir, 'extraction-stability-log.json')}`);
}

main().catch(err => {
  console.error('[extraction-stability] Fatal:', err);
  process.exit(1);
});
