import assert from 'assert';
import { normalizeLocation, evaluateLocationGate } from '../location';
import type { LocationProfile } from '../../types';

const PROFILE: LocationProfile = {
  countries: ['in'],
  remote_ok_from_anywhere: true,
  onsite_cities: ['noida', 'delhi', 'bengaluru', 'bangalore', 'gurugram'],
};

type Test = () => void;
const tests: Record<string, Test> = {};

// --- CTO P0 #1 required regression cases ---

tests['REGRESSION: "Remote - US" -> remote_us_only, REJECTED'] = () => {
  const { location } = normalizeLocation('Remote - US');
  assert.strictEqual(location.category, 'remote_us_only');
  const result = evaluateLocationGate('Remote - US', PROFILE);
  assert.strictEqual(result.passed, false);
};

tests['REGRESSION: "Remote - India" -> remote_india, ELIGIBLE'] = () => {
  const { location } = normalizeLocation('Remote - India');
  assert.strictEqual(location.category, 'remote_india');
  const result = evaluateLocationGate('Remote - India', PROFILE);
  assert.strictEqual(result.passed, true);
};

tests['REGRESSION: "Worldwide" -> remote_global, ELIGIBLE (not ambiguous)'] = () => {
  const { location } = normalizeLocation('Worldwide');
  assert.strictEqual(location.category, 'remote_global');
  const result = evaluateLocationGate('Worldwide', PROFILE);
  assert.strictEqual(result.passed, true);
};

tests['REGRESSION: "Remote - Europe" -> remote_eu_only, REJECTED unless India stated'] = () => {
  const { location } = normalizeLocation('Remote - Europe');
  assert.strictEqual(location.category, 'remote_eu_only');
  const result = evaluateLocationGate('Remote - Europe', PROFILE);
  assert.strictEqual(result.passed, false);
};

tests['REGRESSION: "Delhi" -> onsite_india, ELIGIBLE'] = () => {
  const { location } = normalizeLocation('Delhi');
  assert.strictEqual(location.category, 'onsite_india');
  const result = evaluateLocationGate('Delhi', PROFILE);
  assert.strictEqual(result.passed, true);
};

tests['REGRESSION: "Bangalore" -> onsite_india, ELIGIBLE'] = () => {
  const { location } = normalizeLocation('Bangalore');
  assert.strictEqual(location.category, 'onsite_india');
  const result = evaluateLocationGate('Bangalore', PROFILE);
  assert.strictEqual(result.passed, true);
};

tests['REGRESSION: ambiguous remote wording ("Remote - Various") -> ambiguous, needs_review, never silently admitted'] = () => {
  const { location } = normalizeLocation('Remote - Various');
  assert.strictEqual(location.category, 'ambiguous');
  const result = evaluateLocationGate('Remote - Various', PROFILE);
  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.needs_review, true);
};

// --- additional category coverage ---

tests['"Remote - Canada" -> remote_canada_only, rejected'] = () => {
  const result = evaluateLocationGate('Remote - Canada', PROFILE);
  assert.strictEqual(result.location.category, 'remote_canada_only');
  assert.strictEqual(result.passed, false);
};

tests['"Remote - UK" -> remote_uk_only, rejected'] = () => {
  const result = evaluateLocationGate('Remote - UK', PROFILE);
  assert.strictEqual(result.location.category, 'remote_uk_only');
  assert.strictEqual(result.passed, false);
};

tests['"Remote - Asia" with no explicit India mention -> ambiguous, not auto-eligible'] = () => {
  const result = evaluateLocationGate('Remote - Asia', PROFILE);
  assert.strictEqual(result.location.category, 'ambiguous');
  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.needs_review, true);
};

tests['"Remote - Asia (including India)" -> eligible via explicit India mention'] = () => {
  const result = evaluateLocationGate('Remote - Asia (including India)', PROFILE);
  assert.strictEqual(result.location.category, 'remote_india');
  assert.strictEqual(result.passed, true);
};

tests['bare "Remote" with no qualifier at all -> remote_global, eligible'] = () => {
  const result = evaluateLocationGate('Remote', PROFILE);
  assert.strictEqual(result.location.category, 'remote_global');
  assert.strictEqual(result.passed, true);
};

tests['"Fully Remote" (filler words only) -> remote_global, eligible'] = () => {
  const result = evaluateLocationGate('Fully Remote', PROFILE);
  assert.strictEqual(result.location.category, 'remote_global');
  assert.strictEqual(result.passed, true);
};

tests['remote_global rejected when candidate is not configured as remote-eligible'] = () => {
  const result = evaluateLocationGate('Remote', { ...PROFILE, remote_ok_from_anywhere: false });
  assert.strictEqual(result.passed, false);
};

