import { NextResponse } from 'next/server';
import { loadBaseResume } from '../../../lib/base-resume';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const resume = await loadBaseResume();
    return NextResponse.json({
      name: resume.name,
      location: resume.contact.location,
      target_locations: (resume as any).target_locations || ['Chennai', 'Bengaluru'],
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to load profile' }, { status: 500 });
  }
}
