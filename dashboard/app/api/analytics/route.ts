import { NextResponse } from 'next/server';
import { getServiceClient } from '../../../lib/supabase';

// Live data — never statically evaluated/cached at build time.
export const dynamic = 'force-dynamic';

/** Aggregations for the Analytics page: conversion funnel, source mix, score histogram. */
export async function GET() {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('applications')
    .select('status, ats_type, match_score');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = data ?? [];

  const has = (s: string) => rows.filter(r => r.status === s).length;
  const total = rows.length;
  const matched = rows.filter(r => ['matched', 'approved', 'applied', 'interview_scheduled', 'assessment', 'offer'].includes(r.status as string)).length;
  const applied = rows.filter(r => ['applied', 'interview_scheduled', 'assessment', 'offer'].includes(r.status as string)).length;
  const interview = rows.filter(r => ['interview_scheduled', 'assessment', 'offer'].includes(r.status as string)).length;
  const offer = has('offer');

  const funnel = [
    { stage: 'Scraped', count: total },
    { stage: 'Matched', count: matched },
    { stage: 'Applied', count: applied },
    { stage: 'Interview', count: interview },
    { stage: 'Offer', count: offer },
  ];

  const sourceMap = new Map<string, number>();
  for (const r of rows) {
    const k = (r.ats_type as string) ?? 'unknown';
    sourceMap.set(k, (sourceMap.get(k) ?? 0) + 1);
  }
  const sources = [...sourceMap.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  // Per-source conversion — drop a low-yield source without re-running the
  // pipeline to find out. Derived entirely from existing columns (no schema
  // change): "sent" = everything we ever scraped from that source, "matched"
  // counts every row that reached 'matched' or beyond (never downgraded).
  const MATCHED_OR_BEYOND = new Set(['matched', 'approved', 'applied', 'interview_scheduled', 'assessment', 'offer']);
  const conversionMap = new Map<string, { source: string; sent: number; filtered: number; dismissed: number; matched: number }>();
  for (const r of rows) {
    const k = (r.ats_type as string) ?? 'unknown';
    let c = conversionMap.get(k);
    if (!c) { c = { source: k, sent: 0, filtered: 0, dismissed: 0, matched: 0 }; conversionMap.set(k, c); }
    c.sent++;
    if (r.status === 'filtered') c.filtered++;
    else if (r.status === 'dismissed') c.dismissed++;
    if (MATCHED_OR_BEYOND.has(r.status as string)) c.matched++;
  }
  const sourceConversion = [...conversionMap.values()]
    .map(c => ({ ...c, rate: c.sent ? Math.round((c.matched / c.sent) * 1000) / 10 : 0 }))
    .sort((a, b) => b.sent - a.sent);

  const buckets = [0, 0, 0, 0, 0]; // 0-19, 20-39, 40-59, 60-79, 80-100
  for (const r of rows) {
    const s = r.match_score as number | null;
    if (s == null) continue;
    buckets[Math.min(Math.floor(s / 20), 4)]++;
  }
  const histogram = ['0–19', '20–39', '40–59', '60–79', '80–100'].map((range, i) => ({ range, count: buckets[i] }));

  return NextResponse.json({ funnel, sources, histogram, sourceConversion });
}
