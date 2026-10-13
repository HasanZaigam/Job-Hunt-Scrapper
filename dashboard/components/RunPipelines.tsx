'use client';

import { useCallback, useEffect, useState } from 'react';
import { Play, ExternalLink, Loader2 } from 'lucide-react';

import { PIPELINES } from '../lib/pipelines';

interface Run { status: string; conclusion: string | null; url: string; at: string }
interface Def { key: string; label: string; file: string; hint: string }

const DEFS: Def[] = Object.entries(PIPELINES).map(([key, p]) => ({ key, label: p.label, file: p.file, hint: p.hint }));

function badge(run: Run | null | undefined) {
  if (!run) return <span className="text-muted-foreground">no runs yet</span>;
  const when = new Date(run.at).toLocaleString();
  const state = run.status !== 'completed' ? 'running' : run.conclusion === 'success' ? 'success' : run.conclusion || 'done';
  const cls = state === 'success' ? 'text-success' : state === 'running' ? 'text-primary' : 'text-danger';
  return (
    <a href={run.url} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 ${cls}`}>
      last run: {state} · {when} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

/** Buttons that start the GitHub Actions workflows (work still runs on Actions, not here). */
export function RunPipelines() {
  const [runs, setRuns] = useState<Record<string, Run | null>>({});
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/pipeline', { cache: 'no-store' });
      const j = await r.json();
      setConfigured(j.configured !== false);
      setRuns(j.runs || {});
    } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

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
        setMsg({ ok: true, text: `${def.label} started on GitHub Actions. Status updates below in a few seconds.` });
        setTimeout(refresh, 6000);
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
    <div className="card space-y-4 p-6">
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

      <ul className="divide-y divide-border">
        {DEFS.map(d => (
          <li key={d.key} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{d.label}</p>
              <p className="text-xs text-muted-foreground">{d.hint}</p>
              <p className="mt-0.5 text-xs">{badge(runs[d.file])}</p>
            </div>
            <button
              onClick={() => run(d)}
              disabled={!configured || busy !== null}
              className="pill shrink-0 bg-primary/10 text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              {busy === d.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Run
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
