// Remote-first job sources: public, no-login JSON feeds from remote job boards.
//   - Remotive   https://remotive.com/api/remote-jobs
//   - RemoteOK   https://remoteok.com/api          (must link back to RemoteOK — we store its URL)
//   - Himalayas  https://himalayas.app/jobs/api    (must link back — we store its URL)
//   - Jobicy     https://jobicy.com/api/v2/remote-jobs
//   - Arbeitnow  https://www.arbeitnow.com/api/job-board-api (mostly Germany/EU —
//     low India-eligible yield is expected, not a bug; `remote`/`search` query
//     params are silently ignored by this API, verified live, so filtering is
//     all client-side)
//   - HN "Who is hiring?" — https://hn.algolia.com/api (the monthly thread's
//     comments are freeform text, not structured fields — company/role are a
//     best-effort parse of each comment's first line)
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
  source: 'remotive' | 'remoteok' | 'himalayas' | 'jobicy' | 'arbeitnow' | 'hn-hiring';
}

const UA = 'JobAgentBot/1.0 (personal job search; contact via GitHub)';

export function htmlToText(html: string): string {
  return String(html ?? '')
    .replace(/<\s*(br|\/p|\/li|\/div|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    // Hex numeric entities (&#x27; &#x2F; ...) — HN's API returns these (not
    // the decimal form &#39;), which the old `&#\d+;` strip-only rule left
    // untouched, leaving literal "&#x27;"/"&#x2F;" in company/role text.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
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

export function fromJobicy(r: any): RemoteJob | null {
  if (!r?.url || !r?.jobTitle || !r?.companyName) return null;
  const where = String(r.jobGeo ?? '').trim();
  return {
    company: String(r.companyName),
    role: String(r.jobTitle),
    jd_url: String(r.url),
    jd_text: htmlToText(r.jobDescription || r.jobExcerpt),
    location: `Remote - ${where || 'Worldwide'}`,
    salary_range: money(r.salaryMin, r.salaryMax, r.salaryCurrency),
    source: 'jobicy',
  };
}

export function fromArbeitnow(r: any): RemoteJob | null {
  if (!r?.url || !r?.title || !r?.company_name) return null;
  if (r.remote !== true) return null; // onsite/hybrid rows filtered out upstream too; defence in depth
  // Arbeitnow's `location` is the employer's base city, not a geographic
  // restriction (it's present even on remote:true rows) — `remote=true` and
  // `search` query params are ignored by this API (verified live), so there is
  // no server-side way to ask for "remote open to India/worldwide" directly.
  const where = String(r.location ?? '').trim();
  return {
    company: String(r.company_name),
    role: String(r.title),
    jd_url: String(r.url),
    jd_text: htmlToText(r.description),
    location: `Remote - ${where || 'Worldwide'}`,
    salary_range: null,
    source: 'arbeitnow',
  };
}

const HN_REMOTE_WORD = /\bremote\b/i;
const HN_AI_WORD = /\b(ai|llm|ml|machine learning|generative ai|genai)\b/i;

/**
 * HN "Who is hiring?" comments have no structured title/company/location
 * fields — just freeform text, conventionally starting "Company (Location) |
 * Title | stack" or similar. This is a best-effort parse of the first line,
 * not a reliable extraction; jd_text keeps the full comment so a human can
 * always read the real posting via jd_url.
 */
export function fromHnComment(threadId: number, c: any): RemoteJob | null {
  const html = String(c?.text ?? '');
  if (!html || !c?.id) return null;
  const text = htmlToText(html);
  if (!HN_REMOTE_WORD.test(text) || !HN_AI_WORD.test(text)) return null;

  const firstLine = text.split('\n')[0] ?? '';
  // These posts rarely have a line break between the "Company — Title —
  // Location — Employment type" header and the prose that follows, so a
  // later segment often silently absorbs the start of the description (e.g.
  // "...— Full-time We're looking for an AI Harness Engineer to build..."
  // is ONE segment, not two) — joining every segment past index 1 (the old
  // approach) then produces a multi-hundred-character "role". Taking only
  // the single next segment, hard-truncated, is less complete but far more
  // readable; this is a best-effort parse of freeform text, not reliable
  // extraction (see the module comment above).
  const parts = firstLine.split(/\s[—\-|]\s/).map(s => s.trim()).filter(Boolean);
  const company = parts[0]?.replace(/\s*\([^)]*\)\s*$/, '').trim() || 'HN: Who is hiring';
  const looksLikeUrl = (s?: string) => !!s && /^https?:\/\//i.test(s);
  const roleCandidate = (parts[1] && !looksLikeUrl(parts[1]) ? parts[1] : parts[2]) || firstLine || 'See posting';
  const role = roleCandidate.length > 100 ? `${roleCandidate.slice(0, 100)}…` : roleCandidate;

  // No structured location field exists — HN posters state restrictions
  // inline in freeform prose anywhere in the post ("Remote (US only)",
  // "remote, worldwide", "must be based in India", etc). Feed a window
  // around the first "remote" mention to the shared parser so it can catch
  // an explicit country/region word if one is actually there; genuinely
  // unrestricted or unclear posts correctly fall to "ambiguous" (rejected)
  // rather than being assumed worldwide. KNOWN LIMITATION: a post that
  // mentions multiple countries (e.g. "offices in the US, UK and India")
  // can be misread as India-eligible even if the remote role itself is
  // restricted — same class of imprecision as every other free-text source
  // here, not unique to HN.
  const idx = text.search(HN_REMOTE_WORD);
  const locationWindow = idx >= 0 ? text.slice(Math.max(0, idx - 60), idx + 120) : text.slice(0, 180);

  return {
    company: company.slice(0, 120),
    role: role.slice(0, 160),
    jd_url: `https://news.ycombinator.com/item?id=${c.id}`,
    jd_text: text,
    location: locationWindow.replace(/\s+/g, ' ').trim(),
    salary_range: null,
    source: 'hn-hiring',
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

async function fetchJobicy(): Promise<RemoteJob[]> {
  // "ai"/"ml" are too short for Jobicy's `tag` param (min 3 chars, verified
  // live) — "llm" works well; "machine-learning" and the data-science
  // industry bucket round out coverage.
  const queries = [
    'https://jobicy.com/api/v2/remote-jobs?count=50&tag=llm',
    'https://jobicy.com/api/v2/remote-jobs?count=50&tag=machine-learning',
    'https://jobicy.com/api/v2/remote-jobs?count=50&industry=data-science',
  ];
  const out: RemoteJob[] = [];
  for (const url of queries) {
    const data = await getJson(url, `jobicy`);
    for (const r of data?.jobs ?? []) {
      const j = fromJobicy(r);
      if (j) out.push(j);
    }
  }
  return out;
}

async function fetchArbeitnow(): Promise<RemoteJob[]> {
  // `remote`/`search` query params are ignored by this API (verified live,
  // 2026-10-19) — `page` is the only one that actually changes the result
  // set, so coverage comes from paginating, not querying.
  const out: RemoteJob[] = [];
  for (const page of [1, 2, 3]) {
    const data = await getJson(`https://www.arbeitnow.com/api/job-board-api?page=${page}`, `arbeitnow p${page}`);
    for (const r of data?.data ?? []) {
      const j = fromArbeitnow(r);
      if (j) out.push(j);
    }
  }
  return out;
}

async function fetchHnHiring(): Promise<RemoteJob[]> {
  // Find the current month's "Ask HN: Who is hiring?" thread (not "Who wants
  // to be hired?", which is candidates posting about themselves).
  const search = await getJson(
    'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10',
    'hn-hiring search'
  );
  const thread = (search?.hits ?? []).find((h: any) => /^Ask HN: Who is hiring\?/i.test(h.title ?? ''));
  if (!thread) { console.warn('[remote] hn-hiring: could not find a "Who is hiring?" thread'); return []; }

  const item = await getJson(`https://hn.algolia.com/api/v1/items/${thread.objectID}`, `hn-hiring thread ${thread.objectID}`);
  const comments: any[] = item?.children ?? [];
  const out: RemoteJob[] = [];
  for (const c of comments) {
    const j = fromHnComment(Number(thread.objectID), c);
    if (j) out.push(j);
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
    ['jobicy', fetchJobicy],
    ['arbeitnow', fetchArbeitnow],
    ['hn-hiring', fetchHnHiring],
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
