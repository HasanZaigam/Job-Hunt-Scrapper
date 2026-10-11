import type { CompensationResult } from '../types';

// Never fabricates a number. Reads only the ATS-supplied salary_range field
// verbatim — never infers a figure from JD prose ("competitive salary",
// "market rate"), and never estimates actual pay.
//
// 50 means "neutral because information is unavailable" — not "average
// salary" and not "assume acceptable." It is used for BOTH not_disclosed
// and invalid, but the two are recorded as distinct statuses so an
// analyst can tell "employer said nothing" apart from "employer wrote
// something, but it wasn't an actual figure."
//
// Unlike the earlier version, this dimension's weight is now fixed and is
// NEVER redistributed onto the other three dimensions — the caller
// (opportunity-score.ts) always applies compensation's full weight,
// because a score is always present here.

const NON_INFORMATIVE_PLACEHOLDERS = /^(n\/a|na|tbd|competitive|market rate|undisclosed|negotiable|doe|depends on experience)$/i;

export function computeCompensation(salaryRange: string | null | undefined): CompensationResult {
  const raw = (salaryRange || '').trim();

  if (!raw) {
    return {
      status: 'not_disclosed',
      raw: null,
      score: 50,
      reason: 'no compensation field on this job — neutral score, information unavailable (not an assumed average)',
    };
  }

  if (NON_INFORMATIVE_PLACEHOLDERS.test(raw) || !/\d/.test(raw)) {
    return {
      status: 'invalid',
      raw,
      score: 50,
      reason: `compensation field present but not an actual figure ("${raw}") — neutral score, information unavailable`,
    };
  }

  return {
    status: 'disclosed',
    raw,
    score: 70,
    reason: 'compensation disclosed by the employer; flat presence score — no candidate target-salary threshold is configured yet to score it beyond that',
  };
}
