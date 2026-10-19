// One-off maintenance script: classify job_type for every existing row that
// doesn't have one yet (migration 006 added the column with no backfill by
// design — this script is the backfill, run manually, once).
// Run: cd agents && npx ts-node scraper/backfill-job-type.ts
import * as dotenv from 'dotenv';
import path from 'path';
import { supabaseClient } from './store';
import { classifyJobType } from './job-type';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

async function main() {
  const supabase = supabaseClient();
  // No `.is('job_type', null)` filter: this re-runs the classifier over every
  // row and overwrites, since a prior run of this script may have written a
  // since-fixed classifier's bad output (job-type.ts 2026-10-19 revision).
  const { data, error } = await supabase
    .from('applications')
    .select('id, role, jd_text, salary_range, is_manual_required');
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  console.log(`[backfill-job-type] ${rows.length} rows to (re)classify.`);
  if (rows.length === 0) return;

  const counts: Record<string, number> = {};
  const CHUNK = 25;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await Promise.all(chunk.map(async (r: any) => {
      const jobType = classifyJobType(r.role, r.jd_text ?? '', {
        salaryRange: r.salary_range,
        isManualRequired: r.is_manual_required,
      });
      counts[jobType] = (counts[jobType] ?? 0) + 1;
      const { error: updErr } = await supabase.from('applications').update({ job_type: jobType }).eq('id', r.id);
      if (updErr) console.error(`[backfill-job-type] failed for ${r.id}:`, updErr.message);
    }));
    console.log(`[backfill-job-type] ${Math.min(i + CHUNK, rows.length)}/${rows.length} done.`);
  }
  console.log('[backfill-job-type] Done.', counts);
}

main().catch(err => { console.error('[backfill-job-type] Fatal:', err); process.exit(1); });
