// LinkedIn growth + outreach + weekly scorecard. DRAFT ONLY: nothing is posted,
// connected or messaged on LinkedIn by this agent. Output goes to Telegram and
// the owner sends it by hand.
//
//   npx ts-node agents/linkedin/index.ts weekly     # 3 post drafts + scorecard (Sunday)
//   npx ts-node agents/linkedin/index.ts outreach   # connection note + follow-up per job applied/approved in last 26h
//   npx ts-node agents/linkedin/index.ts content    # only the 3 post drafts
//   npx ts-node agents/linkedin/index.ts scorecard  # only the scorecard
//
// Env: GOOGLE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// With no Telegram env set, drafts are printed to the log instead (DRY RUN).

import * as dotenv from 'dotenv';
import path from 'path';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import { generateWithRetry } from '../lib/gemini';
import baseResume from '../resume-generator/base-resume.json';
import goal from './goal.json';
import {
  factsOf,
  parseJson,
  validatePost,
  validateOutreach,
  buildPostPrompt,
  buildOutreachPrompt,
  buildScorecard,
  escHtml,
  type Post,
  type OutreachDraft,
} from './lib';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

export type GenerateFn = (prompt: string) => Promise<string>;

const defaultGenerate: GenerateFn = (prompt) =>
  generateWithRetry(prompt, {
    tag: 'linkedin',
    generationConfig: { temperature: 0.7, responseMimeType: 'application/json' },
  });

// ------------------------------------------------------------------ generation

/** Generate with one self-correcting retry: problems found by validation are fed back to the model. */
export async function generateValidated<T>(
  build: (problems: string[]) => string,
  validate: (x: T) => string[],
  generate: GenerateFn,
  maxAttempts = 2
): Promise<{ value: T; problems: string[] }> {
  let problems: string[] = [];
  let value!: T;
  for (let i = 0; i < maxAttempts; i++) {
    value = parseJson<T>(await generate(build(problems)));
    problems = validate(value);
    if (problems.length === 0) break;
  }
  return { value, problems };
}

export async function makePosts(facts: string, weekOf: string, generate: GenerateFn = defaultGenerate) {
  const { value, problems } = await generateValidated<Post[]>(
    (p) => buildPostPrompt(facts, weekOf, p),
    (posts) => {
      if (!Array.isArray(posts) || posts.length !== 3) return ['must return exactly 3 posts'];
      return posts.flatMap((p, i) => validatePost(p, facts).map((x) => `post ${i + 1}: ${x}`));
    },
    generate
  );
  return { posts: value, problems };
}

export async function makeOutreach(
  facts: string,
  job: { company: string; role: string; jd_text?: string | null },
  generate: GenerateFn = defaultGenerate
) {
  return generateValidated<OutreachDraft>(
    (p) => buildOutreachPrompt(facts, job, p),
    (d) => validateOutreach(d, facts),
    generate
  );
}

// -------------------------------------------------------------------- delivery

async function send(html: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.log('[linkedin] DRY RUN (no Telegram env). Message follows:\n' + html.replace(/<[^>]+>/g, '') + '\n');
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: html.slice(0, 3900), parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) console.warn(`[linkedin] Telegram HTTP ${res.status}`);
}

function supabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
}

// ------------------------------------------------------------------------ modes

function mondayOfThisWeek(d = new Date()): string {
  const x = new Date(d);
  const day = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - day);
  return x.toISOString().slice(0, 10);
}

async function runContent() {
  const facts = factsOf(baseResume);
  const weekOf = mondayOfThisWeek();
  const { posts, problems } = await makePosts(facts, weekOf);
  await send(`<b>LinkedIn drafts for week of ${weekOf}</b>\nPost them yourself. Read each one and edit anything that is not true for you.`);
  for (const p of posts) {
    const tags = (p.hashtags ?? []).join(' ');
    await send(`<b>${escHtml(p.day)}</b>\n\n${escHtml(p.hook)}\n\n${escHtml(p.body)}\n\n${escHtml(tags)}`);
  }
  if (problems.length) await send(`Validation notes (check these before posting):\n${escHtml(problems.join('\n'))}`);
  await send(
    [
      '<b>This week, by hand (20 min/day)</b>',
      `- Comment thoughtfully on 5 posts by engineers or recruiters at target companies`,
      `- Send ${goal.weeklyOutreach} connection requests with the notes from the daily outreach drafts`,
      `- Reply to every comment on your own posts within a day`,
    ].join('\n')
  );
}

async function runOutreach() {
  const facts = factsOf(baseResume);
  const since = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
  const { data, error } = await supabase()
    .from('applications')
    .select('company, role, jd_url, jd_text, status, updated_at')
    .in('status', ['approved', 'applied'])
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(5);
  if (error) throw new Error(`Supabase: ${error.message}`);
  if (!data?.length) {
    console.log('[linkedin] No jobs approved/applied in the last 26h; nothing to draft.');
    return;
  }
  for (const job of data) {
    const { value, problems } = await makeOutreach(facts, job);
    const note = problems.length ? `\n<i>Check: ${escHtml(problems.join('; '))}</i>` : '';
    await send(
      `<b>${escHtml(job.company)}</b> — ${escHtml(job.role)} (${job.status})\n<a href="${escHtml(job.jd_url ?? '')}">Job link</a>\n\n` +
        `<b>Connection note</b>\n${escHtml(value.connection_note)}\n\n<b>After they accept</b>\n${escHtml(value.followup)}${note}`
    );
  }
}

async function runScorecard() {
  const sb = supabase();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const count = async (statuses: string[], from?: string) => {
    let q = sb.from('applications').select('id', { count: 'exact', head: true }).in('status', statuses);
    if (from) q = q.gte('applied_at', from);
    const { count: c, error } = await q;
    if (error) throw new Error(`Supabase: ${error.message}`);
    return c ?? 0;
  };
  const everApplied = ['applied', 'interview_scheduled', 'assessment', 'rejected', 'offer'];
  const msg = buildScorecard({
    today: new Date(),
    goal,
    appliedLast7Days: await count(everApplied, since),
    appliedTotal: await count(everApplied),
    interviews: await count(['interview_scheduled', 'assessment']),
    offers: await count(['offer']),
    matchedWaiting: await count(['matched', 'approved']),
  });
  await send(msg);
}

async function main() {
  const mode = process.argv[2] ?? 'weekly';
  if (mode === 'weekly') {
    await runContent();
    await runScorecard();
  } else if (mode === 'content') await runContent();
  else if (mode === 'outreach') await runOutreach();
  else if (mode === 'scorecard') await runScorecard();
  else {
    console.error(`Unknown mode "${mode}". Use weekly | content | outreach | scorecard`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[linkedin] failed:', e?.message ?? e);
    process.exit(1);
  });
}
