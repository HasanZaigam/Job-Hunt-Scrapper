import fs from 'fs';
import path from 'path';
import { CORE_AI_KEYWORDS, matchesKeywords } from './filters';

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

/**
 * Largest years-of-experience REQUIREMENT in the text ("5+" counts as 5.5).
 * Only counts a "N years" figure when experience-related wording appears in the
 * same sentence-sized window around it. The old version took the biggest "N years"
 * anywhere, so company text such as "founded 10 years ago" wrongly rejected jobs.
 */
export function maxYears(t: string): number {
  const text = t || '';
  const re = /(\d+)\s*(\+)?\s*(?:years|yrs)/gi;
  let m: RegExpExecArray | null;
  let mx = 0;
  while ((m = re.exec(text)) !== null) {
    const start = Math.max(0, m.index - 70);
    const end = Math.min(text.length, m.index + m[0].length + 70);
    // Stay within the sentence/bullet the figure appears in.
    const window = text.slice(start, end).split(/[.!?\n\r•]/).find(seg => seg.includes(m![0])) ?? '';
    if (!EXPERIENCE_CONTEXT.test(window)) continue;
    const eff = parseInt(m[1], 10) + (m[2] ? 0.5 : 0);
    if (eff > mx) mx = eff;
  }
  return mx;
}

/** Returns a filter reason string if the job should be gated, else null. */
export function gateReason(role: string, jdText: string): string | null {
  if (SENIOR.test(role || '')) return 'senior-only title';
  if (maxYears(jdText || '') > 5) return 'requires >5y experience';
  if ((jdText || '').length < MIN_JD) return 'thin description';
  if (SPAM.test(jdText || '') || SPAM.test(role || '')) return 'spam';

  // Whole-word match on the profile's target keywords plus the core AI/ML terms.
  // (The old substring check matched "ai" inside "email"/"retail", and its
  // reversed `k.includes(text)` test passed every job that had an empty title.)
  const keywords = [...getTargetKeywords(), ...CORE_AI_KEYWORDS];
  if (!matchesKeywords(role || '', keywords) && !matchesKeywords(jdText || '', keywords)) {
    return 'non-target (no matching target keywords)';
  }

  return null;
}
