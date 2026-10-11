import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { gateReason } from '../../../scraper/quality-gate';
import { evaluateHardVeto } from '../hard-veto';
import { runShadowScoring } from '../scoring';
import baseResume from '../../../resume-generator/base-resume.json';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env.local') });

// STRICTLY READ-ONLY. Broader recall-focused pull — the previous 20-job
// validation sampled the most recent jobs regardless of fit, which turned
// out to be mostly senior/non-India Twilio postings (a precision test).
// This script biases the SAME unmodified V1+V2 pipeline toward jobs that
// LOOK like they should be actionable (India/remote location + junior
// experience + AI/backend role keywords in the raw text), to measure
// recall: does V2 actually admit the good ones, or does it also reject
// jobs that were genuinely worth surfacing?
//
// No gate, scoring, taxonomy, weight, or prompt code is touched by this
// script — it only queries more broadly and calls the exact same
// evaluateHardVeto / runShadowScoring / gateReason functions already
// validated in the prior milestone.

const LOCATION_TERMS = [
  'india', 'bangalore', 'bengaluru', 'hyderabad', 'delhi', 'ncr', 'mumbai',
  'pune', 'chennai', 'noida', 'gurugram', 'gurgaon', 'remote', 'worldwide',
  'global', 'anywhere',
];

const ROLE_TERMS = [
  'ai engineer', 'ai software engineer', 'ml engineer', 'machine learning engineer',
  'genai', 'generative ai', 'llm engineer', 'applied ai', 'ai agent',
  'backend engineer', 'software engineer', 'full stack', 'full-stack', 'platform engineer',
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function matchesAny(haystack: string, terms: string[]): string[] {
  const l = haystack.toLowerCase();
  return terms.filter(t => l.includes(t));
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('STOP: SUPABASE_URL or SUPABASE_SERVICE_KEY missing from environment. No data pulled.');
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  console.log('[recall-validation] Pulling a broad recent pool (read-only select)…');
  const locationOr = LOCATION_TERMS.map(t => `location.ilike.%${t}%`).join(',');
  const { data: pool, error } = await supabase
    .from('applications')
    .select('id, company, role, jd_url, jd_text, location, salary_range, ats_type, status, created_at')
    .in('ats_type', ['greenhouse', 'lever', 'ashby'])
    .not('jd_text', 'is', null)
    .or(locationOr)
    .order('created_at', { ascending: false })
    .limit(400);

  if (error) {
    console.error('STOP: Supabase select failed:', error.message);
    process.exit(1);
  }
  if (!pool || pool.length === 0) {
    console.error('STOP: query returned zero rows. No synthetic data will be substituted.');
    process.exit(1);
  }

  console.log(`[recall-validation] Location-filtered pool: ${pool.length} rows. Applying role-keyword filter…`);

  const roleFiltered = pool
    .map(job => ({ job, roleHits: matchesAny(`${job.role} ${job.jd_text}`, ROLE_TERMS), locHits: matchesAny(job.location || '', LOCATION_TERMS) }))
    .filter(x => x.roleHits.length > 0)
    .slice(0, 50);

  console.log(`[recall-validation] Role+location-filtered sample: ${roleFiltered.length} rows. Running V1+V2 pipeline (read-only)…\n`);

  const now = new Date();
  const results: any[] = [];

  for (const [i, { job, roleHits, locHits }] of roleFiltered.entries()) {
    console.log(`--- [${i + 1}/${roleFiltered.length}] ${job.company} — ${job.role} (${job.ats_type}) ---`);

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
      role_hits: roleHits,
      loc_hits: locHits,
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
    console.log(`  V2 gates: role_family=${gate.gates.role_family.passed ? 'pass' : 'FAIL'}(${gate.gates.role_family.family}) experience=${gate.gates.experience.passed ? 'pass' : 'FAIL'}(${gate.gates.experience.tier}) location=${gate.gates.location.passed ? 'pass' : 'FAIL'}(${gate.gates.location.location.category})`);
    if (opportunity) {
      console.log(`  skill_fit=${opportunity.skill_fit.score} seniority=${opportunity.seniority_fit.score} freshness=${opportunity.freshness.score} comp=${opportunity.compensation.score}(${opportunity.compensation.status}) -> opportunity=${opportunity.overall}`);
    } else {
      console.log(`  SKIPPED (${skip_reason})`);
    }
    console.log('');

    if (v2Admitted) await sleep(4000);
  }

  const outDir = path.resolve(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'real-recall-validation-log.jsonl');
  fs.writeFileSync(outPath, results.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(`\nFull structured log: ${outPath}`);
  console.log('No database records were written. This was a read-only validation run.');
}

main().catch(err => {
  console.error('[recall-validation] Fatal:', err);
  process.exit(1);
});
