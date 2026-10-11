import * as dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { buildMatchingPrompt } from './prompts';
import { generateWithRetry } from '../lib/gemini';
import { gateReason } from '../scraper/quality-gate';
import { evaluateHardVeto } from './v2/hard-veto';
import type { HardVetoResult } from './v2/types';
import { buildDecisionLog } from './v2/decision-log';
import { buildV2PersistencePayload, persistV2Result } from './v2/persistence';
import baseResume from '../resume-generator/base-resume.json';

// v2 matcher modes (MATCHER_ENGINE_V2_MODE):
//   off    — v1 only (default)
//   shadow — v2 gates are computed and logged/persisted, but v1 alone decides `status`
//   live   — v2 hard-veto gates (role family, experience, location) DECIDE: a vetoed
//            job is set to `filtered` before any Gemini call (saves quota); jobs that
//            pass are still scored by the v1 Gemini rubric.
// MATCHER_ENGINE_V2_ENABLED=true is kept as an alias for "shadow".
function resolveV2Mode(): 'off' | 'shadow' | 'live' {
  const m = (process.env.MATCHER_ENGINE_V2_MODE || '').trim().toLowerCase();
  if (m === 'live' || m === 'shadow' || m === 'off') return m;
  return process.env.MATCHER_ENGINE_V2_ENABLED === 'true' ? 'shadow' : 'off';
}

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const WEIGHTS: Record<string, number> = { stack_fit: 0.30, evidence: 0.20, seniority: 0.20, mission: 0.15, location: 0.10, compensation: 0.05 };
const DIMS = ['stack_fit', 'seniority', 'location', 'compensation', 'evidence', 'mission'];
const clamp = (n: any) => { n = Number(n); return isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0; };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

