import fs from 'fs';
import path from 'path';
import { evaluateExperienceGate } from './gates/experience';
import { evaluateLocationGate } from './gates/location';
import { evaluateRoleFamilyGate } from './gates/role-family';
import type { ExperiencePolicy, LocationProfile, RoleFamilyProfile, RoleFamily, HardVetoResult } from './types';

// Milestone 2 scope: combine role-family + experience-band + location gates
// into one shadow-only decision. Still never writes `status` — the caller
// (agents/matcher/index.ts) only logs this result. Soft scoring (skill fit,
// seniority distance, freshness, compensation) is not part of this gate and
// is not built yet.

// Tiered policy per CTO correction — configurable via base-resume.json's
// `experience_policy`, not hardcoded band+tolerance math.
const DEFAULT_EXPERIENCE_POLICY: ExperiencePolicy = {
  acceptable_max_years: 2,
  ideal_min_years: 1,
  ideal_max_years: 3,
  stretch_max_years: 4,
  hard_reject_min_years: 5,
};

const DEFAULT_LOCATION_PROFILE: LocationProfile = {
  countries: ['in'],
  remote_ok_from_anywhere: true,
  onsite_cities: ['noida', 'delhi', 'new delhi', 'gurgaon', 'gurugram', 'bengaluru', 'bangalore'],
};

const DEFAULT_ROLE_FAMILY_PROFILE: RoleFamilyProfile = {
  acceptable_role_families: ['ai_ml_engineer', 'genai_applied', 'backend_engineer'],
};

export function loadProfile(): { experience: ExperiencePolicy; location: LocationProfile; roleFamily: RoleFamilyProfile } {
  try {
    const p = path.resolve(__dirname, '../../resume-generator/base-resume.json');
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const experience: ExperiencePolicy = data.experience_policy ?? DEFAULT_EXPERIENCE_POLICY;
      const location: LocationProfile = data.location_eligibility
        ? {
            countries: (data.location_eligibility.countries || DEFAULT_LOCATION_PROFILE.countries).map((c: string) => c.toLowerCase()),
            remote_ok_from_anywhere: data.location_eligibility.remote_ok_from_anywhere ?? true,
            onsite_cities: (data.location_eligibility.onsite_cities || DEFAULT_LOCATION_PROFILE.onsite_cities).map((c: string) => c.toLowerCase()),
          }
        : DEFAULT_LOCATION_PROFILE;
      const roleFamily: RoleFamilyProfile = data.acceptable_role_families
        ? { acceptable_role_families: data.acceptable_role_families as RoleFamily[] }
        : DEFAULT_ROLE_FAMILY_PROFILE;
      return { experience, location, roleFamily };
    }
  } catch (err) {
    console.error('[matcher/v2] Error loading v2 profile from base-resume.json:', err);
  }
  return { experience: DEFAULT_EXPERIENCE_POLICY, location: DEFAULT_LOCATION_PROFILE, roleFamily: DEFAULT_ROLE_FAMILY_PROFILE };
}

export function evaluateHardVeto(role: string, jdText: string, location: string): HardVetoResult {
  const { experience: experienceProfile, location: locationProfile, roleFamily: roleFamilyProfile } = loadProfile();

  const roleFamilyResult = evaluateRoleFamilyGate(role, jdText, roleFamilyProfile);
  const experienceResult = evaluateExperienceGate(role, jdText, experienceProfile);
  const locationResult = evaluateLocationGate(location, locationProfile);

  const gates = { role_family: roleFamilyResult, experience: experienceResult, location: locationResult };

  // A gate only vetoes when it explicitly failed (passed === false). A gate
  // that is passing-but-needs-review (low-confidence role family, unknown
  // experience band, unspecified location) never contributes to `vetoed` —
  // it only contributes to `needs_review`.
  const failing_reasons: string[] = [];
  if (!gates.role_family.passed) failing_reasons.push(`role_family: ${gates.role_family.reason}`);
  if (!gates.experience.passed) failing_reasons.push(`experience: ${gates.experience.reason}`);
  if (!gates.location.passed) failing_reasons.push(`location: ${gates.location.reason}`);

  const vetoed = failing_reasons.length > 0;
  const needs_review = gates.role_family.needs_review || gates.experience.needs_review || gates.location.needs_review;

  return {
    vetoed,
    needs_review,
    reason: failing_reasons[0] ?? null,
    failing_reasons,
    gates,
    // Milestone 1 compatibility mirrors — same objects, not copies.
    experience: gates.experience,
    location: gates.location,
  };
}
