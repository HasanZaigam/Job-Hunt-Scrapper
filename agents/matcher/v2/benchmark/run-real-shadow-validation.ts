import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { gateReason } from '../../../scraper/quality-gate';
import { evaluateHardVeto } from '../hard-veto';
import { runShadowScoring } from '../scoring';
import baseResume from '../../../resume-generator/base-resume.json';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env.local') });

// STRICTLY READ-ONLY. This script issues exactly one Supabase `.select()`
// call and nothing else — no .insert(), .update(), .delete(), or .upsert()
// anywhere in this file. It writes only to local files under
// matcher/v2/benchmark/output/. V1's status is never touched.

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('STOP: SUPABASE_URL or SUPABASE_SERVICE_KEY missing from environment. No data pulled.');
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  console.log('[real-shadow-validation] Pulling up to 20 recent Greenhouse/Lever/Ashby jobs (read-only select)…');
  const { data: jobs, error } = await supabase
    .from('applications')
    .select('id, company, role, jd_url, jd_text, location, salary_range, ats_type, status, created_at')
    .in('ats_type', ['greenhouse', 'lever', 'ashby'])
    .not('jd_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('STOP: Supabase select failed:', error.message);
    process.exit(1);
  }
  if (!jobs || jobs.length === 0) {
    console.error('STOP: query returned zero rows. No synthetic data will be substituted.');
    process.exit(1);
  }

  console.log(`[real-shadow-validation] Pulled ${jobs.length} real rows. Running V1+V2 pipeline (read-only)…\n`);

  const now = new Date();
  const results: any[] = [];

  for (const [i, job] of jobs.entries()) {
    console.log(`--- [${i + 1}/${jobs.length}] ${job.company} — ${job.role} (${job.ats_type}) ---`);

    const v1Reason = gateReason(job.role, job.jd_text || '');
    const v1Admitted = !v1Reason;

    const gate = evaluateHardVeto(job.role, job.jd_text || '', job.location || '');
    const v2Admitted = !gate.vetoed;

    let opportunity: any = null;
    let skip_reason: string | null = null;

    if (v2Admitted) {
      const outcome = await runShadowScoring(
        {
          role: job.role,
          jdText: job.jd_text || '',
          location: job.location || '',
          salaryRange: job.salary_range,
          scrapedAt: new Date(job.created_at),
          candidateSkills: (baseResume as any).skills,
        },
        now
      );
      opportunity = outcome.opportunity;
    } else {
      skip_reason = `gate vetoed — not scored: ${gate.reason}`;
    }

    const record = {
      job_id: job.id,
      company: job.company,
      role: job.role,
      jd_url: job.jd_url,
      source: job.ats_type,
      db_status: job.status,
      location: job.location,
      created_at: job.created_at,
      v1: { admitted: v1Admitted, reason: v1Reason },
      v2_gates: {
        vetoed: gate.vetoed,
        needs_review: gate.needs_review,
        failing_reasons: gate.failing_reasons,
        role_family: gate.gates.role_family,
        experience: gate.gates.experience,
        location: gate.gates.location,
      },
      scored: v2Admitted,
      skip_reason,
      opportunity,
    };
    results.push(record);

    console.log(`  V1: ${v1Admitted ? 'admit' : `reject (${v1Reason})`}`);
    console.log(`  V2 gates: role_family=${gate.gates.role_family.passed ? 'pass' : 'FAIL'}(${gate.gates.role_family.family}/${gate.gates.role_family.confidence}) experience=${gate.gates.experience.passed ? 'pass' : 'FAIL'}(${gate.gates.experience.requirement.band}) location=${gate.gates.location.passed ? 'pass' : 'FAIL'}(${gate.gates.location.location.remote_flag})`);
    if (opportunity) {
      console.log(`  skill_fit=${opportunity.skill_fit.score} seniority=${opportunity.seniority_fit.score} freshness=${opportunity.freshness.score} comp=${opportunity.compensation.score}(${opportunity.compensation.status}) -> opportunity=${opportunity.overall}`);
    } else {
      console.log(`  SKIPPED (${skip_reason})`);
    }
    console.log('');

    if (v2Admitted) await sleep(4000); // only sleep when a real Gemini call was made
  }

  const outDir = path.resolve(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'real-shadow-validation-log.jsonl');
  fs.writeFileSync(outPath, results.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(`\nFull structured log: ${outPath}`);
  console.log('No database records were written. This was a read-only validation run.');
}

main().catch(err => {
  console.error('[real-shadow-validation] Fatal:', err);
  process.exit(1);
});
