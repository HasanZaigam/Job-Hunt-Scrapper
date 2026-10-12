// The candidate's job-search preferences, in one place (edit here to retune).
//
//  TITLES  — searched/ranked in this order:
//    1. AI Engineer (LLM / Agents)      4. LLM Application Developer
//    2. Generative AI Developer         5. Associate AI Python Engineer
//    3. AI Automation Engineer
//
//  SKIP    — roles asking for 4+ years or "strong DSA"; ML research, data scientist,
//            MLOps-heavy or Databricks roles; pure MERN roles; fixed US-hour shifts
//            unless the pay is clearly worth it.
//
// Everything is deterministic (no AI call) so it can run at scrape time and in the
// matcher before any Gemini quota is spent.

import { matchesAiKeywords } from './filters';

// ------------------------------------------------------------------- titles

export interface TitleRank { rank: number; label: string }

const TITLE_RULES: { rank: number; label: string; patterns: RegExp[]; test?: (title: string) => boolean }[] = [
  {
    rank: 1, label: 'AI Engineer (LLM / Agents)',
    patterns: [
      /\bai\s+(software\s+)?engineer/i,
      /\bllm\s+(platform\s+)?engineer/i,
      /\bapplied\s+ai\s+engineer/i,
      /\b(agentic|ai[- ]agents?|agents?)\b[\w\s\-/,&]{0,25}\b(engineer|developer)\b/i,
    ],
  },
  {
    rank: 2, label: 'Generative AI Developer',
    patterns: [
      /\bgen(erative)?[\s-]*ai\s+(developer|engineer|software)/i,
      /\bai\s+developer\b/i,
    ],
  },
  {
    rank: 3, label: 'AI Automation Engineer',
    patterns: [/\b(ai|intelligent|agentic|llm)\s+automation\b/i],
    // plain "Automation Engineer" only counts when the title also has AI context
    test: t => /\bautomation\s+(engineer|developer)\b/i.test(t) && /\b(ai|llm|agent\w*)\b/i.test(t),
  },
  {
    rank: 4, label: 'LLM Application Developer',
    patterns: [
      /\bllm\s+(application|app|apps|applications)\s+(developer|engineer)/i,
      /\bllm\s+developer/i,
      /\brag\s+(engineer|developer)/i,
      /\bprompt\s+engineer/i,
    ],
  },
  {
    rank: 5, label: 'Associate AI Python Engineer',
    patterns: [
      /\b(associate|junior|jr\.?|graduate|entry[- ]level)\b[^|]{0,30}\b(ai|ml|llm|python|machine learning)\b[^|]{0,25}\b(engineer|developer)/i,
      /\bpython\b[^|]{0,15}\bai\b[^|]{0,15}\b(engineer|developer)/i,
      /\bai\b[^|]{0,15}\bpython\b[^|]{0,15}\b(engineer|developer)/i,
    ],
  },
];

/** Rank used for AI/ML titles outside the five preferred ones (e.g. "Machine Learning Engineer"). */
export const FALLBACK_RANK = 6;

/**
 * Which preferred title (1-5) a job title is, or FALLBACK_RANK for other AI/ML titles,
 * or null when it isn't an AI/ML title at all. Lowest rank wins when several match.
 */
export function titleRank(role: string): TitleRank | null {
  const t = role || '';
  for (const rule of TITLE_RULES) {
    if (rule.patterns.some(p => p.test(t)) || rule.test?.(t)) return { rank: rule.rank, label: rule.label };
  }
  return matchesAiKeywords(t) ? { rank: FALLBACK_RANK, label: 'Other AI/ML' } : null;
}

// --------------------------------------------------------------- skip rules

/** "Clearly worth it" pay for a fixed US-hours shift: ~5x the current ₹30k/month. Tune here. */
export const US_HOURS_MIN_MONTHLY_INR = 150_000;

// Approximate FX to INR, only used to compare advertised pay with the threshold above.
const FX_TO_INR: Record<string, number> = { INR: 1, USD: 88, EUR: 95, GBP: 110 };

const TITLE_SKIPS: [RegExp, string][] = [
  [/\b(artist|designer|illustrator|animator|writer|copywriter|editor|translator|content creator|photographer|videographer|annotator|labeler|labeller|rater|evaluator|tutor|trainer)\b/i, 'not an engineering role (creative / AI-training)'],
  [/\bdata\s+scien(tist|ce)/i, 'data scientist role'],
  [/\b(research\s+(scientist|engineer|fellow|intern|associate)|researcher|applied\s+scientist|\bscientist\b|ml\s+research|ai\s+research)\b/i, 'ML research / scientist role'],
  [/\bmlops\b|\bml\s*platform\b|\bmachine\s+learning\s+platform\b|\bmodel\s*ops\b|\bml\s+infrastructure\b/i, 'MLOps role'],
];

const MLOPS_TERMS = ['mlops', 'mlflow', 'kubeflow', 'feature store', 'model registry', 'airflow', 'model monitoring', 'data drift', 'sagemaker', 'vertex ai'];