tests['"Bengaluru, India (Hybrid)" -> hybrid_india, eligible'] = () => {
  const result = evaluateLocationGate('Bengaluru, India (Hybrid)', PROFILE);
  assert.strictEqual(result.location.category, 'hybrid_india');
  assert.strictEqual(result.passed, true);
};

tests['"Austin, TX (Hybrid)" -> hybrid_non_india, rejected'] = () => {
  const result = evaluateLocationGate('Austin, TX, USA (Hybrid)', PROFILE);
  assert.strictEqual(result.location.category, 'hybrid_non_india');
  assert.strictEqual(result.passed, false);
};

tests['"San Francisco, CA, USA (Onsite)" -> onsite_non_india, rejected'] = () => {
  const result = evaluateLocationGate('San Francisco, CA, USA (Onsite)', PROFILE);
  assert.strictEqual(result.location.category, 'onsite_non_india');
  assert.strictEqual(result.passed, false);
};

// --- CTO follow-up: onsite India is NATIONWIDE, not a city whitelist ---
// (Chennai/Mumbai must not be false negatives merely for being absent from
// a finite onsite_cities list — the requirement is "onsite India".)

tests['REGRESSION: Bengaluru -> onsite_india, eligible'] = () => {
  const result = evaluateLocationGate('Bengaluru, India', PROFILE);
  assert.strictEqual(result.location.category, 'onsite_india');
  assert.strictEqual(result.passed, true);
};

tests['REGRESSION: Delhi -> onsite_india, eligible'] = () => {
  const result = evaluateLocationGate('Delhi, India', PROFILE);
  assert.strictEqual(result.location.category, 'onsite_india');
  assert.strictEqual(result.passed, true);
};

tests['REGRESSION: Noida -> onsite_india, eligible'] = () => {
  const result = evaluateLocationGate('Noida, India', PROFILE);
  assert.strictEqual(result.location.category, 'onsite_india');
  assert.strictEqual(result.passed, true);
};

tests['REGRESSION: Chennai -> onsite_india, eligible (nationwide, not a city whitelist)'] = () => {
  const result = evaluateLocationGate('Chennai, India', PROFILE);
  assert.strictEqual(result.location.category, 'onsite_india');
  assert.strictEqual(result.passed, true);
};

tests['REGRESSION: Mumbai -> onsite_india, eligible (nationwide, not a city whitelist)'] = () => {
  const result = evaluateLocationGate('Mumbai, India', PROFILE);
  assert.strictEqual(result.location.category, 'onsite_india');
  assert.strictEqual(result.passed, true);
};

tests['REGRESSION: Hyderabad -> onsite_india, eligible'] = () => {
  const result = evaluateLocationGate('Hyderabad, India', PROFILE);
  assert.strictEqual(result.location.category, 'onsite_india');
  assert.strictEqual(result.passed, true);
};

tests['REGRESSION: Pune -> onsite_india, eligible'] = () => {
  const result = evaluateLocationGate('Pune, India', PROFILE);
  assert.strictEqual(result.location.category, 'onsite_india');
  assert.strictEqual(result.passed, true);
};

tests['REGRESSION: US onsite -> rejected'] = () => {
  const result = evaluateLocationGate('Austin, TX, USA (Onsite)', PROFILE);
  assert.strictEqual(result.location.category, 'onsite_non_india');
  assert.strictEqual(result.passed, false);
};

tests['REGRESSION: UK onsite -> rejected'] = () => {
  const result = evaluateLocationGate('London, United Kingdom (Onsite)', PROFILE);
  assert.strictEqual(result.location.category, 'onsite_non_india');
  assert.strictEqual(result.passed, false);
};

tests['normalized city is preserved in evidence even though it no longer gates eligibility'] = () => {
  const result = evaluateLocationGate('Chennai, India', PROFILE);
  assert.strictEqual(result.evidence.matched_city_hint, 'chennai');
  assert.strictEqual(result.evidence.matched_onsite_city, 'chennai');
};

tests['completely empty location string -> ambiguous, not silently admitted'] = () => {
  const result = evaluateLocationGate('', PROFILE);
  assert.strictEqual(result.location.category, 'ambiguous');
  assert.strictEqual(result.passed, false);
};

export function run(): { name: string; passed: boolean; error?: string }[] {
  return Object.entries(tests).map(([name, fn]) => {
    try {
      fn();
      return { name, passed: true };
    } catch (err: any) {
      return { name, passed: false, error: err?.message || String(err) };
    }
  });
}
