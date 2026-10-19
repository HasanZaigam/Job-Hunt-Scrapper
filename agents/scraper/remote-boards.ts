// Remote-first job sources: public, no-login JSON feeds from remote job boards.
//   - Remotive   https://remotive.com/api/remote-jobs
//   - RemoteOK   https://remoteok.com/api          (must link back to RemoteOK — we store its URL)
//   - Himalayas  https://himalayas.app/jobs/api    (must link back — we store its URL)
//
// Each source is isolated: a failure (HTTP error, changed shape, rate limit) is
// logged and skipped, never thrown. Mapping functions are pure so they're unit-tested.
// Jobs from these boards have no ATS API, so they are stored as ats_type='custom' +
// is_manual_required=true (same as Indeed): you apply from the original posting page.

import { isEligibleLocation, matchesAiKeywords } from './filters';
import { gateReason } from './quality-gate';
import { MIN_JD_TEXT_CHARS } from './greenhouse';
import { fetchJsonRetry } from './retry';
import { normalizeJdUrl } from './store';

export interface RemoteJob {
  company: string;
  role: string;
  jd_url: string;
  jd_text: string;
  location: string;
  salary_range: string | null;
  source: 'remotive' | 'remoteok' | 'himalayas';
}

const UA = 'JobAgentBot/1.0 (personal job search; contact via GitHub)';

