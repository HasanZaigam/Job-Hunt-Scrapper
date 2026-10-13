import { NextRequest, NextResponse } from 'next/server';
import { PIPELINES, ghHeaders, repoSlug } from '../../../lib/pipelines';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Behind the login middleware like every other /api route.
// Needs GH_DISPATCH_TOKEN (fine-grained PAT, this repo only, Actions: read & write).

function token(): string | null {
  return process.env.GH_DISPATCH_TOKEN || null;
}

/** POST { pipeline: "daily" | ... } -> starts that GitHub Actions workflow on main. */
export async function POST(req: NextRequest) {
  const t = token();
  if (!t) {
    return NextResponse.json({ error: 'GH_DISPATCH_TOKEN is not set on this server (see docs/DEPLOY-RENDER.md).' }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  const def = PIPELINES[String(body?.pipeline)];
  if (!def) return NextResponse.json({ error: 'Unknown pipeline' }, { status: 400 });

  const res = await fetch(
    `https://api.github.com/repos/${repoSlug()}/actions/workflows/${def.file}/dispatches`,
    {
      method: 'POST',
      headers: { ...ghHeaders(t), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main', ...(def.inputs ? { inputs: def.inputs } : {}) }),
    }
  );
  if (res.status !== 204) {
    const text = await res.text().catch(() => '');
    const hint =
      res.status === 401 || res.status === 403 || res.status === 404
        ? ' Check the token: this repo only, permission "Actions: Read and write".'
        : '';
    return NextResponse.json({ error: `GitHub said ${res.status}.${hint} ${text.slice(0, 200)}` }, { status: 502 });
  }
  return NextResponse.json({ ok: true, label: def.label });
}

/** GET -> latest run per workflow file (status, conclusion, link) for the status badges. */
export async function GET() {
  const t = token();
  if (!t) return NextResponse.json({ configured: false, runs: {} });

  const files = Array.from(new Set(Object.values(PIPELINES).map(p => p.file)));
  const runs: Record<string, { status: string; conclusion: string | null; url: string; at: string } | null> = {};
  await Promise.all(
    files.map(async file => {
      try {
        const r = await fetch(
          `https://api.github.com/repos/${repoSlug()}/actions/workflows/${file}/runs?per_page=1`,
          { headers: ghHeaders(t), cache: 'no-store' }
        );
        const j = r.ok ? await r.json() : null;
        const run = j?.workflow_runs?.[0];
        runs[file] = run
          ? { status: run.status, conclusion: run.conclusion, url: run.html_url, at: run.created_at }
          : null;
      } catch {
        runs[file] = null;
      }
    })
  );
  return NextResponse.json({ configured: true, runs });
}
