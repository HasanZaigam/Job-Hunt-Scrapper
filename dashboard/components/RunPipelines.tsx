'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, ExternalLink, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { PIPELINES } from '../lib/pipelines';

interface Step { name: string; done: number; total: number }
interface Run {
  status: string;
  conclusion: string | null;
  url: string;
  at: string;
  startedAt: string | null;
  step: Step | null;
}
interface Def { key: string; label: string; file: string; hint: string }

const DEFS: Def[] = Object.entries(PIPELINES).map(([key, p]) => ({ key, label: p.label, file: p.file, hint: p.hint }));
// Titles for the two groups of buttons (each group = one GitHub workflow = one status).
const GROUPS: { file: string; title: string }[] = [
  { file: 'daily-pipeline.yml', title: 'Daily pipeline (scrape + score)' },
  { file: 'linkedin-growth.yml', title: 'LinkedIn growth (drafts to Telegram)' },
];

const isActive = (r?: Run | null) => !!r && r.status !== 'completed';

function elapsed(from: string, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(from).getTime()) / 1000));
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function StatusLine({ run, now, justStarted }: { run: Run | null | undefined; now: number; justStarted: boolean }) {
  if (justStarted && !isActive(run)) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Started. Waiting for GitHub to pick it up...
      </div>
    );
  }
  if (!run) return <p className="text-xs text-muted-foreground">No runs yet.</p>;

  if (isActive(run)) {
    const pct = run.step ? Math.round((run.step.done / run.step.total) * 100) : 5;
    return (
      <div className="space-y-2 rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-medium">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {run.status === 'queued' ? 'Queued' : 'Running'} · {elapsed(run.startedAt || run.at, now)}
          </span>
          <a href={run.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
            live logs <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        {run.step && <p className="text-primary/80">Step {Math.min(run.step.done + 1, run.step.total)}/{run.step.total}: {run.step.name}</p>}
        <div className="h-1.5 overflow-hidden rounded-full bg-primary/20">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  const ok = run.conclusion === 'success';
  return (
    <a
      href={run.url}
      target="_blank"
      rel="noreferrer"
      className={`flex items-center gap-2 text-xs ${ok ? 'text-success' : 'text-danger'}`}
    >
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      Last run {ok ? 'succeeded' : run.conclusion || 'ended'} · {new Date(run.at).toLocaleString()}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

/** Buttons that start the GitHub Actions workflows (work still runs on Actions, not here). */
export function RunPipelines() {
  const [runs, setRuns] = useState<Record<string, Run | null>>({});
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [started, setStarted] = useState<Record<string, number>>({}); // file -> click time
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const runsRef = useRef(runs);
  runsRef.current = runs;

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/pipeline', { cache: 'no-store' });
      const j = await r.json();
      setConfigured(j.configured !== false);
      setRuns(j.runs || {});
    } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Tick every second for the elapsed timer; poll GitHub every 5s while anything is running or just started.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => {
      const waiting = Object.values(runsRef.current).some(isActive) || Object.keys(startedRef.current).length > 0;
      if (waiting) refresh();
    }, 5000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [refresh]);

  const startedRef = useRef(started);
  startedRef.current = started;

  // Once a freshly started workflow shows up as a run created after the click (or 90s pass), drop the "just started" hint.
  useEffect(() => {
    setStarted(prev => {
      const next = { ...prev };
      for (const [file, at] of Object.entries(prev)) {
        const run = runs[file];
        if ((run && new Date(run.at).getTime() >= at - 5000) || Date.now() - at > 90_000) delete next[file];
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [runs]);

  async function run(def: Def) {
    setBusy(def.key);
    setMsg(null);
    try {
      const r = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipeline: def.key }),
      });
      const j = await r.json();
      if (r.ok) {
        setStarted(prev => ({ ...prev, [def.file]: Date.now() }));
        setMsg({ ok: true, text: `"${def.label}" started on GitHub Actions. Progress shows below and updates by itself.` });
        setTimeout(refresh, 3000);
      } else {
        setMsg({ ok: false, text: j.error || 'Failed to start.' });
      }
    } catch {
      setMsg({ ok: false, text: 'Network error.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card space-y-5 p-6">
      <div>
        <p className="text-sm font-semibold text-foreground">Run pipelines</p>
        <p className="text-xs text-muted-foreground">Starts the GitHub Actions workflow for you. The work runs on GitHub, not on this server.</p>
      </div>

      {!configured && (
        <p className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          Not configured: add <code>GH_DISPATCH_TOKEN</code> in the Render environment (steps in docs/DEPLOY-RENDER.md).
        </p>
      )}
      {msg && (
        <p className={`rounded-lg border px-3 py-2 text-xs ${msg.ok ? 'border-success/30 bg-success/5 text-success' : 'border-danger/30 bg-danger/5 text-danger'}`}>
          {msg.text}
        </p>
      )}

      {GROUPS.map(g => {
        const run_ = runs[g.file];
        const locked = isActive(run_) || !!started[g.file];
        return (
          <div key={g.file} className="space-y-3 rounded-xl border border-border p-4">
            <p className="text-sm font-semibold text-foreground">{g.title}</p>
            <StatusLine run={run_} now={now} justStarted={!!started[g.file]} />
            <ul className="divide-y divide-border">
              {DEFS.filter(d => d.file === g.file).map(d => (
                <li key={d.key} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{d.label}</p>
                    <p className="text-xs text-muted-foreground">{d.hint}</p>
                  </div>
                  <button
                    onClick={() => run(d)}
                    disabled={!configured || busy !== null || locked}
                    title={locked ? 'Already running, wait for it to finish' : undefined}
                    className="pill shrink-0 bg-primary/10 text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                  >
                    {busy === d.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Run
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
