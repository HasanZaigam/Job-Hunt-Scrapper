// Pure helpers for the LinkedIn growth + outreach agent. No network, no secrets,
// so everything here is unit-testable (see __tests__/linkedin.test.ts).
//
// Safety rule for this whole folder: DRAFT ONLY. Nothing here posts, connects,
// messages or scrapes on LinkedIn. The agent writes drafts to Telegram and the
// owner posts/sends them by hand (LinkedIn bans automation; see CLAUDE.md).

export const CONNECTION_NOTE_MAX = 280; // LinkedIn Premium note limit is 300; keep headroom
export const POST_BODY_MIN = 450;
export const POST_BODY_MAX = 1300;
export const MAX_HASHTAGS = 4;

const BANNED_PHRASES = [
  'excited to announce',
  'thrilled to announce',
  'game-changer',
  'game changer',
  'revolutionize',
  'delve',
  'in today\'s fast-paced',
  'i am humbled',
  'unlock the power',
];

export interface Post {
  day: string;
  hook: string;
  body: string;
  hashtags: string[];
}

export interface OutreachDraft {
  connection_note: string;
  followup: string;
}

/** Compact, facts-only JSON of the resume. The model may use nothing outside this. */
export function factsOf(resume: any): string {
  const keep = {
    name: resume.name,
    summary: resume.summary,
    experience: resume.experience,
    projects: resume.projects,
    skills: resume.skills,
    certifications: resume.certifications,
    strengths: resume.strengths,
  };
  return JSON.stringify(keep);
}

/** Strip ```json fences and parse. Throws a readable error on bad JSON. */
export function parseJson<T>(text: string): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch (e: any) {
    throw new Error(`Model did not return valid JSON: ${e.message}`);
  }
}

const norm = (s: string) => s.replace(/[,\s]/g, '').toLowerCase();

/**
 * Numbers that are NOT in the facts. Small plain numbers (1-9) are ignored so
 * "3 lessons" is fine; anything >= 10, or carrying + or %, must come from facts.
 */
export function numbersNotInFacts(text: string, facts: string): string[] {
  const hay = norm(facts);
  const found = text.match(/\d[\d,]*(?:\.\d+)?\s?[+%]?/g) ?? [];
  const bad: string[] = [];
  for (const raw of found) {
    const tok = raw.trim();
    const n = parseFloat(tok.replace(/,/g, ''));
    const decorated = /[+%]/.test(tok);
    if (!decorated && n < 10) continue;
    if (!hay.includes(norm(tok.replace(/[+%]/g, '')))) bad.push(tok);
  }
  return Array.from(new Set(bad));
}

export function validatePost(p: Post, facts: string): string[] {
  const problems: string[] = [];
  const text = `${p.hook}\n${p.body}`.toLowerCase();
  if (!p.hook || p.hook.length > 140) problems.push('hook must be 1-140 chars');
  if (p.body.length < POST_BODY_MIN) problems.push(`body too short (<${POST_BODY_MIN} chars)`);
  if (p.body.length > POST_BODY_MAX) problems.push(`body too long (>${POST_BODY_MAX} chars)`);
  if ((p.hashtags ?? []).length > MAX_HASHTAGS) problems.push(`max ${MAX_HASHTAGS} hashtags`);
  for (const b of BANNED_PHRASES) if (text.includes(b)) problems.push(`banned phrase: "${b}"`);
  const nums = numbersNotInFacts(`${p.hook} ${p.body}`, facts);
  if (nums.length) problems.push(`numbers not in facts: ${nums.join(', ')}`);
  return problems;
}

export function validateOutreach(d: OutreachDraft, facts: string): string[] {
  const problems: string[] = [];
  if (!d.connection_note || d.connection_note.length > CONNECTION_NOTE_MAX)
    problems.push(`connection_note must be 1-${CONNECTION_NOTE_MAX} chars`);
  if (!d.followup || d.followup.length > 700) problems.push('followup must be 1-700 chars');
  const nums = numbersNotInFacts(`${d.connection_note} ${d.followup}`, facts);
  if (nums.length) problems.push(`numbers not in facts: ${nums.join(', ')}`);
  return problems;
}

