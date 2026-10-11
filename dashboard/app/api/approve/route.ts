import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '../../../lib/supabase';
import { loadBaseResume } from '../../../lib/base-resume';
import { tailorForJob } from '../../../lib/tailor';
import { renderResumeHTML } from '../../../lib/resume-template';
import { renderCoverLetterHTML } from '../../../lib/cover-letter-template';
import { renderPdfs } from '../../../lib/render-pdf';
import { uploadPdf } from '../../../lib/storage';

// Needs the Node runtime + a real browser (puppeteer's bundled Chromium). Runs on
// a container host (Render), not Vercel serverless.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function slug(s: string): string {
  return (
    (s || 'company')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'company'
  );
}

export async function POST(req: NextRequest) {
  const { id } = await req.json().catch(() => ({}));
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { data: app, error } = await supabase
    .from('applications')
    .select('id, company, role, jd_text, missing_skills')
    .eq('id', id)
    .single();

  if (error || !app) {
    return NextResponse.json({ error: 'Application not found' }, { status: 404 });
  }

  try {
    // 1) Tailor (Gemini) → 2) fill locked templates → 3) render PDFs (one browser)
    const base = await loadBaseResume();
    const { resume, cover } = await tailorForJob(base, {
      company: app.company,
      role: app.role,
      jdText: app.jd_text,
      missingSkills: app.missing_skills,
    });

    const resumeHtml = renderResumeHTML(base, resume);
    const coverHtml = renderCoverLetterHTML(base, cover);

    const [resumePdf, coverPdf] = await renderPdfs([resumeHtml, coverHtml]);

    // 4) Upload to Supabase Storage
    const prefix = `${slug(app.company)}-${app.role ? slug(app.role) : 'role'}`;
    const [resumeUrl, coverUrl] = await Promise.all([
      uploadPdf(String(app.id), `${prefix}-resume.pdf`, resumePdf),
      uploadPdf(String(app.id), `${prefix}-cover-letter.pdf`, coverPdf),
    ]);

    // 5) Mark approved + attach document URLs
    const { error: updateErr } = await supabase
      .from('applications')
      .update({
        status: 'approved',
        resume_storage_url: resumeUrl,
        cover_letter_storage_url: coverUrl,
      })
      .eq('id', app.id);

    if (updateErr) {
      return NextResponse.json({ error: `DB update failed: ${updateErr.message}` }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      id: app.id,
      status: 'approved',
      resume_storage_url: resumeUrl,
      cover_letter_storage_url: coverUrl,
    });
  } catch (err) {
    console.error('[approve] generation failed:', err);
    return NextResponse.json(
      { error: `Document generation failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
