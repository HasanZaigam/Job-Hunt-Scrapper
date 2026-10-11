import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { runShadowScoring } from '../scoring';
import baseResume from '../../../resume-generator/base-resume.json';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env.local') });

// Milestone 3 demo: 10 REAL shadow scoring runs, each making a genuine
// Gemini call for skill extraction (agents/matcher/v2/scoring/skill-fit.ts).
// This consumes real free-tier quota by deliberate choice, confirmed with
// the user before running — it is not a fixture/mock demonstration.
// Scoring only ever runs on jobs that already pass the hard-veto gates
// (agents/matcher/v2/scoring/index.ts enforces this); all 10 fixtures here
// are gate-passing by design so the scoring path actually executes.

interface ScoringJob {
  id: string;
  company: string;
  role: string;
  location: string;
  jd_text: string;
  posted_days_ago: number;
  salary_range: string | null;
  jd_url?: string;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function loadDataset(): ScoringJob[] {
  const p = path.resolve(__dirname, 'scoring-set.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

async function main() {
  const jobs = loadDataset();
  const now = new Date();
  const logLines: string[] = [];

  console.log('\n=== Job Matching v2 — Shadow Scoring Demo (10 REAL Gemini calls) ===\n');

  for (const [i, job] of jobs.entries()) {
    const scrapedAt = new Date(now.getTime() - job.posted_days_ago * 24 * 60 * 60 * 1000);

    console.log(`--- [${i + 1}/${jobs.length}] ${job.company} — ${job.role} (${job.location}) ---`);
    console.log(`Input JD: ${job.jd_text.slice(0, 140)}${job.jd_text.length > 140 ? '…' : ''}`);
    console.log(`Posted: ${job.posted_days_ago} day(s) ago | Salary field: ${job.salary_range ?? '(none)'}`);
    console.log(`JD link: ${job.jd_url ?? '(none — synthetic fixture, no real posting)'}`);

    const outcome = await runShadowScoring(
      {
        role: job.role,
        jdText: job.jd_text,
        location: job.location,
        salaryRange: job.salary_range,
        scrapedAt,
        candidateSkills: (baseResume as any).skills,
      },
      now
    );

    if (!outcome.scored) {
      console.log(`SKIPPED — ${outcome.skip_reason}`);
      logLines.push(JSON.stringify({ job_id: job.id, company: job.company, role: job.role, jd_url: job.jd_url ?? null, scored: false, skip_reason: outcome.skip_reason }));
      console.log('');
      continue;
    }

    const o = outcome.opportunity!;
    console.log(`skill_fit:      score=${o.skill_fit.score ?? 'null'}  model=${o.skill_fit.evidence.extraction_model ?? 'n/a'}`);
    console.log(`  matched:  [${o.skill_fit.matched_skills.join(', ')}]`);
    console.log(`  missing:  [${o.skill_fit.missing_skills.join(', ')}]`);
    console.log(`seniority_fit:  score=${o.seniority_fit.score}  (${o.seniority_fit.reason})`);
    console.log(`freshness:      score=${o.freshness.score}  (${o.freshness.reason})`);
    console.log(`compensation:   score=${o.compensation.score ?? 'null'}  status=${o.compensation.status}`);
    console.log(`weights_used:   ${JSON.stringify(o.weights_used)}`);
    console.log(`OPPORTUNITY SCORE: ${o.overall ?? 'null (skill-fit failed — strict fallback, no fabricated score)'}`);
    console.log('');

    logLines.push(JSON.stringify({
      job_id: job.id,
      company: job.company,
      role: job.role,
      location: job.location,
      jd_url: job.jd_url ?? null,
      input: { jd_text: job.jd_text, posted_days_ago: job.posted_days_ago, salary_range: job.salary_range },
      scored: true,
      gate_summary: { vetoed: outcome.gate.vetoed, needs_review: outcome.gate.needs_review },
      opportunity: o,
    }));

    // Stay well under free-tier RPM limits between real calls.
    if (i < jobs.length - 1) await sleep(4000);
  }

  const outDir = path.resolve(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'scoring-demo-log.jsonl');
  fs.writeFileSync(outPath, logLines.join('\n') + '\n');
  console.log(`Structured log (one JSON object per job, includes model version + full component breakdown): ${outPath}`);
}

main().catch(err => {
  console.error('[scoring-demo] Fatal:', err);
  process.exit(1);
});
