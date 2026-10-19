'use client';

import { useEffect, useState, useCallback } from 'react';
import { Check, MapPin, Wallet, Loader2, ExternalLink as LinkIcon, X, Briefcase } from 'lucide-react';
import { MatchBadge } from '../../components/MatchBadge';
import { PillButton } from '../../components/PillButton';

interface GigJob {
  id: string;
  company: string;
  role: string;
  location: string | null;
  salary_range: string | null;
  match_score: number | null;
  jd_url: string;
  status: string;
  is_manual_required: boolean;
}

export default function GigsPage() {
  const [jobs, setJobs] = useState<GigJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    fetch('/api/applications?jobType=gigs')
      .then(r => r.json())
      .then(d => setJobs(d.applications ?? []))
      .finally(() => setLoading(false));
  }, []);

  const markApplied = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/applications/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'applied', applied_at: new Date().toISOString() }),
      });
      if (res.ok) setJobs(prev => prev.filter(j => j.id !== id));
    } finally { setBusyId(null); }
  }, []);

  const remove = useCallback(async (id: string) => {
    setJobs(prev => prev.filter(j => j.id !== id));
    setSelected(prev => { const next = new Set(prev); next.delete(id); return next; });
    await fetch(`/api/applications/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'dismissed' }),
    });
  }, []);

  function toggleSelected(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(prev => (prev.size === jobs.length ? new Set() : new Set(jobs.map(j => j.id))));
  }

  async function clearSelected() {
    if (selected.size === 0 || clearing) return;
    if (!window.confirm(`Remove ${selected.size} gig${selected.size === 1 ? '' : 's'}?`)) return;
    setClearing(true);
    const ids = Array.from(selected);
    setJobs(prev => prev.filter(j => !selected.has(j.id)));
    setSelected(new Set());
    try {
      await Promise.all(ids.map(id =>
        fetch(`/api/applications/${id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'dismissed' }),
        })
      ));
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Gigs</h1>
          <p className="text-sm text-muted-foreground">
            Contract / freelance / AI-evaluation side-income work — kept separate from full-time roles, not hidden.
          </p>
        </div>
        {!loading && jobs.length > 0 && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={selected.size === jobs.length} onChange={toggleSelectAll}
                className="h-3.5 w-3.5 rounded border-border accent-primary" />
              Select all
            </label>
            {selected.size > 0 && (
              <PillButton tone="danger" onClick={clearSelected} className={clearing ? 'pointer-events-none opacity-60' : undefined}>
                {clearing ? 'Removing…' : `Remove selected (${selected.size})`}
              </PillButton>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="card grid place-items-center gap-2 py-24 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading…
        </div>
      ) : jobs.length === 0 ? (
        <div className="card grid place-items-center gap-3 py-24 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/15 text-accent"><Briefcase className="h-7 w-7" /></span>
          <p className="font-display text-lg font-semibold text-foreground">No gigs right now</p>
          <p className="max-w-sm text-sm text-muted-foreground">Contract/eval-task postings (e.g. Askable, Patronus AI-style) will show up here instead of the main queues.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {jobs.map((j, i) => (
            <div key={j.id} className="card animate-rise flex flex-wrap items-center gap-4 p-4" style={{ animationDelay: `${Math.min(i * 40, 300)}ms` }}>
              <input type="checkbox" checked={selected.has(j.id)} onChange={() => toggleSelected(j.id)}
                className="h-3.5 w-3.5 shrink-0 rounded border-border accent-primary" aria-label={`Select ${j.company}`} />
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/15 text-sm font-bold uppercase text-accent">
                {j.company.slice(0, 2)}
              </span>
              <div className="min-w-[180px] flex-1">
                <p className="font-semibold text-foreground">{j.company}</p>
                <p className="truncate text-sm text-muted-foreground">{j.role}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <span className="pill bg-accent/15 text-accent">Gig</span>
                  {j.location && <span className="pill bg-muted text-muted-foreground"><MapPin className="h-3 w-3" />{j.location}</span>}
                  {j.salary_range && <span className="pill bg-muted text-muted-foreground"><Wallet className="h-3 w-3" />{j.salary_range}</span>}
                </div>
              </div>
              <MatchBadge score={j.match_score} />
              <div className="flex items-center gap-2">
                <a href={j.jd_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted">
                  <LinkIcon className="h-3.5 w-3.5" /> Open
                </a>
                <button onClick={() => markApplied(j.id)} disabled={busyId === j.id}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-soft transition-colors hover:bg-primary/90 disabled:opacity-50">
                  {busyId === j.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Mark applied
                </button>
                <button onClick={() => remove(j.id)} disabled={busyId === j.id}
                  className="flex items-center gap-1.5 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs font-semibold text-danger transition-colors hover:bg-danger/10 disabled:opacity-50">
                  <X className="h-3.5 w-3.5" /> Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
