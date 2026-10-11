import type { LocationEligibility, LocationGateResult, LocationProfile, RemoteFlag, LocationEvidence, LocationCategory } from '../types';

// Location eligibility, hardened per CTO correction (P0 #1): "remote" alone
// is not enough information. The candidate's actual requirement is "remote
// work possible from India, plus onsite/hybrid India" — a remote job
// explicitly restricted to another country/region must be rejected exactly
// like an onsite job elsewhere, even though both are technically "remote".

const INDIA_CITIES = [
  'noida', 'delhi', 'new delhi', 'gurgaon', 'gurugram', 'bengaluru', 'bangalore',
  'mumbai', 'pune', 'hyderabad', 'chennai', 'kolkata', 'ahmedabad',
];

// Single-country hints, checked in priority order (India first, since an
// India city/word should always win over a generic "Asia" mention).
const COUNTRY_HINTS: [RegExp, string][] = [
  [/\bindia\b/i, 'in'],
  [new RegExp(`\\b(${INDIA_CITIES.join('|')})\\b`, 'i'), 'in'],
  // Bare "US"/"U.S." is safe to match here (word-boundary only) because
  // this function only ever runs on the short location field, never on JD
  // body text where "us" the pronoun could appear.
  [/\b(united states|usa|u\.s\.a?\.?|us)\b/i, 'us'],
  [/\b(united kingdom|uk|u\.k\.)\b/i, 'gb'],
  [/\bcanada\b/i, 'ca'],
];

// A small curated set of EU-country/region words. Deliberately not
// exhaustive — the goal is "recognize the common cases," not build a full
// gazetteer.
const EU_HINT = /\b(europe|european union|\beu\b|germany|france|spain|italy|netherlands|ireland|portugal|poland)\b/i;
const ASIA_HINT = /\b(asia|apac)\b/i; // generic Asia mention NOT already resolved to India above
const GLOBAL_HINT = /\b(worldwide|global|anywhere|international)\b/i;

function norm(s: string): string {
  return (s || '').toLowerCase().trim();
}

function detectCountry(raw: string): { code: string | null; matchedHint: string | null } {
  for (const [re, code] of COUNTRY_HINTS) {
    const m = re.exec(raw);
    if (m) return { code, matchedHint: m[0] };
  }
  return { code: null, matchedHint: null };
}

function detectCity(raw: string): string | null {
  const l = norm(raw);
  for (const city of INDIA_CITIES) {
    if (l.includes(city)) return city;
  }
  return null;
}

