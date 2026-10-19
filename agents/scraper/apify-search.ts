import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { withRetry, RetryableHttpError } from './retry';

// withRetry now lives in ./retry (shared with greenhouse/lever/ashby/remote-boards).
// Re-exported here so existing imports (scraper/__tests__/apify-retry.test.ts) keep working.
export { withRetry } from './retry';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN!;
const ACTOR_ID = 'apify~google-search-scraper';

// Widening this list is free: it only adds OR-terms inside the existing 3
// queries (one per ATS domain) — Apify bills per query page scraped, not per
// term inside a query, so this doesn't change the cost estimate below.
const DEFAULT_LOCATIONS = [
  'Bengaluru', 'Bangalore', 'Chennai', 'Hyderabad', 'Gurugram', 'Gurgaon', 'Noida', 'Pune', 'India',
  'Remote India', 'Remote - APAC', 'Remote - Worldwide', 'Anywhere',
];

function getSearchParameters() {
  try {
    const p = path.resolve(__dirname, '../resume-generator/base-resume.json');
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const kws = data.target_keywords || ["AI Engineer", "GenAI", "Machine Learning", "LLM Engineer", "MLOps"];
      const locs = data.target_locations || DEFAULT_LOCATIONS;
      return { kws, locs };
    }
  } catch (err) {
    console.error('[apify-search] Error reading search parameters from base-resume.json:', err);
  }
  return {
    kws: ["AI Engineer", "GenAI", "Machine Learning", "LLM Engineer", "MLOps"],
    locs: DEFAULT_LOCATIONS,
  };
}

interface DiscoveredJob {
  company: string;
  ats: 'greenhouse' | 'lever' | 'ashby';
  ats_id: string;
  job_url: string;
}

function parseGreenhouseUrl(url: string): { ats_id: string; job_url: string } | null {
  const m = url.match(/boards\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/);
  if (!m) return null;
  return { ats_id: m[1], job_url: url };
}

function parseLeverUrl(url: string): { ats_id: string; job_url: string } | null {
  const m = url.match(/jobs\.lever\.co\/([^/]+)\//);
  if (!m) return null;
  return { ats_id: m[1], job_url: url };
}

function parseAshbyUrl(url: string): { ats_id: string; job_url: string } | null {
  const m = url.match(/jobs\.ashbyhq\.com\/([^/]+)\//);
  if (!m) return null;
  return { ats_id: m[1], job_url: url };
}

async function runApifyActor(query: string): Promise<string[]> {
  // run-sync-get-dataset-items blocks until the run finishes and returns the
  // dataset directly — simpler and more reliable than creating a run + polling.
  const res = await withRetry(async () => {
    const r = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_API_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // `resultsPerPage` is NOT a valid field for this actor and was silently
          // ignored, capping every query at a single page (~10 results). Each page
          // is ~10 results, so maxPagesPerQuery: 3 yields ~30 candidate URLs/query.
          queries: query,
          maxPagesPerQuery: 3,
        }),
      }
    );
    // 408 added 2026-10-19: widening the location query terms (region-lock
    // audit) made run-sync-get-dataset-items occasionally time out on a slow
    // Google Search Scraper run — that's transient, not a bad query, and is
    // worth retrying the same way 429/5xx already are.
    if (r.status === 408 || r.status === 429 || r.status >= 500) throw new RetryableHttpError(`HTTP ${r.status}`);
    return r;
  });

  if (!res.ok) {
    console.warn(`[apify] Actor run failed: ${res.status}`);
    return [];
  }

  const items: any[] = await res.json();

  return items.flatMap((item: any) =>
    (item.organicResults ?? []).map((r: any) => r.url as string).filter(Boolean)
  );
}

export async function discoverNewJobs(dryRun = false): Promise<DiscoveredJob[]> {
  if (dryRun) {
    console.log('[apify] dry-run: skipping Apify calls');
    return [];
  }

  const { kws, locs } = getSearchParameters();
  const keywordsStr = kws.map((k: string) => `"${k}"`).join(' OR ');
  const locationsStr = locs.map((l: string) => `"${l}"`).join(' OR ');

  const queries = [
    `site:boards.greenhouse.io (${keywordsStr}) (${locationsStr})`,
    `site:jobs.lever.co (${keywordsStr}) (${locationsStr})`,
    `site:jobs.ashbyhq.com (${keywordsStr}) (${locationsStr})`,
  ];

  const discovered: DiscoveredJob[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    console.log(`[apify] querying: ${query}`);
    let urls: string[] = [];
    try {
      urls = await runApifyActor(query);
    } catch (err) {
      // One flaky query must not throw away the rest of the run.
      console.warn(`[apify] query failed after retries, skipping it: ${(err as Error)?.message ?? err}`);
    }

    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);

      const gh = parseGreenhouseUrl(url);
      if (gh) {
        discovered.push({ company: gh.ats_id, ats: 'greenhouse', ...gh });
        continue;
      }
      const lv = parseLeverUrl(url);
      if (lv) {
        discovered.push({ company: lv.ats_id, ats: 'lever', ...lv });
        continue;
      }
      const ab = parseAshbyUrl(url);
      if (ab) {
        discovered.push({ company: ab.ats_id, ats: 'ashby', ...ab });
      }
    }
  }

  console.log(`[apify] discovered ${discovered.length} new job URLs`);
  return discovered;
}
