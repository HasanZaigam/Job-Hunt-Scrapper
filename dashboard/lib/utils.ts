import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names, de-duplicating conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The matcher stores match_justification inconsistently: sometimes a JSON array
 * string (e.g. '["point a","point b"]'), sometimes newline/bullet text, sometimes
 * a plain sentence. Normalise any of these into a clean list of bullet points.
 */
export function parseJustification(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const text = raw.trim();
  if (!text) return [];

  // Try JSON array first.
  if (text.startsWith('[')) {
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) {
        return arr.map(s => String(s).trim()).filter(Boolean);
      }
    } catch {
      /* fall through */
    }
  }

  // Split on newlines or leading bullet markers.
  const lines = text
    .split(/\r?\n|(?:^|\s)[•\-*]\s+/)
    .map(s => s.replace(/^["'\s]+|["'\s]+$/g, '').trim())
    .filter(Boolean);

  return lines.length > 0 ? lines : [text];
}

export type LocationTrack = 'global_remote' | 'india_local';

/**
 * Every row in the DB already passed scrape-time eligibility (remote open to
 * India/worldwide, or onsite/hybrid India — nationwide, not a city
 * whitelist), so there's no new "eligible or not" decision to make here. This
 * only splits the already-eligible set into two VIEWS: jobs you can do from
 * anywhere ("global_remote") vs jobs that require being physically in India
 * ("india_local" — onsite or hybrid). No new DB column; derived from the
 * existing free-text `location` string.
 */
export function locationTrack(location: string | null | undefined): LocationTrack {
  const l = (location || '').toLowerCase();
  const isHybridOrOnsite = /\bhybrid\b/.test(l) || (!/\bremote\b/.test(l) && !/\b(worldwide|global|anywhere)\b/.test(l));
  return isHybridOrOnsite ? 'india_local' : 'global_remote';
}
