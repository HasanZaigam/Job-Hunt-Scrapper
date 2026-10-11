import type { HardVetoResult } from './types';

// One structured, machine-parseable record per job decision — used both by
// the live shadow logger in agents/matcher/index.ts and by the offline
// evaluation scripts. Every field a human or a downstream tool needs to
// explain "why did this job end up here" lives on this object; nothing is
// summarized away before logging. Milestone 2 adds the role_family gate
// alongside experience + location, each with its own reason and evidence.

export interface DecisionLogEntry {
  job_id: string | number;
  company: string;
  role: string;
  location: string;
  v1: {
    admitted: boolean;
    reason: string | null;
  };
  v2: {
    admitted: boolean;
    needs_review: boolean;
    reason: string | null;
    failing_reasons: string[];
    gates: {
      role_family: { passed: boolean; family: string; confidence: string; reason: string; evidence: unknown };
      experience: { passed: boolean; band: string; source: string; reason: string; evidence: unknown };
      location: { passed: boolean; remote_flag: string; country: string | null; city: string | null; reason: string; evidence: unknown };
    };
  };
  // Milestone 1/2 ship hard-veto gates only — soft scoring (skill fit,
  // seniority distance, freshness, compensation) and priority buckets
  // (apply_now/apply/consider/skip) are a later milestone per the approved
  // rollout plan. `final_priority` is intentionally coarse until then: a
  // vetoed job can never earn a bucket regardless of future scoring, so it
  // is safe to report as a terminal 'skip' now. A gate-passing job that is
  // still flagged needs_review is surfaced distinctly, not silently folded
  // into 'eligible'.
  final_priority: 'skip (hard veto)' | 'needs review (low-confidence gate signal)' | 'eligible — pending skill/seniority scoring (later milestone)';
  ranking_changed: boolean;
}

export function buildDecisionLog(
  job: { id: string | number; company: string; role: string; location: string },
  v1Reason: string | null,
  v2Result: HardVetoResult
): DecisionLogEntry {
  const v1Admitted = !v1Reason;
  const v2Admitted = !v2Result.vetoed;

  const final_priority: DecisionLogEntry['final_priority'] = !v2Admitted
    ? 'skip (hard veto)'
    : v2Result.needs_review
    ? 'needs review (low-confidence gate signal)'
    : 'eligible — pending skill/seniority scoring (later milestone)';

  return {
    job_id: job.id,
    company: job.company,
    role: job.role,
    location: job.location,
    v1: { admitted: v1Admitted, reason: v1Reason },
    v2: {
      admitted: v2Admitted,
      needs_review: v2Result.needs_review,
      reason: v2Result.reason,
      failing_reasons: v2Result.failing_reasons,
      gates: {
        role_family: {
          passed: v2Result.gates.role_family.passed,
          family: v2Result.gates.role_family.family,
          confidence: v2Result.gates.role_family.confidence,
          reason: v2Result.gates.role_family.reason,
          evidence: v2Result.gates.role_family.evidence,
        },
        experience: {
          passed: v2Result.gates.experience.passed,
          band: v2Result.gates.experience.requirement.band,
          source: v2Result.gates.experience.requirement.source,
          reason: v2Result.gates.experience.reason,
          evidence: v2Result.gates.experience.evidence,
        },
        location: {
          passed: v2Result.gates.location.passed,
          remote_flag: v2Result.gates.location.location.remote_flag,
          country: v2Result.gates.location.location.country,
          city: v2Result.gates.location.location.city,
          reason: v2Result.gates.location.reason,
          evidence: v2Result.gates.location.evidence,
        },
      },
    },
    final_priority,
    ranking_changed: v1Admitted !== v2Admitted,
  };
}
