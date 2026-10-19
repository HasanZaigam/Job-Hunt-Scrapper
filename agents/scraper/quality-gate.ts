import fs from 'fs';
import path from 'path';
import { CORE_AI_KEYWORDS, matchesKeywords } from './filters';
import { skipReason } from './search-profile';

// Shared deterministic quality gate.
// Returns a filter reason if the job should be gated before Gemini, else null.
const SENIOR = /\b(senior|sr|staff|principal|lead|architect|distinguished|director|vp|vice president|head|manager)\b/i;
const SPAM = /(unpaid|commission only|mlm|pyramid)/i;
const MIN_JD = 300;

function getTargetKeywords(): string[] {
  try {
    const p = path.resolve(__dirname, '../resume-generator/base-resume.json');
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (data.target_keywords && Array.isArray(data.target_keywords)) {
        return data.target_keywords;
      }
    }
  } catch (err) {
    console.error('[quality-gate] Error reading target keywords from base-resume.json:', err);
  }
  // Default fallback keywords (AI/ML)
  return ['ai', 'ml', 'machine learning', 'genai', 'llm', 'nlp', 'computer vision', 'data scientist', 'mlops', 'ai engineer', 'research scientist', 'deep learning', 'generative', 'foundation model', 'data science'];
}

// Context words that mean "N years" is about the candidate's experience, as
// opposed to company marketing ("founded 10 years ago", "20 years in business").
const EXPERIENCE_CONTEXT = /\b(experience|experienced|expertise|exp\b|hands[- ]on|background|track record|proven|working with|work in|professional|industry)\b/i;

/** Experience (in years) a job asks for at or above which it is skipped. */
export const MAX_YEARS_ALLOWED = 4;

/**
 * Years of experience a JD REQUIRES: the highest *minimum* it states ("5+" counts as
 * 5.5; a range like "3-5 years" asks for 3). Only counts figures that appear next to
 * experience wording, so company text such as "founded 10 years ago" is ignored.
 */
export function requiredYears(t: string): number {
  const text = t || '';
  const re = /(?:(\d+)\s*(?:-|–|to)\s*)?(\d+)\s*(\+)?\s*(?:years?|yrs?)/gi;
  let m: RegExpExecArray | null;
  let mx = 0;
  while ((m = re.exec(text)) !== null) {
    const start = Math.max(0, m.index - 70);
    const end = Math.min(text.length, m.index + m[0].length + 70);
    // Stay within the sentence/bullet the figure appears in.
    const window = text.slice(start, end).split(/[.!?\n\r•]/).find(seg => seg.includes(m![0])) ?? '';
    if (!EXPERIENCE_CONTEXT.test(window)) continue;
    const eff = m[1] ? parseInt(m[1], 10) : parseInt(m[2], 10) + (m[3] ? 0.5 : 0);
    if (eff > mx) mx = eff;
  }
  return mx;
}

/** Kept for older callers/tests: same as requiredYears. */
export const maxYears = requiredYears;

/** Returns a filter reason string if the job should be gated, else null. */
export function gateReason(role: string, jdText: string, extra: { company?: string | null; salaryRange?: string | null } = {}): string | null {
  const years = requiredYears(jdText || '');
  // A "Senior"/"Lead"/etc title is normally a hard gate, but titles lie more
  // than JD text does — if the JD itself proves the role only asks for ≤3
  // years, the title alone shouldn't override that. No years stated at all
  // (years === 0) keeps the conservative default: gate on the title, since
  // there's no counter-evidence. Audited against 20 historical rejections
  // (2026-10-19): 18/20 genuinely needed 5-15y; 2/20 were ≤3y false positives.
  if (SENIOR.test(role || '') && !(years > 0 && years <= 3)) return 'senior-only title';
  if (years >= MAX_YEARS_ALLOWED) return `requires ${MAX_YEARS_ALLOWED}+ years experience`;
  if ((jdText || '').length < MIN_JD) return 'thin description';
  if (SPAM.test(jdText || '') || SPAM.test(role || '')) return 'spam';

  // Candidate preferences: research / data-scientist / MLOps / Databricks / MERN / strong DSA / fixed US-hours.
  const skip = skipReason({ role, jdText, company: extra.company, salaryRange: extra.salaryRange });
  if (skip) return skip;

  // Whole-word match on the profile's target keywords plus the core AI/ML terms.
  // (The old substring check matched "ai" inside "email"/"retail", and its
  // reversed `k.includes(text)` test passed every job that had an empty title.)
  const keywords = [...getTargetKeywords(), ...CORE_AI_KEYWORDS];
  if (!matchesKeywords(role || '', keywords) && !matchesKeywords(jdText || '', keywords)) {
    return 'non-target (no matching target keywords)';
  }

  return null;
}
