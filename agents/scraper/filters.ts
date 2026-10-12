// Shared, deterministic scrape-time filters (location + job title).
//
// Both used to be naive substring checks, which let wrong jobs through:
//   - "Remote - US" matched the target "remote"; "Indianapolis" matched "india"
//   - the title keywords "AI"/"ML" matched inside "Email", "HTML", "Retail"…
// These helpers match whole words and reuse the v2 matcher's location parser so
// scraping and matching agree on what "eligible for an India-based candidate" means.

import { normalizeLocation } from '../matcher/v2/gates/location';
import type { LocationCategory } from '../matcher/v2/types';

// ---------------------------------------------------------------- locations

const ELIGIBLE: ReadonlySet<LocationCategory> = new Set<LocationCategory>([
  'remote_india', 'remote_global', 'onsite_india', 'hybrid_india',
]);

// Indian states / cities the v2 parser doesn't know by name. Many ATS location
// fields read "Pune, Maharashtra" or "Karnataka" without the word "India".
const INDIA_EXTRA = new RegExp(
  '\\b(' + [
    'karnataka', 'tamil nadu', 'maharashtra', 'telangana', 'haryana', 'uttar pradesh',
    'gujarat', 'kerala', 'rajasthan', 'punjab', 'west bengal', 'andhra pradesh',
    'jaipur', 'chandigarh', 'kochi', 'coimbatore', 'indore', 'nagpur', 'lucknow',
    'surat', 'vadodara', 'bhubaneswar', 'thiruvananthapuram', 'mysuru', 'mysore',
    'visakhapatnam', 'patna', 'ghaziabad', 'faridabad', 'greater noida',
  ].join('|') + ')\\b',
  'i'
);

const ASIA_REMOTE = /\b(asia|apac|asia[- ]pacific)\b/i;

/**
 * True when a job's location string is worth scraping for an India-based
 * candidate: remote open to India/worldwide, or onsite/hybrid in India.
 * Remote roles restricted to another country/region (US, UK, EU, Canada…) and
 * onsite roles elsewhere are rejected. Unparseable locations are rejected,
 * except "Remote - Asia/APAC" which is kept (India is usually included).
 */
export function isEligibleLocation(rawLocation: string): boolean {
  const raw = rawLocation ?? '';
  const { location } = normalizeLocation(raw);
  if (ELIGIBLE.has(location.category)) return true;
  if (location.category === 'ambiguous') {
    if (INDIA_EXTRA.test(raw)) return true;
    if (location.remote_flag === 'remote' && ASIA_REMOTE.test(raw)) return true;
  }
  return false;
}

// -------------------------------------------------------------------- titles

/** Default AI/ML title keywords (same terms as the old per-fetcher lists). */
export const CORE_AI_KEYWORDS = [
  'AI', 'ML', 'Machine Learning', 'GenAI', 'LLM', 'NLP',
  'Computer Vision', 'Data Scientist', 'MLOps', 'AI Engineer',
  'Research Scientist', 'Deep Learning', 'Generative', 'Foundation Model',
  'Data Science',
  // Candidate's target titles that carry no "AI"/"ML" token on their own:
  'Agentic', 'Applied AI', 'AI Automation', 'Intelligent Automation', 'Prompt Engineer',
  'RAG', 'Conversational AI', 'Voice AI',
];

const regexCache = new Map<string, RegExp>();

/** Whole-word / whole-phrase regex for a keyword ("LLM" also matches "LLMs"). */
function keywordRegex(keyword: string): RegExp {
  let re = regexCache.get(keyword);
  if (!re) {
    const body = keyword
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '[\\s-]+');
    re = new RegExp(`(?<![a-z0-9])${body}s?(?![a-z0-9])`, 'i');
    regexCache.set(keyword, re);
  }
  return re;
}

/** True if `text` contains any keyword as a whole word/phrase (case-insensitive). */
export function matchesKeywords(text: string, keywords: readonly string[]): boolean {
  const t = text ?? '';
  if (!t) return false;
  return keywords.some(k => keywordRegex(k).test(t));
}

/** Title check used by the Greenhouse / Lever / Ashby fetchers. */
export function matchesAiKeywords(title: string): boolean {
  return matchesKeywords(title, CORE_AI_KEYWORDS);
}
