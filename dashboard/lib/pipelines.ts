// Allow-list of GitHub Actions workflows the dashboard may trigger. The browser only
// sends a key + optional mode; the workflow file and inputs are decided here, so the
// token can never be used to start anything else.
export interface PipelineDef {
  label: string;
  file: string;
  hint: string;
  inputs?: Record<string, string>;
}

export const PIPELINES: Record<string, PipelineDef> = {
  daily: {
    label: 'Daily pipeline',
    file: 'daily-pipeline.yml',
    hint: 'Score the backlog, then scrape new jobs (takes a few minutes).',
  },
  'daily-quick': {
    label: 'Quick test (no Apify)',
    file: 'daily-pipeline.yml',
    hint: 'Same run but skips the slow Apify discovery.',
    inputs: { skip_apify: 'true' },
  },
  'linkedin-weekly': {
    label: 'LinkedIn weekly drafts',
    file: 'linkedin-growth.yml',
    hint: '3 post drafts + scorecard to Telegram.',
    inputs: { mode: 'weekly' },
  },
  'linkedin-outreach': {
    label: 'LinkedIn outreach notes',
    file: 'linkedin-growth.yml',
    hint: 'Connection note + follow-up for jobs approved/applied in the last 26h.',
    inputs: { mode: 'outreach' },
  },
  'linkedin-scorecard': {
    label: 'Job-switch scorecard',
    file: 'linkedin-growth.yml',
    hint: 'Progress vs your weekly targets, sent to Telegram.',
    inputs: { mode: 'scorecard' },
  },
};

export function repoSlug(): string {
  return process.env.GITHUB_REPO || 'HasanZaigam/Job-Hunt-Scrapper';
}

export function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'job-hunt-dashboard',
  };
}
