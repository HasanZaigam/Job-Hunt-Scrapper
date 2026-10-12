// Sends a run summary + the best matched jobs to Telegram.
//
//   npx ts-node agents/telegram-bot/digest.ts           # summary + new matched jobs
//   npx ts-node agents/telegram-bot/digest.ts --test    # just "bot connected" ping
//
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY
//      TELEGRAM_INCLUDE_FILTERED=true  -> also list recently filtered-out jobs
//
// The bot token is never printed. Every failure prints a specific hint instead
// (bad token format, token rejected, chat not found, bot not started …).

import * as dotenv from 'dotenv';
import path from 'path';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import { titleRank, FALLBACK_RANK } from '../scraper/search-profile';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const MAX_MESSAGE_CHARS = 3500; // Telegram hard limit is 4096; leave headroom
const MATCHED_LIMIT = 10;
const MATCHED_POOL = 60; // fetch the best-scoring pool, then order by preferred title
const FILTERED_LIMIT = 40;
const FALLBACK_WINDOW_HOURS = 72;

export interface JobRow {
  id?: string;
  company: string;
  role: string;
  location?: string | null;
  match_score?: number | null;
  jd_url?: string | null;
  match_justification?: string | null;
}

// ----------------------------------------------------------------- formatting

export function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attr(s: string): string {
  return esc(s).replace(/"/g, '&quot;');
}

/** Contract / freelance / per-task postings are flagged, not hidden — they are rarely a full-time offer. */
export function isContractLike(role: string): boolean {
  return /\b(contract|contractor|freelance|task[- ]?based|per task|per hour)\b|\/\s?(hr|hour|task)\b/i.test(role || '');
}

export function formatMatchedLine(j: JobRow, rank: number): string {
  const score = j.match_score != null ? `${j.match_score}` : '–';
  const tr = titleRank(j.role);
  const tag = tr && tr.rank < FALLBACK_RANK ? ` <i>T${tr.rank}</i>` : '';
  const where = [
    j.location ? `📍 ${esc(j.location)}` : '',
    isContractLike(j.role) ? '🧾 contract/task-based' : '',
    j.jd_url ? `<a href="${attr(j.jd_url)}">Open job</a>` : '',
  ]
    .filter(Boolean).join(' · ');
  return `${rank}. <b>${score}</b>${tag} ${esc(j.company)} — ${esc(j.role)}${where ? `\n    ${where}` : ''}`;
}

export function formatFilteredLine(j: JobRow): string {
  const why = (j.match_justification ?? '').replace(/^Filtered:\s*/i, '').trim() || 'filtered';
  return `• ${esc(j.company)} — ${esc(j.role)} <i>(${esc(why)})</i>`;
}

/** Joins lines into messages of at most `max` characters, never splitting a line. */
export function chunkLines(lines: string[], max = MAX_MESSAGE_CHARS): string[] {
  const out: string[] = [];
  let cur = '';
  for (const line of lines) {
    if (cur && cur.length + line.length + 1 > max) {
      out.push(cur);
      cur = '';
    }
    cur += (cur ? '\n' : '') + line.slice(0, max);
  }
  if (cur) out.push(cur);
  return out;
}

// ------------------------------------------------------------------- telegram

interface TgResult { ok: boolean; description?: string; status: number }

async function tg(token: string, method: string, body?: object): Promise<TgResult> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const j: any = await res.json().catch(() => ({}));
    return { ok: j.ok === true, description: j.description, status: res.status };
  } catch (err: any) {
    return { ok: false, description: `network error: ${err?.message ?? err}`, status: 0 };
  }
}

function hintFor(r: TgResult): string {
  const d = (r.description ?? '').toLowerCase();
  if (r.status === 401 || d.includes('unauthorized'))
    return 'Telegram rejected the bot token. Copy the FULL token from @BotFather (/mybots → your bot → API Token); if you revoked it, use the new one.';
  if (d.includes("can't send messages to the bot"))
    return 'TELEGRAM_CHAT_ID is the ID of a BOT (very likely this bot\'s own number — the digits before the colon in its token), not your personal chat. Message @userinfobot in Telegram, copy the "Id" it replies with, and save that as TELEGRAM_CHAT_ID.';
  if (d.includes('chat not found'))
    return 'Chat not found. Open your bot in Telegram and press Start (or send it any message) first, and check TELEGRAM_CHAT_ID is your numeric id (see @userinfobot).';
  if (d.includes('blocked'))
    return 'The bot was blocked by this chat. Unblock it in Telegram and press Start.';
  if (d.includes('network')) return 'Could not reach api.telegram.org.';
  return 'See the description above.';
}

async function validateAndGetSender(): Promise<((html: string) => Promise<boolean>) | null> {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID ?? '').trim();
  if (!token || !chatId) {
    console.error('[digest] TELEGRAM_BOT_TOKEN and/or TELEGRAM_CHAT_ID are not set — nothing sent.');
    return null;
  }
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
    console.error('[digest] TELEGRAM_BOT_TOKEN does not look like a BotFather token (expected "<digits>:<letters>", e.g. 123456789:AAH…). Copy the full token including the number before the colon.');
    return null;
  }
  if (chatId === token.split(':')[0]) {
    console.error('[digest] TELEGRAM_CHAT_ID equals this bot\'s own id (the digits before the colon in the token). Use YOUR personal chat id instead: message @userinfobot in Telegram and copy the "Id" it replies with.');
    return null;
  }
  const me = await tg(token, 'getMe');
  if (!me.ok) {
    console.error(`[digest] Telegram getMe failed (HTTP ${me.status}): ${me.description ?? 'unknown'}\n[digest] Hint: ${hintFor(me)}`);
    return null;
  }
  console.log('[digest] Telegram bot token is valid.');

  return async (html: string) => {
    const r = await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    if (!r.ok) console.error(`[digest] sendMessage failed (HTTP ${r.status}): ${r.description ?? 'unknown'}\n[digest] Hint: ${hintFor(r)}`);
    return r.ok;
  };
}

