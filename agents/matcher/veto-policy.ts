import type { HardVetoResult } from './v2/types';
import { titleRank } from '../scraper/search-profile';

/**
 * The v2 role-family gate classifies from keywords in the whole job text, which can
 * misfire on a job whose TITLE is exactly one of the candidate's preferred titles
 * ("AI Software Engineer (Python)", "Applied AI Engineer, Agents & Automations").
 * For those, a veto caused ONLY by the role-family gate is overridden — the title is
 * the strongest evidence of what the job is. Experience and location vetoes always stand.
 *
 * Returns the veto reason to enforce, or null when the job should not be vetoed.
 */
export function effectiveVeto(role: string, v2: HardVetoResult): string | null {
  if (!v2.vetoed) return null;
  const onlyRoleFamily = v2.failing_reasons.length > 0 && v2.failing_reasons.every(r => r.startsWith('role_family:'));
  const tr = titleRank(role);
  if (onlyRoleFamily && tr && tr.rank <= 5) return null;
  return v2.reason;
}
