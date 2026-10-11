import type { FreshnessResult } from '../types';

// Deterministic decay from days since the job was scraped (used as a proxy
// for posting recency — the ATS APIs this pipeline reads from don't
// reliably expose an original posting date, only when we first saw it).

export function computeFreshness(scrapedAt: Date, now: Date): FreshnessResult {
  const daysOld = Math.max(0, Math.floor((now.getTime() - scrapedAt.getTime()) / (1000 * 60 * 60 * 24)));
  let score: number;
  if (daysOld <= 3) score = 100;
  else if (daysOld >= 30) score = 20;
  else score = Math.round(100 - (daysOld - 3) * (80 / 27));

  return {
    score,
    days_old: daysOld,
    reason: `scraped ${daysOld} day(s) ago (proxy for posting recency, not the JD's own posted-date field)`,
  };
}