// ------------------------------------------------------------------- supabase

type Supabase = any; // untyped table access, same as the other agents

async function statusCounts(sb: Supabase): Promise<Record<string, number>> {
  const statuses = ['scraped', 'matched', 'filtered', 'approved', 'applied'];
  const entries = await Promise.all(
    statuses.map(async s => {
      const { count } = await sb.from('applications').select('*', { count: 'exact', head: true }).eq('status', s);
      return [s, count ?? 0] as const;
    })
  );
  return Object.fromEntries(entries);
}

const JOB_COLS = 'id, company, role, location, match_score, jd_url, match_justification';

/** Preferred title first (T1..T5, then other AI/ML), best score first within each. */
export function pickTop(rows: JobRow[], limit = MATCHED_LIMIT): JobRow[] {
  const rankOf = (j: JobRow) => titleRank(j.role)?.rank ?? FALLBACK_RANK + 1;
  return [...rows]
    .sort((a, b) => rankOf(a) - rankOf(b) || (b.match_score ?? 0) - (a.match_score ?? 0))
    .slice(0, limit);
}

async function fetchNewMatched(sb: Supabase): Promise<{ rows: JobRow[]; tracked: boolean }> {
  // Preferred: only jobs not yet notified (needs migration 005's notified_at).
  const first = await sb
    .from('applications').select(JOB_COLS).eq('status', 'matched')
    .is('notified_at', null).order('match_score', { ascending: false }).limit(MATCHED_POOL);
  if (!first.error) return { rows: pickTop((first.data ?? []) as unknown as JobRow[]), tracked: true };

  if (!/notified_at/i.test(first.error.message)) throw new Error(first.error.message);

  // Column not there yet: fall back to a recent-activity window.
  console.warn('[digest] notified_at column missing (migration 005 not applied) — using a recent-jobs window; jobs may repeat between runs.');
  const since = new Date(Date.now() - FALLBACK_WINDOW_HOURS * 3600 * 1000).toISOString();
  const fb = await sb
    .from('applications').select(JOB_COLS).eq('status', 'matched')
    .gte('updated_at', since).order('match_score', { ascending: false }).limit(MATCHED_POOL);
  if (fb.error) throw new Error(fb.error.message);
  return { rows: pickTop((fb.data ?? []) as unknown as JobRow[]), tracked: false };
}

async function fetchFiltered(sb: Supabase): Promise<JobRow[]> {
  const { data, error } = await sb
    .from('applications').select(JOB_COLS).eq('status', 'filtered')
    .order('updated_at', { ascending: false }).limit(FILTERED_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as JobRow[];
}

// ------------------------------------------------------------------------ main

async function main() {
  const send = await validateAndGetSender();
  if (!send) { process.exitCode = 1; return; }

  if (process.argv.includes('--test')) {
    const ok = await send('✅ <b>Job Hunt bot connected.</b>\nYou will get run summaries and new matches here.');
    console.log(ok ? '[digest] Test message sent.' : '[digest] Test message FAILED.');
    process.exitCode = ok ? 0 : 1;
    return;
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('[digest] SUPABASE_URL / SUPABASE_SERVICE_KEY not set — cannot build the digest.');
    process.exitCode = 1;
    return;
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const counts = await statusCounts(sb);
  const { rows: matched, tracked } = await fetchNewMatched(sb);

  const lines = [
    `📊 <b>Job Hunt</b> · to score <b>${counts.scraped}</b> · matched <b>${counts.matched}</b> · filtered <b>${counts.filtered}</b> · approved <b>${counts.approved}</b> · applied <b>${counts.applied}</b>`,
    '',
    matched.length ? `🎯 <b>Top ${matched.length} new matches</b>` : 'No new matched jobs this time.',
    ...matched.map((j, i) => formatMatchedLine(j, i + 1)),
  ];
  let ok = true;
  for (const chunk of chunkLines(lines)) ok = (await send(chunk)) && ok;

  if (process.env.TELEGRAM_INCLUDE_FILTERED === 'true') {
    const filtered = await fetchFiltered(sb);
    if (filtered.length) {
      const lines = [`🗑 <b>Recently filtered out</b> (${filtered.length} shown)`, ...filtered.map(formatFilteredLine)];
      for (const chunk of chunkLines(lines)) ok = (await send(chunk)) && ok;
    }
  }

  if (ok && tracked && matched.length) {
    const { error } = await sb.from('applications')
      .update({ notified_at: new Date().toISOString() } as any)
      .in('id', matched.map(j => j.id).filter(Boolean) as string[]);
    if (error) console.warn('[digest] could not mark jobs notified:', error.message);
  }

  console.log(ok ? `[digest] Sent summary + ${matched.length} matched job(s).` : '[digest] Some messages FAILED to send.');
  process.exitCode = ok ? 0 : 1;
}

if (require.main === module) {
  main().catch(err => {
    console.error('[digest] Fatal:', err?.message ?? err);
    process.exit(1);
  });
}
