import fs from 'fs';
import path from 'path';

// Shared deterministic quality gate.
// Returns a filter reason if the job should be gated before Gemini, else null.
const SENIOR = /\b(staff|principal|lead|director|vp|vice president|head|manager)\b/i;
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

/** Largest years-of-experience figure mentioned in the text ("5+" counts as 5.5). */
function maxYears(t: string): number {
  const re = /(\d+)\s*(\+)?\s*(?:years|yrs)/gi;
  let m: RegExpExecArray | null;
  let mx = 0;
  while ((m = re.exec(t || '')) !== null) {
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

  const targetKeywords = getTargetKeywords().map(k => k.toLowerCase());
  const hasTargetKeyword = (t: string) => {
    const l = (t || '').toLowerCase();
    // Match either the full keyword or key parts (e.g. "ai" matches "ai engineer")
    return targetKeywords.some(k => l.includes(k) || k.includes(l));
  };

  if (!hasTargetKeyword(role || '') && !hasTargetKeyword(jdText || '')) {
    return 'non-target (no matching target keywords)';
  }

  return null;
}
