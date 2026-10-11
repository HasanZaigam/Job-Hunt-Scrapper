import * as dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { buildMatchingPrompt } from './prompts';
import { generateWithRetry } from '../lib/gemini';
import { gateReason } from '../scraper/quality-gate';
import { evaluateHardVeto } from './v2/hard-veto';
import { buildDecisionLog } from './v2/decision-log';
import { buildV2PersistencePayload, persistV2Result } from './v2/persistence';
import baseResume from '../resume-generator/base-resume.json';

// Milestone 1 of the v2 rollout plan: experience + location hard-veto gates,
// built behind this flag, running in shadow mode only. When enabled, v2's
// gate decision is computed and logged alongside v1's for every job, but
// v1 (gateReason) remains the sole source of truth for `status` — no live
// traffic is affected. Set MATCHER_ENGINE_V2_ENABLED=true to turn on shadow
// logging; unset/false is a full no-op (zero behavior change, zero risk).
const V2_SHADOW_ENABLED = process.env.MATCHER_ENGINE_V2_ENABLED === 'true';

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

  let consecutiveFailures = 0;

  for (const job of jobs) {
    if (!job.jd_text) {
      console.warn(`[matcher] Skipping ${job.id}: no JD text`);
      continue;
    }

    // Deterministic quality gate — drop senior/thin/spam before Gemini.
    const reason = gateReason(job.role, job.jd_text);

    // Shadow-only v2 hard veto (experience + location). Never affects status.
    // Logged as one structured JSON line per job (not prose) so every
    // decision — v1's, v2's, and the gate-by-gate reasoning behind v2's —
    // is machine-parseable and explainable after the fact.
    if (V2_SHADOW_ENABLED) {
      const v2 = evaluateHardVeto(job.role, job.jd_text, job.location || '');
      const log = buildDecisionLog(job, reason, v2);
      console.log(`[matcher/v2-shadow] ${JSON.stringify(log)}`);

      // Persistence foundation only — this path runs gates only (zero
      // Gemini calls, same as before), so `opportunity` is always null here
      // and opportunity_score/priority_bucket persist as null. Never
      // touches `status` or any other V1 column. See agents/matcher/v2/persistence.ts.
      const payload = buildV2PersistencePayload(v2, null, new Date());
      const persistResult = await persistV2Result(supabase, job.id, payload);
      if (!persistResult.ok) {
        console.error(`[matcher/v2-shadow] persistence failed for ${job.id}: ${persistResult.error}`);
      }
    }

    if (reason) {
      await supabase.from('applications')
        .update({ status: 'filtered', match_justification: `Filtered: ${reason}` })
        .eq('id', job.id);
      console.log(`[matcher] gated ${job.company}: ${reason}`);
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
      console.log(`[matcher] ${job.company} — ${job.role}: score=${result.match_score}`);
    }

    // Stay under free-tier RPM limits (~15/min) with comfortable headroom.
    await sleep(4000);
  }

  console.log('[matcher] Done.');
}

main().catch(err => {
  console.error('[matcher] Fatal:', err);
  process.exit(1);
});
