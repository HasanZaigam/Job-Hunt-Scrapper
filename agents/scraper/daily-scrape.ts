import * as dotenv from 'dotenv';
import path from 'path';
import { discoverNewJobs } from './apify-search';
import {
  supabaseClient, getExistingUrls, backlogCount, isTargetLocation,
  fetchBoard, insertJobs, insertManualJobs, prettyName, normalizeJdUrl, type Ats, type PendingJob,
} from './store';
import { gateReason } from './quality-gate';
import { fetchRemoteJobs } from './remote-boards';
import companyList from './company-list.json';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

// Keep the unscored backlog around one day's scoring capacity. Scraping is free,
// but matching is the bottleneck — there's no point piling up jobs we can't
// score for days. We only top up to this target each run.
const BACKLOG_TARGET = 60;

const supabase = supabaseClient();

interface Board { ats: Ats; atsId: string; company: string }

// Static curated companies, in list order. `active: false` entries (audited
// 2026-10-19: 0 India/worldwide-eligible postings) are kept in the file for
// their record but skipped here — never deleted, since a company's hiring
// mix can change later.
function staticBoards(): Board[] {
  return (companyList as any[])
    .filter(c => c.active !== false)
    .map(c => ({ ats: c.ats, atsId: c.ats_id, company: c.name }));
}

// Fresh boards discovered via Apify Google search.
async function discoveredBoards(): Promise<Board[]> {
  const discovered = await discoverNewJobs();
  const seen = new Set<string>();
  const boards: Board[] = [];
  for (const d of discovered) {
    const key = `${d.ats}:${d.ats_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    boards.push({ ats: d.ats, atsId: d.ats_id, company: prettyName(d.ats_id) });
  }
  return boards;
}

// Pull target-location, non-duplicate jobs from a set of boards until `budget`
// new jobs are collected. Returns the collected jobs.
async function harvest(
  boards: Board[],
  budget: number,
  existingUrls: Set<string>,
  label: string
): Promise<PendingJob[]> {
  const collected: PendingJob[] = [];
  const skipped = new Map<string, number>();
  // Same funnel shape as remote-boards.ts's per-source stats, so the two
  // paths (ATS boards vs free remote boards) are directly comparable.
  const stats = { fetched: 0, duplicate: 0, region: 0, gated: 0, kept: 0 };
  let boardFetchFailures = 0;
  for (const b of boards) {
    if (collected.length >= budget) break;
    let jobs;
    try {
      jobs = await fetchBoard(b.ats, b.atsId, b.company);
    } catch (err) {
      boardFetchFailures++;
      console.warn(`[daily-scrape] ${label} ${b.company} fetch failed:`, err);
      continue;
    }
    stats.fetched += jobs.length;
    for (const job of jobs) {
      if (collected.length >= budget) break;
      const normUrl = normalizeJdUrl(job.jd_url);
      if (existingUrls.has(normUrl)) { stats.duplicate++; continue; }
      if (!isTargetLocation(job.location)) { stats.region++; continue; }
      // Same deterministic gate the matcher applies (senior title, >5y, thin, spam,
      // off-target) — dropping these here keeps the backlog full of jobs worth scoring.
      const why = gateReason(job.role, job.jd_text, { company: job.company, salaryRange: job.salary_range });
      if (why) { stats.gated++; skipped.set(why, (skipped.get(why) ?? 0) + 1); continue; }
      existingUrls.add(normUrl);
      collected.push({ ...job, _ats: b.ats });
      stats.kept++;
    }
  }
  console.log(
    `[daily-scrape] ${label}: boards ${boards.length} (${boardFetchFailures} fetch-failed), ` +
    `fetched ${stats.fetched}, duplicate ${stats.duplicate}, region-locked ${stats.region}, ` +
    `gated ${stats.gated}, KEPT ${stats.kept}`
  );
  if (skipped.size) {
    const summary = [...skipped].map(([r, n]) => `${r}: ${n}`).join(', ');
    console.log(`[daily-scrape] ${label}: gate reasons — ${summary}`);
  }
  return collected;
}

async function main() {
  const backlog = await backlogCount(supabase);
  console.log(`[daily-scrape] Current unscored backlog: ${backlog} (target ${BACKLOG_TARGET}).`);

  const room = BACKLOG_TARGET - backlog;
  if (room <= 0) {
    console.log('[daily-scrape] Backlog already at/above target — skipping scrape to let the matcher catch up.');
    return;
  }

  const existingUrls = await getExistingUrls(supabase);

  // 1) Remote boards first — fast, free, and the best fit for a remote-first search.
  //    They take up to ~60% of the room; the rest is split between the curated list
  //    and Apify discovery.
  const remoteBudget = Math.ceil(room * 0.6);
  const fromRemote = await fetchRemoteJobs(remoteBudget, existingUrls);
  console.log(`[daily-scrape] Collected ${fromRemote.length} from remote boards.`);

  const room2 = room - fromRemote.length;
  const halfList = Math.ceil(room2 / 2);
  console.log(`[daily-scrape] Room left ${room2} — ~${halfList} from curated list, rest from Apify.`);

  // 2) Curated company list (free, reliable), then 3) Apify for the remainder.
  const fromList = room2 > 0 ? await harvest(staticBoards(), halfList, existingUrls, 'list') : [];
  console.log(`[daily-scrape] Collected ${fromList.length} from curated list.`);

  let fromApify: PendingJob[] = [];
  const apifyBudget = room2 - fromList.length; // take leftover room too if list fell short
  if (process.env.SKIP_APIFY === 'true') {
    console.log('[daily-scrape] SKIP_APIFY=true — skipping Apify discovery.');
  } else if (apifyBudget > 0) {
    let boards: Board[] = [];
    try {
      boards = await discoveredBoards();
    } catch (err) {
      // Apify is a bonus source: if it is down, still insert what the list/remote boards found.
      console.warn('[daily-scrape] Apify discovery failed, continuing without it:', err);
    }
    console.log(`[daily-scrape] ${boards.length} boards discovered via Apify.`);
    fromApify = await harvest(boards, apifyBudget, existingUrls, 'apify');
    console.log(`[daily-scrape] Collected ${fromApify.length} from Apify discovery.`);
  }

  const toInsert = [...fromList, ...fromApify];
  for (const j of fromRemote) console.log(`[daily-scrape] + ${j.company} — ${j.role} [${j.location}] (${j.source})`);
  for (const j of toInsert) console.log(`[daily-scrape] + ${j.company} — ${j.role} [${j.location}]`);
  const inserted = (await insertManualJobs(supabase, fromRemote)) + (await insertJobs(supabase, toInsert));
  console.log(`[daily-scrape] Done. ${inserted} new jobs inserted (backlog now ~${backlog + inserted}).`);
  // Note: Indeed is intentionally NOT part of the daily run — it's a paid source
  // ($0.006/listing) run on a lighter cadence via Workflow 05 (agents/scraper/
  // indeed-search.ts). The daily run stays 100% free (curated list + Google).
}

main().catch(err => {
  console.error('[daily-scrape] Fatal:', err);
  process.exit(1);
});
