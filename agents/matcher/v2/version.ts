// Semver-style version of the V2 matcher LOGIC (gates + scoring), bumped
// whenever a change could alter a real decision — not on every commit.
// Persisted verbatim on every V2-touched row so "why did this score
// differently last week" is a version diff, not a guess.
//
// 2.0.0 — combined hard-veto gates (role family + experience + location), shadow mode
// 2.1.0 — Skill-Fit V2: structured extraction, taxonomy-aware matching, corrected compensation
// 2.2.0 — final hardening: nationwide India onsite eligibility, role-family authority fix, mobile signals
export const V2_ENGINE_VERSION = '2.2.0';
