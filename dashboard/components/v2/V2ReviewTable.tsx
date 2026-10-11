'use client';

import { Fragment, useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  classifyV2State, v2StateLabel, v1Admitted, v2Admitted, detectDisagreement,
  formatOpportunityScore, formatPriorityBucket, formatNeedsReview,
  getRoleFamilySection, getExperienceSection, getLocationSection,
  getSkillFitSection, getOpportunitySection,
  type V2ApplicationRow, type DisagreementKind,
} from '../../lib/v2';

const V2_STATE_STYLE: Record<string, string> = {
  not_evaluated: 'bg-muted text-muted-foreground',
  gates_only: 'bg-accent/15 text-accent',
  fully_scored: 'bg-primary/15 text-primary',
};

const DISAGREEMENT_STYLE: Record<DisagreementKind, string> = {
  none: 'bg-muted text-muted-foreground',
  unknown: 'bg-muted text-muted-foreground',
  v1_admit_v2_reject: 'bg-danger/10 text-danger',
  v1_reject_v2_admit: 'bg-success/10 text-success',
};

const DISAGREEMENT_LABEL: Record<DisagreementKind, string> = {
  none: 'Agree',
  unknown: '—',
  v1_admit_v2_reject: 'V1 admit / V2 reject',
  v1_reject_v2_admit: 'V1 reject / V2 admit',
};

