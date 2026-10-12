// Re-checks jobs that are ALREADY in the `matched` queue against the current rules
// (quality gate + search-profile skips + v2 hard-veto gates).
//
//   dry run (default):  only logs what WOULD be filtered — changes nothing
//   REGATE_APPLY=true:  sets those jobs to `filtered` (reversible from the dashboard's
//                       Excluded page → Restore). Approved / applied jobs are never touched.

import * as dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { gateReason } from '../scraper/quality-gate';
import { evaluateHardVeto } from './v2/hard-veto';
import { effectiveVeto } from './veto-policy';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

async function main() {
  const apply = process.env.REGATE_APPLY === 'true';
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  const { data: jobs, error } = await supabase
    .from('applications')
    .select('id, company, role, jd_text, location, salary_range, match_score')
    .eq('status', 'matched')
    .order('match_score', { ascending: false });
  if (error) throw new Error(error.message);

  console.log(`[regate] ${apply ? 'APPLY' : 'DRY RUN'} — checking ${jobs?.length ?? 0} matched jobs against the current rules…`);
  let kept = 0;
  let flagged = 0;
  const byReason = new Map<string, number>();

  for (const job of jobs ?? []) {
    const text = job.jd_text || '';
    let reason = gateReason(job.role, text, { company: job.company, salaryRange: job.salary_range });
    if (!reason) {
      const v2 = evaluateHardVeto(job.role, text, job.location || '');
      const veto = effectiveVeto(job.role, v2);
      if (veto) reason = `v2: ${veto}`;
    }
    if (!reason) { kept++; continue; }

    flagged++;
    const key = reason.split(':')[0].slice(0, 60);
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
    console.log(`[regate] ${apply ? 'FILTERED' : 'would filter'} (${job.match_score}) ${job.company} — ${job.role} [${job.location}] → ${reason.slice(0, 140)}`);
    if (apply) {
      const { error: upErr } = await supabase.from('applications')
        .update({ status: 'filtered', match_justification: `Filtered (rules): ${reason}` })
        .eq('id', job.id)
        .eq('status', 'matched'); // never touch a job that has moved on since we read it
      if (upErr) console.error(`[regate] update failed for ${job.id}: ${upErr.message}`);
    }
  }

  console.log(`[regate] Done. keep ${kept}, ${apply ? 'filtered' : 'would filter'} ${flagged}.`);
  for (const [r, n] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`[regate]   ${n} × ${r}`);
}

main().catch(err => { console.error('[regate] Fatal:', err?.message ?? err); process.exit(1); });
