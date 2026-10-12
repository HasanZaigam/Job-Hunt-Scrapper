import fetch from 'node-fetch';
import { MIN_JD_TEXT_CHARS, type JobListing } from './greenhouse';
import { matchesAiKeywords } from './filters';

/**
 * Build a location string that keeps the region. Ashby marks remote jobs with
 * isRemote / workplaceType; collapsing those to a bare "Remote" (as this used to)
 * hid "US only"-style restrictions, so a US-only role looked open worldwide.
 */
export function ashbyLocation(job: any): string {
  const postal = job?.address?.postalAddress ?? {};
  const places = [
    job?.location ?? postal.addressLocality,
    postal.addressCountry,
    ...(Array.isArray(job?.secondaryLocations) ? job.secondaryLocations.map((s: any) => s?.location) : []),
  ].filter((p: any): p is string => typeof p === 'string' && p.trim() !== '');
  const unique = [...new Set(places.map(p => p.trim()))];
  const base = unique.join('; ');

  const workplace = String(job?.workplaceType ?? '').toLowerCase();
  const isRemote = job?.isRemote === true || workplace === 'remote';
  const isHybrid = workplace === 'hybrid';
  if (isRemote) return base ? (/remote/i.test(base) ? base : `Remote - ${base}`) : 'Remote';
  if (isHybrid) return base ? `Hybrid - ${base}` : 'Hybrid';
  return base || 'Unknown';
}

export async function fetchAshbyJobs(
  companyName: string,
  atsId: string
): Promise<JobListing[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${atsId}`;

  let data: any;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'JobAgentBot/1.0' },
    });
    if (!res.ok) {
      console.warn(`[ashby] ${companyName}: HTTP ${res.status}`);
      return [];
    }
    data = await res.json();
  } catch (err) {
    console.warn(`[ashby] ${companyName}: fetch error`, err);
    return [];
  }

  // Ashby's public posting-api returns { jobs: [...] }, not { jobPostings }.
  const jobs: any[] = data?.jobs ?? [];
  const results: JobListing[] = [];

  for (const job of jobs) {
    if (job.isListed === false) continue; // skip unlisted/closed postings
    if (!matchesAiKeywords(job.title ?? '')) continue;

    const jdText = job.descriptionPlain ?? job.descriptionHtml ?? '';
    if (jdText.length < MIN_JD_TEXT_CHARS) continue; // skip thin/un-tailorable JDs
    const location = ashbyLocation(job);

    results.push({
      company: companyName,
      role: job.title,
      jd_url:
        job.jobUrl ??
        `https://jobs.ashbyhq.com/${atsId}/${job.id}`,
      jd_text: jdText,
      ats_type: 'greenhouse', // normalised; caller sets actual ats_type
      location,
      salary_range:
        typeof job.compensation === 'string' ? job.compensation : null,
    });
  }

  return results;
}