const DSA_RE = /\bdsa\b|\bleetcode\b|competitive programming|(strong|solid|excellent|deep|sound|good|expert)\s+(knowledge of\s+|understanding of\s+|grasp of\s+|command of\s+|foundation in\s+|skills in\s+)?(data\s+structures|algorithms)/i;

const AI_FOCUS_RE = /\b(llms?|generative ai|genai|rag|agents?|agentic|openai|langchain|langgraph|prompt(ing)?|gemini|claude)\b/gi;
const MERN_PARTS = ['mongodb', 'express', 'react', 'node'];

const US_HOURS_RES: RegExp[] = [
  /\b(night|graveyard) shift\b/i,
  /\bus\s+(time\s*zone|hours|business hours|working hours|shifts?)\b/i,
  /\b(eastern|pacific|central|mountain)\s+(standard\s+)?(time|hours)\b/i,
  /\b(est|pst|cst|edt|pdt)\s+(hours|shift|working hours|business hours|time\s*zone)\b/i,
  /\b\d{1,2}\s*(?::\d{2})?\s*(am|pm)\s*(?:-|–|to)\s*\d{1,2}\s*(?::\d{2})?\s*(am|pm)\s*(est|pst|cst|edt|pdt|et|pt|ct|us)\b/i,
  /(must|required|mandatory|need to)[^.\n]{0,50}(overlap|be available|work)[^.\n]{0,40}\b(us|est|pst|eastern|pacific|cst)\b/i,
];

function count(haystack: string, re: RegExp): number {
  return (haystack.match(re) || []).length;
}

/**
 * Best-effort advertised pay as INR per month (LOWER bound, so "clearly worth it" is
 * conservative). Returns null when no usable figure is found or it is per-task.
 */
export function monthlyInr(text: string): number | null {
  const t = String(text ?? '');
  if (!t || /per task|\/\s?task/i.test(t)) return null;

  const cur = /₹|\binr\b|\brs\.?\b|\blpa\b|lakh/i.test(t) ? 'INR'
    : /€|\beur\b/i.test(t) ? 'EUR'
    : /£|\bgbp\b/i.test(t) ? 'GBP'
    : /\$|\busd\b/i.test(t) ? 'USD' : null;
  if (!cur) return null;

  const m = /(\d[\d,]*(?:\.\d+)?)\s*(k|lpa|lakhs?|lacs?)?\s*(?:-|–|to)?\s*(\d[\d,]*(?:\.\d+)?)?\s*(k|lpa|lakhs?|lacs?)?/i.exec(t);
  if (!m) return null;
  const unit = (m[2] || m[4] || '').toLowerCase();
  let value = parseFloat(m[1].replace(/,/g, ''));
  if (!isFinite(value)) return null;
  if (unit === 'k') value *= 1_000;
  else if (unit === 'lpa' || unit.startsWith('lakh') || unit.startsWith('lac')) value *= 100_000;

  let monthly: number;
  if (/\/\s?(hr|hour)|per hour|hourly/i.test(t)) monthly = value * 160;
  else if (/\/\s?(mo|month)|per month|monthly/i.test(t)) monthly = value;
  else if (unit.startsWith('lakh') || unit === 'lpa' || /\blpa\b|per annum|\/\s?(yr|year)|annual|per year/i.test(t) || value >= 20_000) monthly = value / 12;
  else monthly = value;

  return monthly * FX_TO_INR[cur];
}

export interface SkipInput { role: string; jdText: string; company?: string | null; salaryRange?: string | null }

/** Reason to skip a job under the candidate's preferences, or null to keep it. */
export function skipReason({ role, jdText, company, salaryRange }: SkipInput): string | null {
  const title = role || '';
  const body = jdText || '';
  const lower = body.toLowerCase();

  for (const [re, why] of TITLE_SKIPS) if (re.test(title)) return why;

  if (/databricks/i.test(company || '') || /databricks/i.test(title) || count(lower, /databricks/g) >= 2) return 'Databricks role';

  const mlops = MLOPS_TERMS.filter(term => lower.includes(term)).length;
  if (mlops >= 3) return 'MLOps-heavy';

  if (DSA_RE.test(body)) return 'requires strong DSA';

  const mernHits = MERN_PARTS.filter(p => lower.includes(p)).length;
  const aiHits = count(body, AI_FOCUS_RE);
  if (/\bmern\b/i.test(title) || (mernHits >= 3 && aiHits < 2)) return 'pure MERN role';

  if (US_HOURS_RES.some(re => re.test(title) || re.test(body))) {
    const pay = monthlyInr(salaryRange || '') ?? monthlyInr(/[$₹€£][^.\n]{0,40}/.exec(body)?.[0] ?? '');
    if (pay === null || pay < US_HOURS_MIN_MONTHLY_INR) {
      return pay === null ? 'fixed US-hour shift (pay not stated)' : 'fixed US-hour shift (pay not high enough)';
    }
  }
  return null;
}