export function htmlToText(html: string): string {
  return String(html ?? '')
    .replace(/<\s*(br|\/p|\/li|\/div|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#\d+;/g, '')
    .replace(/[ \t]{2,}/g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

function money(min?: number | null, max?: number | null, cur?: string | null): string | null {
  if (!min && !max) return null;
  const c = cur ? ` ${cur}` : '';
  return `${min ?? ''}${min && max ? '-' : ''}${max ?? ''}${c}`.trim();
}

// ------------------------------------------------------------------ mappers

export function fromRemotive(r: any): RemoteJob | null {
  if (!r?.url || !r?.title || !r?.company_name) return null;
  const where = String(r.candidate_required_location ?? '').trim();
  return {
    company: String(r.company_name),
    role: String(r.title),
    jd_url: String(r.url),
    jd_text: htmlToText(r.description),
    // "Worldwide" / "USA Only" / "Europe" → "Remote - <region>" so the shared
    // location parser can tell open-to-India from region-locked.
    location: `Remote - ${where || 'Worldwide'}`,
    salary_range: r.salary ? String(r.salary) : null,
    source: 'remotive',
  };
}

export function fromRemoteOk(r: any): RemoteJob | null {
  if (!r?.url || !r?.position || !r?.company) return null;
  const where = String(r.location ?? '').trim();
  const tags = Array.isArray(r.tags) ? r.tags.join(' ') : '';
  return {
    company: String(r.company),
    role: String(r.position),
    jd_url: String(r.url),
    jd_text: [htmlToText(r.description), tags ? `Tags: ${tags}` : ''].filter(Boolean).join('\n'),
    location: `Remote - ${where || 'Worldwide'}`,
    salary_range: money(r.salary_min, r.salary_max, 'USD'),
    source: 'remoteok',
  };
}

export function fromHimalayas(r: any): RemoteJob | null {
  const url = r?.guid || r?.applicationLink;
  if (!url || !r?.title || !r?.companyName) return null;
  const restrictions: string[] = Array.isArray(r.locationRestrictions) ? r.locationRestrictions.filter(Boolean) : [];
  // No restriction listed = open worldwide.
  const where = restrictions.length ? restrictions.join('; ') : 'Worldwide';
  return {
    company: String(r.companyName),
    role: String(r.title),
    jd_url: String(url),
    jd_text: htmlToText(r.description || r.excerpt),
    location: `Remote - ${where}`,
    salary_range: money(r.minSalary, r.maxSalary, r.currency),
    source: 'himalayas',
  };
}

// ------------------------------------------------------------------ fetchers

function getJson(url: string, label: string): Promise<any | null> {
  return fetchJsonRetry(url, `remote/${label}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: 25000 } as any);
}

async function fetchRemotive(): Promise<RemoteJob[]> {
  // Mirrors the candidate's ranked target titles (search-profile.ts) so this
  // source surfaces the same roles the matcher actually wants, not just a
  // generic "ai" search.
  const queries = ['ai engineer', 'llm', 'generative ai', 'ai automation', 'applied ai'];
  const out: RemoteJob[] = [];
  for (const q of queries) {
    const data = await getJson(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=100`, `remotive "${q}"`);
    for (const r of data?.jobs ?? []) {
      const j = fromRemotive(r);
      if (j) out.push(j);
    }
  }
  return out;
}

async function fetchRemoteOk(): Promise<RemoteJob[]> {
  // Tried `?tags=ai` to pre-filter server-side (diagnosed 2026-10-19): fetched
  // dropped 99→86 but title-miss stayed ~86% — RemoteOK's "ai" tag isn't
  // reliably on AI-engineer titles (mostly data-labeling/AI-trainer gigs), and
  // narrowing to it risks missing untagged-but-relevant postings. Not worth it.
  const data = await getJson('https://remoteok.com/api', 'remoteok');
  if (!Array.isArray(data)) return [];
  // First element is a legal/metadata notice, not a job.
  return data.slice(1).map(fromRemoteOk).filter((j): j is RemoteJob => !!j);
}

async function fetchHimalayas(): Promise<RemoteJob[]> {
  const queries = ['ai engineer', 'llm engineer', 'generative ai developer', 'ai automation', 'associate ai engineer'];
  const out: RemoteJob[] = [];
  for (const q of queries) {
    const data = await getJson(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}`, `himalayas "${q}"`);
    for (const r of data?.jobs ?? []) {
      const j = fromHimalayas(r);
      if (j) out.push(j);
    }
  }
  return out;
}

// -------------------------------------------------------------------- public

/**
 * Pull remote jobs from all sources, keep only those a candidate in India can take
 * (open worldwide / India), with an AI-relevant title, that pass the quality gate,
 * de-duplicated against `existingUrls` (which is updated). Stops at `budget`.
 */
export async function fetchRemoteJobs(budget: number, existingUrls: Set<string>): Promise<RemoteJob[]> {
  if (budget <= 0) return [];
  const sources: [string, () => Promise<RemoteJob[]>][] = [
    ['remotive', fetchRemotive],
    ['remoteok', fetchRemoteOk],
    ['himalayas', fetchHimalayas],
  ];

  const collected: RemoteJob[] = [];
  for (const [name, fetcher] of sources) {
    const t0 = Date.now();
    let raw: RemoteJob[] = [];
    try { raw = await fetcher(); } catch (err: any) { console.warn(`[remote] ${name} failed: ${err?.message ?? err}`); }

    const stats = { fetched: raw.length, duplicate: 0, title: 0, region: 0, thin: 0, gated: 0, kept: 0 };
    for (const j of raw) {
      if (collected.length >= budget) break;
      const normUrl = normalizeJdUrl(j.jd_url);
      if (existingUrls.has(normUrl)) { stats.duplicate++; continue; }
      if (!matchesAiKeywords(j.role)) { stats.title++; continue; }
      if (!isEligibleLocation(j.location)) { stats.region++; continue; }
      if (j.jd_text.length < MIN_JD_TEXT_CHARS) { stats.thin++; continue; }
      if (gateReason(j.role, j.jd_text, { company: j.company, salaryRange: j.salary_range })) { stats.gated++; continue; }
      existingUrls.add(normUrl);
      collected.push(j);
      stats.kept++;
    }
    console.log(`[remote] ${name}: fetched ${stats.fetched}, duplicate ${stats.duplicate}, title-miss ${stats.title}, region-locked ${stats.region}, thin ${stats.thin}, gated ${stats.gated}, KEPT ${stats.kept} (${Date.now() - t0}ms)`);
  }
  return collected;
}
