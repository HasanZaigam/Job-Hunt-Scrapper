import { matchesAiKeywords } from './filters';
import { fetchJsonRetry } from './retry';

export interface JobListing {
  company: string;
  role: string;
  jd_url: string;
  jd_text: string;
  ats_type: 'greenhouse';
  location: string;
  salary_range: string | null;
}

// Jobs whose JD text is shorter than this are un-tailorable (often just section
// headers with no body) — skip them so they don't waste match quota or pollute
// the approval queue. Shared by all three ATS fetchers.
export const MIN_JD_TEXT_CHARS = 300;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function fetchGreenhouseJobs(
  companyName: string,
  atsId: string
): Promise<JobListing[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${atsId}/jobs?content=true`;
  const data = await fetchJsonRetry(url, `greenhouse ${companyName}`, { headers: { 'User-Agent': 'JobAgentBot/1.0' } });
  const jobs: any[] = data?.jobs ?? [];
  const results: JobListing[] = [];

  for (const job of jobs) {
    if (!matchesAiKeywords(job.title ?? '')) continue;

    const jdHtml = job.content ?? '';
    const jdText = stripHtml(jdHtml);
    if (jdText.length < MIN_JD_TEXT_CHARS) continue; // skip thin/un-tailorable JDs
    const location =
      job.location?.name ?? job.offices?.[0]?.name ?? 'Unknown';

    results.push({
      company: companyName,
      role: job.title,
      jd_url: job.absolute_url ?? `https://boards.greenhouse.io/${atsId}/jobs/${job.id}`,
      jd_text: jdText,
      ats_type: 'greenhouse',
      location,
      salary_range: null,
    });
  }

  return results;
}
