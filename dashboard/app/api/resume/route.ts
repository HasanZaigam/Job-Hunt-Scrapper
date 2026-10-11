import { NextRequest, NextResponse } from 'next/server';
import { writeFile, readFile, mkdir } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { generateWithPdf, parseJsonResponse } from '../../../lib/gemini';
import { resetBaseResumeCache } from '../../../lib/base-resume';

const RESUME_DIR = path.resolve(process.cwd(), '..', 'public-resume');
const RESUME_PATH = path.join(RESUME_DIR, 'resume.pdf');
const META_PATH = path.join(RESUME_DIR, 'resume-meta.json');

const CANDIDATES = [
  path.resolve(process.cwd(), '../agents/resume-generator/base-resume.json'),
  path.resolve(process.cwd(), 'agents/resume-generator/base-resume.json'),
];

const SYSTEM_INSTRUCTION = `You are a precise resume parser. Your job is to extract all details from the provided resume PDF and output a JSON object strictly matching the following schema:
{
  "name": "string",
  "contact": {
    "email": "string",
    "phone": "string",
    "linkedin": "string",
    "github": "string",
    "location": "string"
  },
  "summary": "string",
  "experience": [
    {
      "company": "string",
      "role": "string",
      "duration": "string",
      "bullets": ["string"]
    }
  ],
  "skills": {
    "languages": ["string"],
    "frameworks": ["string"],
    "tools": ["string"],
    "concepts": ["string"]
  },
  "education": [
    {
      "degree": "string",
      "institution": "string",
      "year": "string",
      "duration": "string",
      "grade": "string"
    }
  ],
  "projects": [
    {
      "name": "string",
      "description": "string",
      "tech": ["string"]
    }
  ],
  "certifications": ["string"],
  "strengths": ["string"],
  "spoken_languages": ["string"],
  "target_locations": ["string"],
  "target_keywords": ["string"]
}

Rules:
1. Output ONLY a valid JSON object. Do not include any conversational filler, markdown formatting (other than \`\`\`json if needed), or extra characters.
2. Standardize fields. Extract accurate bullet points for experience and descriptions for projects.
3. If a field is missing, use an empty array or empty string instead of omitting it.
4. For target_locations, if not explicitly mentioned in the resume, you can infer them based on the candidate's summary, current location, or default to ["Noida", "Delhi", "Bengaluru", "Remote", "India"].
5. For target_keywords, if not explicitly mentioned, you can infer based on the candidate's skills and roles (e.g. ["Frontend Developer", "React Developer", "Next.js Developer"] for a web engineer, or default to ["AI Engineer", "GenAI", "Machine Learning", "LLM Engineer", "MLOps"]).`;

const PROMPT = `Parse the attached resume PDF into the specified JSON format. Ensure name, skills, experience, and contact info are fully populated.`;

export async function GET() {
  if (!existsSync(RESUME_PATH)) {
    return NextResponse.json({ exists: false });
  }
  try {
    const meta = existsSync(META_PATH)
      ? JSON.parse(await readFile(META_PATH, 'utf-8'))
      : { name: 'resume.pdf', uploadedAt: null };
    return NextResponse.json({ exists: true, ...meta });
  } catch {
    return NextResponse.json({ exists: false });
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('resume') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!file.name.endsWith('.pdf')) {
      return NextResponse.json({ error: 'Only PDF files accepted' }, { status: 400 });
    }

    if (!existsSync(RESUME_DIR)) {
      await mkdir(RESUME_DIR, { recursive: true });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Save the PDF file locally
    await writeFile(RESUME_PATH, buffer);

    // Parse the PDF with Gemini
    console.log('[resume-api] Sending uploaded PDF to Gemini for parsing...');
    const pdfBase64 = buffer.toString('base64');
    const rawResponse = await generateWithPdf(PROMPT, pdfBase64, {
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: { responseMimeType: 'application/json' },
      tag: 'resume-parser',
    });

    // Parse the JSON profile
    const profileJson = parseJsonResponse<any>(rawResponse);

    // Write to base-resume.json targets
    for (const p of CANDIDATES) {
      try {
        const parentDir = path.dirname(p);
        if (existsSync(parentDir)) {
          await writeFile(p, JSON.stringify(profileJson, null, 2), 'utf-8');
          console.log(`[resume-api] Successfully updated base-resume.json at: ${p}`);
        }
      } catch (err: any) {
        console.error(`[resume-api] Failed to write to path ${p}:`, err.message);
      }
    }

    // Reset profile cache in memory
    resetBaseResumeCache();

    // Save metadata
    const meta = {
      name: file.name,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      path: RESUME_PATH,
    };
    await writeFile(META_PATH, JSON.stringify(meta, null, 2));

    return NextResponse.json({ ok: true, ...meta, profile: profileJson });
  } catch (error: any) {
    console.error('[resume-api] Error processing uploaded resume:', error);
    return NextResponse.json({ error: error.message || 'Failed to parse resume' }, { status: 500 });
  }
}