// Strips the remote/hybrid/onsite keyword itself and common filler words
///separators, to see whether any substantive qualifier text remains. An
// empty result means a truly bare "Remote" with no restriction stated at
// all; non-empty, unrecognized text means a restriction was likely stated
// but this parser can't identify it — that's the "ambiguous remote
// wording" case, not an invitation to guess.
function extractResidualQualifier(raw: string): string {
  let s = norm(raw);
  s = s.replace(/\b(fully|100%|remote|hybrid|onsite|on-site|in[- ]office|role|position|based)\b/g, '');
  s = s.replace(/[-–()\/,]/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

export function normalizeLocation(rawLocation: string): { location: LocationEligibility; countryHint: string | null; qualifier: string | null } {
  const raw = rawLocation || '';
  const l = norm(raw);

  const hasHybrid = /\bhybrid\b/.test(l);
  const hasOnsite = /\b(onsite|on-site|in[- ]office)\b/.test(l);
  const hasRemoteWord = /\bremote\b/.test(l);
  const hasGlobalWord = GLOBAL_HINT.test(l);
  const hasRemote = (hasRemoteWord || hasGlobalWord) && !hasHybrid;

  const { code: country, matchedHint: countryHint } = detectCountry(raw);
  const city = detectCity(raw);
  const isAsiaGeneric = !country && ASIA_HINT.test(l);
  const isEu = !country && EU_HINT.test(l);

  let remote_flag: RemoteFlag;
  let category: LocationCategory;
  let qualifier: string | null = null;

  if (hasHybrid) {
    remote_flag = 'hybrid';
    category = country === 'in' ? 'hybrid_india' : (country || city) ? 'hybrid_non_india' : 'ambiguous';
  } else if (hasRemote) {
    remote_flag = 'remote';
    const residual = extractResidualQualifier(raw);
    qualifier = residual || null;

    if (hasGlobalWord) {
      // An explicit "worldwide/global" word always means unrestricted,
      // even if India also happens to be mentioned by name.
      category = country === 'in' ? 'remote_india' : 'remote_global';
    } else if (country === 'in') {
      category = 'remote_india';
    } else if (isAsiaGeneric) {
      // "Remote - Asia" with no explicit India mention: eligible only if
      // India is explicitly included — this parser found no such mention,
      // so it's ambiguous rather than assumed-eligible.
      category = 'ambiguous';
    } else if (country === 'us') {
      category = 'remote_us_only';
    } else if (country === 'ca') {
      category = 'remote_canada_only';
    } else if (country === 'gb') {
      category = 'remote_uk_only';
    } else if (isEu) {
      category = 'remote_eu_only';
    } else if (residual === '') {
      // Bare "Remote" / "Fully Remote" with nothing else — no restriction
      // stated at all.
      category = 'remote_global';
    } else {
      // Remote, with some qualifier text present, but this parser doesn't
      // recognize it as any known country/region — don't guess.
      category = 'ambiguous';
    }
  } else if (hasOnsite || !!(country || city)) {
    // Onsite explicit, OR a bare "City, Country" string with no
    // remote/hybrid qualifier at all — the common case for an onsite
    // listing (most ATS location fields never literally say "onsite").
    remote_flag = 'onsite';
    category = country === 'in' ? 'onsite_india' : (country || city) ? 'onsite_non_india' : 'ambiguous';
  } else {
    remote_flag = 'unspecified';
    category = 'ambiguous';
  }

  return {
    location: { raw_location: raw, country, city, remote_flag, category },
    countryHint,
    qualifier,
  };
}

const ELIGIBLE_CATEGORIES: LocationCategory[] = ['remote_india', 'remote_global', 'onsite_india', 'hybrid_india'];

export function evaluateLocationGate(rawLocation: string, profile: LocationProfile): LocationGateResult {
  const { location, countryHint, qualifier } = normalizeLocation(rawLocation);

  const evidence: LocationEvidence = {
    matched_country_hint: countryHint,
    matched_city_hint: location.city,
    matched_onsite_city: location.city,
    matched_qualifier: qualifier,
  };

  if (location.category === 'ambiguous') {
    return {
      location,
      passed: false,
      needs_review: true,
      reason: `location "${location.raw_location}" could not be confidently classified — flagged for manual review, not auto-admitted`,
      evidence,
    };
  }

  if (location.category === 'remote_global' && !profile.remote_ok_from_anywhere) {
    return { location, passed: false, needs_review: false, reason: 'remote with no restriction stated, but candidate is not configured as remote-eligible', evidence };
  }

  if (ELIGIBLE_CATEGORIES.includes(location.category)) {
    // CTO correction: the candidate requirement is "onsite India," not a
    // finite whitelist of cities. Any onsite/hybrid India location is
    // eligible nationwide — the specific city is preserved in evidence
    // (matched_onsite_city) for later ranking/filtering, but it is no
    // longer a hard eligibility gate. A previously-narrow onsite_cities
    // list had rejected genuine India-based roles (e.g. Chennai, Mumbai)
    // purely for not appearing on that list.
    return {
      location,
      passed: true,
      needs_review: false,
      reason: location.city
        ? `${location.category} in ${location.city} — eligible (India, nationwide)`
        : `${location.category} — eligible`,
      evidence,
    };
  }

  // Every remaining category (remote_us_only, remote_canada_only,
  // remote_uk_only, remote_eu_only, remote_other_country_only,
  // onsite_non_india, hybrid_non_india) is a clear, confident reject —
  // restricted to a place the candidate isn't in and isn't remote-eligible
  // for.
  return {
    location,
    passed: false,
    needs_review: false,
    reason: `${location.category} — not eligible for an India-based candidate`,
    evidence,
  };
}
