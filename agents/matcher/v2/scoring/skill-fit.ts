import { generateWithModelInfo } from '../../../lib/gemini';
import { bestMatchingSkill } from './skill-taxonomy';
import type { SkillFitResult, ExtractedRequirement, ScoredRequirement, RequirementType, MatchStrength } from '../types';

// Skill-Fit V2 — structured, weighted, taxonomy-aware.
//
// Still exactly one Gemini call per job (the extraction step). Everything
// after extraction is deterministic: no second LLM judgment call, no
// subjective "depth of experience" scoring. Match-strength classification
// is a lookup against a small curated AI/LLM taxonomy (skill-taxonomy.ts)
// plus legacy substring containment for everything outside it.
//
// Strict fallback is unchanged in spirit: if extraction fails outright, or
// returns something that isn't a parseable requirement list, this returns
// score=null / status='error' rather than fabricating a plausible score.

const REQUIREMENT_TYPE_WEIGHT: Record<RequirementType, number> = { required: 1.0, preferred: 0.4 };
const MATCH_STRENGTH_WEIGHT: Record<MatchStrength, number> = {
  exact: 1.0,
  strong_semantic: 0.8,
  related: 0.35,
  missing: 0.0,
};

function flattenCandidateSkills(skills: Record<string, string[]> | undefined | null): string[] {
  if (!skills) return [];
  return Object.values(skills).flat().filter((s): s is string => typeof s === 'string');
}

function extractionPrompt(jdText: string): string {
  return `Extract the concrete technical requirements from this job description. For each one, return:
- "skill": short name of the skill/tool/language/framework
- "requirement_type": "required" if the JD treats it as a hard requirement/must-have, or "preferred" if it's described as a nice-to-have/plus/bonus
- "quoted_context": a short verbatim snippet (under 15 words) from the JD showing where this came from

Return ONLY a JSON array of objects with exactly those three keys — no markdown fences, no commentary, no extra keys.

Example shape: [{"skill":"Python","requirement_type":"required","quoted_context":"2 years of experience with Python"}]

Job description:
${jdText}`;
}

function parseExtraction(raw: string): ExtractedRequirement[] {
  const cleaned = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('extraction response was not a JSON array');

  const requirements: ExtractedRequirement[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const skill = typeof item.skill === 'string' ? item.skill.trim() : '';
    if (!skill) continue;
    const requirement_type: RequirementType = item.requirement_type === 'preferred' ? 'preferred' : 'required';
    const quoted_context = typeof item.quoted_context === 'string' ? item.quoted_context.trim() : '';
    requirements.push({ skill, requirement_type, quoted_context });
  }
  return requirements;
}

const weights_applied = { requirement_type: REQUIREMENT_TYPE_WEIGHT, match_strength: MATCH_STRENGTH_WEIGHT };

/**
 * Pure, deterministic scoring step — no network call. Exposed separately
 * so the weighting formula (required vs preferred, exact vs semantic vs
 * related vs missing) can be unit-tested without invoking Gemini.
 */
export function scoreRequirements(
  requirements: ExtractedRequirement[],
  candidateSkills: string[],
  modelUsed: string | null
): SkillFitResult {
  if (requirements.length === 0) {
    return {
      score: null,
      matched_skills: [],
      missing_skills: [],
      status: 'ok',
      needs_review: true,
      reason: 'extraction returned zero requirements — nothing to compare against, flagged for review',
      evidence: { requirements: [], extraction_model: modelUsed, extraction_error: null, weights_applied },
    };
  }

  const scored: ScoredRequirement[] = requirements.map(req => {
    const best = bestMatchingSkill(req.skill, candidateSkills);
    const strength: MatchStrength = best?.strength ?? 'missing';
    const contribution = REQUIREMENT_TYPE_WEIGHT[req.requirement_type] * MATCH_STRENGTH_WEIGHT[strength];
    return {
      requirement: req,
      match_strength: strength,
      matched_evidence: best?.skill ?? null,
      contribution,
      reason: best
        ? `"${req.skill}" (${req.requirement_type}) matched "${best.skill}" as ${strength}`
        : `"${req.skill}" (${req.requirement_type}) has no matching candidate evidence`,
    };
  });

  const weightSum = requirements.reduce((sum, r) => sum + REQUIREMENT_TYPE_WEIGHT[r.requirement_type], 0);
  const contributionSum = scored.reduce((sum, s) => sum + s.contribution, 0);
  const score = Math.round((contributionSum / weightSum) * 100);

  const matched_skills = scored.filter(s => s.match_strength !== 'missing').map(s => s.requirement.skill);
  const missing_skills = scored.filter(s => s.match_strength === 'missing').map(s => s.requirement.skill);

  return {
    score,
    matched_skills,
    missing_skills,
    status: 'ok',
    needs_review: false,
    reason: `${matched_skills.length}/${requirements.length} requirements matched (weighted by type + match strength)`,
    evidence: { requirements: scored, extraction_model: modelUsed, extraction_error: null, weights_applied },
  };
}

export async function computeSkillFit(
  jdText: string,
  candidateSkills: Record<string, string[]> | undefined | null
): Promise<SkillFitResult> {
  const flatCandidate = flattenCandidateSkills(candidateSkills);
  let modelUsed: string | null = null;
  let requirements: ExtractedRequirement[] = [];

  try {
    const { text, model } = await generateWithModelInfo(extractionPrompt(jdText), { tag: 'skill-fit-extraction' });
    modelUsed = model;
    requirements = parseExtraction(text);
  } catch (err: any) {
    return {
      score: null,
      matched_skills: [],
      missing_skills: [],
      status: 'error',
      needs_review: true,
      reason: `skill extraction failed: ${err?.message || String(err)}`,
      evidence: { requirements: [], extraction_model: modelUsed, extraction_error: err?.message || String(err), weights_applied },
    };
  }

  return scoreRequirements(requirements, flatCandidate, modelUsed);
}