export function buildPostPrompt(facts: string, weekOf: string, problems: string[] = []): string {
  return `You write LinkedIn posts for the candidate described in FACTS. Week of ${weekOf}.

FACTS (the ONLY source of truth):
${facts}

Write exactly 3 posts for this week, each from a DIFFERENT angle:
1. A real build lesson from one project in FACTS (what was built, one decision, one trade-off).
2. A short, practical explainer of one concept in FACTS (e.g. RAG, MCP, agents, FastAPI async, Redis queues) for other developers.
3. A "how I work" or learning-in-public post tied to FACTS, ending with a genuine question.

HARD RULES
- Use ONLY facts, tools, projects and numbers present in FACTS. Never invent metrics, employers, results, users, clients or opinions presented as experience.
- Do not claim seniority or years of experience.
- Plain, specific English. Short paragraphs. No emojis in the first line. No corporate filler.
- Never use: excited to announce, thrilled, game-changer, delve, unlock the power.
- hook: first line, max 140 chars. body: ${POST_BODY_MIN}-${POST_BODY_MAX} chars. hashtags: at most ${MAX_HASHTAGS}.
- day: suggested posting day, one of Tue, Thu, Sat.

Return ONLY a JSON array of 3 objects: [{"day":"Tue","hook":"...","body":"...","hashtags":["#..."]}]
${problems.length ? `\nYour previous attempt had these problems, fix them:\n- ${problems.join('\n- ')}\n` : ''}`;
}

export function buildOutreachPrompt(
  facts: string,
  job: { company: string; role: string; jd_text?: string | null },
  problems: string[] = []
): string {
  const jd = (job.jd_text ?? '').slice(0, 1500);
  return `Write two short LinkedIn messages for the candidate in FACTS, for a job they applied to.

FACTS (the ONLY source of truth):
${facts}

JOB: ${job.role} at ${job.company}
JD EXCERPT: ${jd || '(not available)'}

1. connection_note: max ${CONNECTION_NOTE_MAX} characters, to a recruiter or hiring manager at ${job.company}. Mention the role and ONE concrete, true link between FACTS and the role. No begging, no "I would love an opportunity".
2. followup: max 600 characters, sent after they accept. Say that you applied, name one relevant project from FACTS in one sentence, and ask one low-friction question.

HARD RULES: only use FACTS; no invented numbers, tools or experience; no claims of years of experience; no emojis.

Return ONLY JSON: {"connection_note":"...","followup":"..."}
${problems.length ? `\nFix these problems from your last attempt:\n- ${problems.join('\n- ')}\n` : ''}`;
}

export interface GoalConfig {
  deadline: string; // ISO date the owner wants to have switched by
  weeklyApplications: number;
  weeklyOutreach: number;
  weeklyPosts: number;
}

export interface ScorecardInput {
  today: Date;
  goal: GoalConfig;
  appliedLast7Days: number;
  appliedTotal: number;
  interviews: number;
  offers: number;
  matchedWaiting: number;
}

export function buildScorecard(i: ScorecardInput): string {
  const daysLeft = Math.max(0, Math.ceil((new Date(i.goal.deadline).getTime() - i.today.getTime()) / 86_400_000));
  const weeksLeft = Math.max(1, Math.ceil(daysLeft / 7));
  const pace = i.appliedLast7Days >= i.goal.weeklyApplications ? 'on target' : `${i.goal.weeklyApplications - i.appliedLast7Days} short of target`;
  const lines = [
    `<b>Job switch scorecard</b>`,
    `Goal date: ${i.goal.deadline} (${daysLeft} days, ${weeksLeft} weeks left)`,
    ``,
    `Applications this week: <b>${i.appliedLast7Days}</b> / ${i.goal.weeklyApplications} (${pace})`,
    `Applications total: ${i.appliedTotal}`,
    `Interviews: ${i.interviews} · Offers: ${i.offers}`,
    `Matched jobs waiting for you: ${i.matchedWaiting}`,
    ``,
    `This week also: ${i.goal.weeklyOutreach} outreach messages, ${i.goal.weeklyPosts} LinkedIn posts.`,
  ];
  if (i.appliedTotal >= 20 && i.interviews === 0) {
    lines.push(``, `20+ applications and no interview yet: review resume and role targeting before sending more.`);
  }
  return lines.join('\n');
}

export function escHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