interface MatchResult {
  match_score: number;
  score_breakdown: Record<string, { score: number; reason: string }>;
  matched_skills: string[];
  missing_skills: string[];
  match_justification: string;
  status: 'matched' | 'filtered';
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function matchJob(jdText: string): Promise<MatchResult | null> {
  try {
    const prompt = buildMatchingPrompt(baseResume, jdText);
    const text = await generateWithRetry(prompt, { tag: 'matcher' });

    const json = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const p = JSON.parse(json);
    const d = p.dimensions || {};
    const breakdown: Record<string, { score: number; reason: string }> = {};
    let overall = 0;
    for (const k of DIMS) {
      const score = clamp(d[k] && d[k].score);
      breakdown[k] = { score, reason: (d[k] && typeof d[k].reason === 'string') ? d[k].reason : '' };
      overall += (WEIGHTS[k] || 0) * score;
    }
    overall = Math.round(overall);
    const matched = overall >= 60;
    const justification = DIMS.map(k => ({ k, r: breakdown[k].reason })).filter(x => x.r).map(x => `${x.k.replace('_', ' ')}: ${x.r}`).join('\n');
    return {
      match_score: overall,
      score_breakdown: breakdown,
      matched_skills: p.matched_skills || [],
      missing_skills: p.missing_skills || [],
      match_justification: matched ? justification : `Below threshold (${overall})`,
      status: matched ? 'matched' : 'filtered',
    };
  } catch (err: any) {
    console.error('[matcher] Gemini error:', err?.message || err);
    return null;
  }
}

async function main() {
  const V2_MODE = resolveV2Mode(); // read now, after dotenv has loaded
  console.log('[matcher] Fetching unmatched jobs…');

  // Oldest first: yesterday's unscored backlog is prioritised over today's
  // fresh scrapes, so nothing starves when the daily Gemini budget runs out.
  const { data: jobs, error } = await supabase
    .from('applications')
    .select('id, company, role, jd_text, location')
    .eq('status', 'scraped')
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  if (!jobs || jobs.length === 0) {
    console.log('[matcher] No scraped jobs to process.');
    return;
  }

  console.log(`[matcher] Processing ${jobs.length} jobs (oldest first) with Gemini…`);

  console.log(`[matcher] v2 engine mode: ${V2_MODE}`);
  let consecutiveFailures = 0;
  let persistV2 = V2_MODE !== 'off'; // turned off for the run if migration 004 is missing
  const stats = { gatedV1: 0, vetoedV2: 0, scored: 0 };

  for (const job of jobs) {
    if (!job.jd_text) {
      console.warn(`[matcher] Skipping ${job.id}: no JD text`);
      continue;
    }

    // Deterministic quality gate — drop senior/thin/spam before Gemini.
    const reason = gateReason(job.role, job.jd_text);

    // v2 hard veto (role family + experience + location). Logged as one structured
    // JSON line per job so every decision is machine-parseable and explainable.
    let v2: HardVetoResult | null = null;
    if (V2_MODE !== 'off') {
      v2 = evaluateHardVeto(job.role, job.jd_text, job.location || '');
      console.log(`[matcher/v2-${V2_MODE}] ${JSON.stringify(buildDecisionLog(job, reason, v2))}`);

      if (persistV2) {
        // Writes only the additive v2 columns (migration 004) — never `status`.
        const persistResult = await persistV2Result(supabase, job.id, buildV2PersistencePayload(v2, null, new Date()));
        if (!persistResult.ok) {
          if (/does not exist|schema cache|could not find/i.test(persistResult.error ?? '')) {
            persistV2 = false;
            console.warn('[matcher/v2] v2 columns missing — apply database/migrations/004_v2_persistence.sql to store v2 details. Continuing without persisting.');
          } else {
            console.error(`[matcher/v2] persistence failed for ${job.id}: ${persistResult.error}`);
          }
        }
      }
    }

    if (reason) {
      await supabase.from('applications')
        .update({ status: 'filtered', match_justification: `Filtered: ${reason}` })
        .eq('id', job.id);
      console.log(`[matcher] gated ${job.company}: ${reason}`);
      stats.gatedV1++;
      continue;
    }

    // LIVE mode: a v2 veto filters the job out before spending any Gemini quota.
    if (V2_MODE === 'live' && v2?.vetoed) {
      await supabase.from('applications')
        .update({ status: 'filtered', match_justification: `Filtered (v2): ${v2.reason}` })
        .eq('id', job.id);
      console.log(`[matcher] v2-vetoed ${job.company} — ${job.role}: ${v2.reason}`);
      stats.vetoedV2++;
      continue;
    }

    const result = await matchJob(job.jd_text);
    if (!result) {
      consecutiveFailures++;
      // The retry helper only returns null after exhausting every model+retry.
      // A run of failures means the whole daily budget is gone — stop hammering
      // the API; the unscored remainder stays 'scraped' and is picked up first
      // (oldest) on the next run once quota resets.
      if (consecutiveFailures >= 3) {
        console.warn('[matcher] Daily Gemini budget appears exhausted — stopping. Remaining jobs will be scored next run.');
        break;
      }
      console.warn(`[matcher] Failed to match job ${job.id}`);
      continue;
    }
    consecutiveFailures = 0;

    const { error: updateErr } = await supabase
      .from('applications')
      .update({
        match_score: result.match_score,
        score_breakdown: result.score_breakdown,
        matched_skills: result.matched_skills,
        missing_skills: result.missing_skills,
        match_justification: result.match_justification,
        status: result.status,
      })
      .eq('id', job.id);

    if (updateErr) {
      console.error(`[matcher] Update failed for ${job.id}:`, updateErr.message);
    } else {
      stats.scored++;
      console.log(`[matcher] ${job.company} — ${job.role}: score=${result.match_score}${v2?.needs_review ? ' (v2: needs review)' : ''}`);
    }

    // Stay under free-tier RPM limits (~15/min) with comfortable headroom.
    await sleep(4000);
  }

  console.log(`[matcher] Done. gated by rules: ${stats.gatedV1}, vetoed by v2: ${stats.vetoedV2}, scored by Gemini: ${stats.scored}.`);
}

main().catch(err => {
  console.error('[matcher] Fatal:', err);
  process.exit(1);
});