function AdmitPill({ admitted, label }: { admitted: boolean | null; label: string }) {
  if (admitted === null) return <span className="pill bg-muted text-muted-foreground">{label}: —</span>;
  return (
    <span className={cn('pill', admitted ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger')}>
      {label}: {admitted ? 'Admit' : 'Reject'}
    </span>
  );
}

function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value ?? 'Not available'}</span>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function WhyPanel({ row }: { row: V2ApplicationRow }) {
  const state = classifyV2State(row);
  const roleFamily = getRoleFamilySection(row);
  const experience = getExperienceSection(row);
  const location = getLocationSection(row);
  const skillFit = getSkillFitSection(row);
  const opportunity = getOpportunitySection(row);
  const [showRaw, setShowRaw] = useState(false);

  if (state === 'not_evaluated') {
    return <p className="px-1 py-2 text-xs text-muted-foreground">V2 not evaluated — nothing to explain yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <SectionCard title="Role family">
          {roleFamily ? (
            <>
              <KeyValue label="Family" value={roleFamily.family} />
              <KeyValue label="Pass" value={roleFamily.passed === null ? 'Not available' : roleFamily.passed ? 'Pass' : 'Fail'} />
              <KeyValue label="Confidence" value={roleFamily.confidence} />
              <KeyValue label="Reason" value={<span className="text-left">{roleFamily.reason}</span>} />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Not available</p>
          )}
        </SectionCard>

        <SectionCard title="Experience">
          {experience ? (
            <>
              <KeyValue label="Detected years" value={experience.effective_years ?? `${experience.min_years ?? '—'}–${experience.max_years ?? '—'}`} />
              <KeyValue label="Tier" value={experience.tier} />
              <KeyValue label="Pass" value={experience.passed === null ? 'Not available' : experience.passed ? 'Pass' : 'Fail'} />
              <KeyValue label="Reason" value={<span className="text-left">{experience.reason}</span>} />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Not available</p>
          )}
        </SectionCard>

        <SectionCard title="Location">
          {location ? (
            <>
              <KeyValue label="Category" value={location.category} />
              <KeyValue label="Country / city" value={`${location.country ?? '—'} / ${location.city ?? '—'}`} />
              <KeyValue label="Pass" value={location.passed === null ? 'Not available' : location.passed ? 'Pass' : 'Fail'} />
              <KeyValue label="Reason" value={<span className="text-left">{location.reason}</span>} />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Not available</p>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Skill fit">
        {skillFit ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-4">
              <KeyValue label="Score" value={formatOpportunityScore(skillFit.score)} />
              <KeyValue label="Needs review" value={formatNeedsReview(skillFit.needs_review)} />
              <KeyValue label="Model" value={skillFit.extraction_model ?? 'Not available'} />
            </div>
            {skillFit.requirements.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1 pr-3 font-medium">Skill</th>
                      <th className="py-1 pr-3 font-medium">Type</th>
                      <th className="py-1 pr-3 font-medium">Match</th>
                      <th className="py-1 pr-3 font-medium">Candidate evidence</th>
                      <th className="py-1 font-medium">Quoted context</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skillFit.requirements.map((r, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="py-1 pr-3 font-medium text-foreground">{r.skill ?? '—'}</td>
                        <td className="py-1 pr-3 text-muted-foreground">{r.requirement_type ?? '—'}</td>
                        <td className="py-1 pr-3">
                          <span className={cn('pill', r.match_strength === 'missing' ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success')}>
                            {r.match_strength ?? '—'}
                          </span>
                        </td>
                        <td className="py-1 pr-3 text-muted-foreground">{r.matched_evidence ?? '—'}</td>
                        <td className="py-1 text-muted-foreground">{r.quoted_context ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Not scored</p>
        )}
      </SectionCard>

      <SectionCard title="Opportunity score">
        {opportunity ? (
          <div className="flex flex-wrap gap-4">
            <KeyValue label="Overall" value={formatOpportunityScore(opportunity.overall)} />
            <KeyValue label="Seniority fit" value={opportunity.seniority_fit ? formatOpportunityScore(opportunity.seniority_fit.score) : 'Not available'} />
            <KeyValue label="Freshness" value={opportunity.freshness ? formatOpportunityScore(opportunity.freshness.score) : 'Not available'} />
            <KeyValue
              label="Compensation"
              value={opportunity.compensation ? `${opportunity.compensation.status ?? '—'} (${formatOpportunityScore(opportunity.compensation.score)})` : 'Not available'}
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Not scored</p>
        )}
      </SectionCard>

      <div>
        <button onClick={() => setShowRaw(s => !s)} className="text-xs font-medium text-primary hover:underline">
          {showRaw ? 'Hide raw v2_result' : 'View raw v2_result (debug)'}
        </button>
        {showRaw && (
          <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-muted/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
            {JSON.stringify(row.v2_result, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

export function V2ReviewTable({ applications }: { applications: V2ApplicationRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (applications.length === 0) {
    return (
      <div className="card grid place-items-center gap-2 py-16 text-center">
        <p className="text-sm font-medium text-foreground">No records match this filter</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {['Company', 'Role', 'V1', 'V2 state', 'Role family', 'Opportunity', 'Priority', 'Needs review', 'Agreement', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {applications.map(row => {
              const state = classifyV2State(row);
              const disagreement = detectDisagreement(row);
              const isExpanded = expanded === row.id;
              return (
                <Fragment key={row.id}>
                  <tr className="border-b border-border/70 transition-colors last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <a href={row.jd_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary">
                        {row.company} <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-muted-foreground">{row.role}</td>
                    <td className="px-4 py-3"><AdmitPill admitted={v1Admitted(row)} label="V1" /></td>
                    <td className="px-4 py-3">
                      <span className={cn('pill', V2_STATE_STYLE[state])}>{v2StateLabel(state)}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{row.role_family ?? 'Not available'}</td>
                    <td className="px-4 py-3 text-xs font-medium tabular-nums text-foreground">{formatOpportunityScore(row.opportunity_score)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatPriorityBucket(row.priority_bucket)}</td>
                    <td className="px-4 py-3">
                      <span className={cn('pill', row.needs_review ? 'bg-accent/15 text-accent' : 'bg-muted text-muted-foreground')}>
                        {formatNeedsReview(row.needs_review)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('pill', DISAGREEMENT_STYLE[disagreement])}>{DISAGREEMENT_LABEL[disagreement]}</span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setExpanded(isExpanded ? null : row.id)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        {isExpanded ? 'Hide' : 'Why'}
                        <ChevronDown className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-180')} />
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-muted/30">
                      <td colSpan={10} className="px-6 py-4">
                        <WhyPanel row={row} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
