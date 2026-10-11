import type { ExperienceBand, ExperienceRequirement, ExperienceGateResult, ExperiencePolicy, ExperienceEvidence, ExperienceTier } from '../types';

// Wider than v1's quality-gate.ts maxYears() regex: v1 only matched literal
// "N years"/"N yrs" and had no title-based fallback, so a job with no
// numeric years in the JD body (e.g. a "Staff Engineer" JD that only ever
// says "extensive experience") silently passed the >5y check regardless of
// actual seniority.
//
// CTO correction (P1 #4): a JD asking for 5 years must NEVER pass merely
// because a band-tolerance window happened to cover it. This gate now
// applies a direct, configurable years-based policy — band is still
// computed for display/audit purposes, but the pass/fail decision is made
// on the actual number.

const SPELLED_YEARS: Record<string, number> = {
  'a year': 1, 'one year': 1,
  'a couple of years': 2, 'two years': 2,
  'a few years': 3, 'three years': 3,
  'several years': 5,
  'half a decade': 5,
  'a decade': 10, 'decade': 10,
};

function bandForYears(years: number): ExperienceBand {
  if (years < 2) return 'entry_0_2';
  if (years < 4) return 'junior_2_4';
  if (years < 6) return 'mid_4_6';
  if (years < 9) return 'senior_6_9';
  return 'staff_plus_9';
}

// Title keywords used only as a fallback when the JD body gives no numeric
// signal at all — never overrides an explicit number found in the text.
// Each hint also carries an approximate effective-years number, so a
// title-inferred band still goes through the exact same tiered policy as
// an explicitly-stated number (e.g. "Staff Engineer" behaves like "10
// years" for policy purposes, not just "a high band").
const TITLE_BAND_HINTS: [RegExp, ExperienceBand, number][] = [
  [/\b(staff|principal|director|vp|vice president|head of)\b/i, 'staff_plus_9', 10],
  [/\b(senior|sr\.?|lead)\b/i, 'senior_6_9', 7],
  [/\b(mid[- ]?level|ii|2)\b/i, 'mid_4_6', 5],
  [/\b(junior|jr\.?|associate|entry[- ]?level|graduate|i\b)\b/i, 'entry_0_2', 1],
];

interface ExplicitYears {
  min: number;
  max: number | null;
  source: 'explicit_range' | 'single_number';
  matchedPhrase: string;
  yearsFound: number[];
}

function parseExplicitYears(text: string): ExplicitYears | null {
  const t = text || '';
  let best: ExplicitYears | null = null;

  // Ranges: "3-5 years", "3 to 5 years", "8–10 yrs"
  const rangeRe = /(\d+)\s*(?:-|–|to)\s*(\d+)\s*\+?\s*(?:years?|yrs?)/gi;
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(t)) !== null) {
    const min = parseInt(m[1], 10);
    const max = parseInt(m[2], 10);
    if (!best || max > (best.max ?? best.min)) {
      best = { min, max, source: 'explicit_range', matchedPhrase: m[0], yearsFound: [min, max] };
    }
  }
  if (best) return best;

  // Single figures: "5+ years", "5 years", "minimum 7 years"
  const singleRe = /(\d+)\s*(\+)?\s*(?:years?|yrs?)/gi;
  let mx = 0;
  let hasPlus = false;
  let matchedPhrase = '';
  while ((m = singleRe.exec(t)) !== null) {
    const n = parseInt(m[1], 10);
    if (n > mx) { mx = n; hasPlus = !!m[2]; matchedPhrase = m[0]; }
  }
  if (mx > 0) return { min: mx, max: hasPlus ? null : mx, source: 'single_number', matchedPhrase, yearsFound: [mx] };

  // Spelled-out durations: "a decade of experience"
  const lower = t.toLowerCase();
  for (const [phrase, years] of Object.entries(SPELLED_YEARS)) {
    if (lower.includes(phrase)) {
      if (!best || years > best.min) {
        best = { min: years, max: null, source: 'single_number', matchedPhrase: phrase, yearsFound: [years] };
      }
    }
  }
  return best;
}

export function classifyExperienceRequirement(
  role: string,
  jdText: string
): { requirement: ExperienceRequirement; evidence: ExperienceEvidence } {
  const explicit = parseExplicitYears(jdText || '');
  if (explicit) {
    const effective = explicit.max ?? explicit.min;
    return {
      requirement: {
        min_years: explicit.min,
        max_years: explicit.max,
        band: bandForYears(effective),
        source: explicit.source,
      },
      evidence: { matched_phrase: explicit.matchedPhrase, years_found: explicit.yearsFound, effective_years: effective },
    };
  }

  // No numeric signal in the JD body — fall back to title keywords.
  for (const [re, band, effectiveYears] of TITLE_BAND_HINTS) {
    const match = re.exec(role || '');
    if (match) {
      return {
        requirement: { min_years: null, max_years: null, band, source: 'seniority_title_inferred' },
        evidence: { matched_phrase: match[0], years_found: [], effective_years: effectiveYears },
      };
    }
  }

  return {
    requirement: { min_years: null, max_years: null, band: 'unknown', source: 'unknown' },
    evidence: { matched_phrase: null, years_found: [], effective_years: null },
  };
}

function classifyTier(effectiveYears: number, policy: ExperiencePolicy): ExperienceTier {
  if (effectiveYears >= policy.hard_reject_min_years) return 'hard_reject';
  if (effectiveYears <= policy.acceptable_max_years) return 'acceptable';
  if (effectiveYears <= policy.ideal_max_years) return 'ideal';
  if (effectiveYears <= policy.stretch_max_years) return 'stretch';
  // Between stretch_max_years and hard_reject_min_years (a gap only exists
  // if the policy numbers leave one, e.g. stretch_max=4, hard_reject_min=6)
  // — treat as stretch (pass, flagged) rather than silently failing.
  return 'stretch';
}

export function evaluateExperienceGate(
  role: string,
  jdText: string,
  policy: ExperiencePolicy
): ExperienceGateResult {
  const { requirement, evidence } = classifyExperienceRequirement(role, jdText);

  if (evidence.effective_years === null) {
    return {
      requirement,
      tier: 'unknown',
      passed: true,
      needs_review: true,
      reason: 'no experience signal in title or JD — passed provisionally, flagged for review',
      evidence,
    };
  }

  const tier = classifyTier(evidence.effective_years, policy);
  const passed = tier !== 'hard_reject';
  const needs_review = tier === 'stretch';

  const reason = {
    acceptable: `${evidence.effective_years} year(s) required — within acceptable range (<= ${policy.acceptable_max_years})`,
    ideal: `${evidence.effective_years} year(s) required — ideal fit (<= ${policy.ideal_max_years})`,
    stretch: `${evidence.effective_years} year(s) required — stretch (<= ${policy.stretch_max_years}), passed but flagged for review`,
    hard_reject: `${evidence.effective_years} year(s) required — hard reject (>= ${policy.hard_reject_min_years}), regardless of band`,
    unknown: 'no experience signal',
  }[tier];

  return { requirement, tier, passed, needs_review, reason, evidence };
}
