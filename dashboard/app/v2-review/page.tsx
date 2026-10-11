'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, GitCompare } from 'lucide-react';
import { cn } from '../../lib/utils';
import { V2ReviewTable } from '../../components/v2/V2ReviewTable';
import { REVIEW_FILTERS, matchesFilter, type ReviewFilter, type V2ApplicationRow } from '../../lib/v2';

// READ-ONLY. This page never writes anything — it only fetches from
// /api/v2-review (a GET-only route) and renders. No status changes, no
// resume/cover-letter actions, no auto-apply. Purely a comparison/review
// surface for the shadow-only V2 matcher.

export default function V2ReviewPage() {
  const [applications, setApplications] = useState<V2ApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReviewFilter>('all');

  useEffect(() => {
    fetch('/api/v2-review')
      .then(async r => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error || 'Failed to load V2 review data');
        setApplications(body.applications ?? []);
      })
      .catch(err => setErrorMessage(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => applications.filter(a => matchesFilter(a, filter)), [applications, filter]);

  const counts = useMemo(() => {
    const notScored = applications.filter(a => a.opportunity_score === null).length;
    const noBucket = applications.filter(a => a.priority_bucket === null).length;
    return { notScored, noBucket };
  }, [applications]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-foreground">
          <GitCompare className="h-6 w-6 text-primary" /> V2 Review
        </h1>
        <p className="text-sm text-muted-foreground">
          Read-only comparison of V1&apos;s live decision against the shadow-only V2 matcher. Nothing here writes to a job&apos;s
          status, generates documents, or auto-applies. V2 is not enabled in production.
        </p>
      </div>

      {errorMessage && (
        <div className="card border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          <p className="font-medium">Couldn&apos;t load V2 review data</p>
          <p className="mt-1 text-xs opacity-90">{errorMessage}</p>
        </div>
      )}

      {!errorMessage && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {REVIEW_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={cn(
                  'pill border border-border transition-colors',
                  filter === f.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground hover:bg-muted'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span><b className="text-foreground">{applications.length}</b> total rows loaded</span>
            <span><b className="text-foreground">{filtered.length}</b> match this filter</span>
            <span><b className="text-foreground">{counts.notScored}</b> with opportunity_score = null (not scored)</span>
            <span><b className="text-foreground">{counts.noBucket}</b> with priority_bucket = null (not assigned)</span>
          </div>

          {loading ? (
            <div className="card grid place-items-center gap-2 py-24 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : (
            <V2ReviewTable applications={filtered} />
          )}
        </>
      )}
    </div>
  );
}
