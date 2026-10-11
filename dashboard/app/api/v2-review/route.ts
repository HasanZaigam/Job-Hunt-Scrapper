import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '../../../lib/supabase';

// READ-ONLY. This route only ever selects rows — no insert/update/delete/
// upsert anywhere below. It exists purely for the V2 review/comparison
// dashboard (dashboard/app/v2-review) and never writes anything, so it
// carries zero risk to V1 behavior or any application's status.
//
// The service-role key never reaches the browser: getServiceClient() runs
// server-side only, inside this Next.js Route Handler, same as every other
// API route in this app — the browser only ever talks to /api/v2-review,
// never to Supabase directly.

export async function GET(req: NextRequest) {
  const supabase = getServiceClient();
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10) || 200, 500);

  const { data, error } = await supabase
    .from('applications')
    .select(
      // Existing/V1 fields, plus the additive V2 columns from
      // database/migrations/004_v2_persistence.sql. Read-only select — no
      // .insert()/.update()/.delete()/.upsert() in this file.
      'id, company, role, location, ats_type, jd_url, status, match_score, match_justification, ' +
      'engine_version, role_family, opportunity_score, priority_bucket, needs_review, v2_scored_at, v2_result'
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    // The migration adding engine_version/role_family/... has not been
    // applied yet in most environments — surface that plainly instead of a
    // raw Postgres error, since "column does not exist" is the expected
    // state until 004_v2_persistence.sql is deliberately applied.
    const migrationMissing = /column .* does not exist/i.test(error.message);
    return NextResponse.json(
      {
        error: migrationMissing
          ? 'V2 columns are not present in this database yet — database/migrations/004_v2_persistence.sql has not been applied.'
          : error.message,
        raw: error.message,
      },
      { status: migrationMissing ? 409 : 500 }
    );
  }

  return NextResponse.json({ applications: data ?? [] });
}
