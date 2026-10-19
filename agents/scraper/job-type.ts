// Classifies a job as full-time vs a contract/gig/eval-task posting. This is a
// TAG, never a filter — gig postings (Askable/Patronus-style AI-eval contracts)
// are a valid side-income track and must still reach the dashboard, just in
// their own bucket instead of polluting the default full-time view.
//
// NOT WIRED into store.ts inserts yet — requires migration 006_job_type.sql
// (job_type column) to be applied first; writing it before that would break
// every insert (Postgres rejects the whole row on an unknown column), not
// fail in isolation like the rest of this pipeline is designed to.

export type JobType = 'full_time' | 'contract_gig' | 'unknown';

// Each pattern is anchored to an employment-TYPE context, not a bare word —
// "contract" alone false-positives constantly: OpenAI's standard posting
// footer links a "...-and-contractor-privacy-policy.pdf", and ordinary
// full-time JDs mention "government contract", "contract manufacturers",
// business-context "contract execution" etc. Same for "training"/"evaluation"
// — "model training" is routine ML-engineer language, not a gig descriptor;
// only "AI/model training TASKS" (the Askable/Patronus phrasing) counts.
const GIG_SIGNALS = [
  /\bindependent contractor\b/i,
  /\b1099\b/i,
  /\bfreelance\b/i,
  /\bcontract[\s-]?(to[\s-]?hire|position|role|basis|engagement|worker|type)\b/i,
  /\b(this is a|position is a|role is a)\s*(temporary|contract|freelance|1099)\b/i,
  /\btemporary\s*(position|role|contract|assignment|basis)\b/i,
  /\bper[\s-]?task\s*(pay|basis|rate)?\b/i,
  /\bhourly\s*(rate|pay|wage|compensation)\b/i,
  /\$\s*\d+(?:\.\d+)?\s*(?:-|to)\s*\$?\s*\d+(?:\.\d+)?\s*\/\s*(?:hr|hour)\b/i,
  /\bgig\b/i,
  /\b(?:ai|model)\s*(?:training|evaluation|eval)\s*tasks?\b/i,
  /\bdata\s*(?:labeling|labelling|annotation)\s*(?:task|tasks|project|gig|contractor)\b/i,
  /\b(?:rlhf|red[\s-]?team(?:ing)?)\s*(?:contractor|rater|task)/i,
  /\b(?:ai\s*)?rater\b/i,
];

const FULL_TIME_SIGNALS = [
  /\bfull[\s-]?time\b/i,
  /\bpermanent\b/i,
  /\bfull[\s-]?time,?\s*(exempt|employee)\b/i,
];

export function classifyJobType(
  role: string,
  jdText: string,
  extra: { salaryRange?: string | null; isManualRequired?: boolean } = {}
): JobType {
  const text = `${role || ''}\n${jdText || ''}\n${extra.salaryRange || ''}`;

  if (GIG_SIGNALS.some(re => re.test(text))) return 'contract_gig';
  if (FULL_TIME_SIGNALS.some(re => re.test(text))) return 'full_time';

  // No explicit signal either way. Greenhouse/Lever/Ashby ATS postings are
  // overwhelmingly full-time roles by default (that's what those ATSs are
  // built for) — only the free-text/manual-apply sources (remote boards,
  // Indeed) carry enough gig-posting noise to be genuinely ambiguous.
  return extra.isManualRequired ? 'unknown' : 'full_time';
}
