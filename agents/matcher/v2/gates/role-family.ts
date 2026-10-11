import type { RoleFamily, RoleFamilyConfidence, RoleFamilyGateResult, RoleFamilyEvidence, RoleFamilyProfile } from '../types';

// Deterministic keyword-rule classifier — no LLM call in this gate. A title
// match counts double over a JD-body match, since the title is the
// strongest signal of what a job actually is.
//
// Confidence describes whether the ambiguity in classification could
// actually change the gate's pass/fail outcome, not just whether one label
// "won" cleanly:
//   high   — one family wins outright (no tie at the top score)
//   medium — the top score is tied between two-or-more families, but every
//            tied family agrees on acceptability (all acceptable, or all
//            not) — the label is ambiguous but the decision isn't
//   low    — zero keyword hits anywhere, OR the tie at the top spans both
//            an acceptable and a non-acceptable family — the decision
//            itself is genuinely uncertain
// Per the CTO's instruction, low confidence is never auto-rejected — it
// passes the gate with needs_review=true, same treatment as an 'unknown'
// experience band.

const FAMILY_KEYWORDS: Record<Exclude<RoleFamily, 'unknown'>, string[]> = {
  ai_ml_engineer: ['ai engineer', 'ml engineer', 'machine learning engineer', 'ai/ml', 'ai platform engineer', 'ai software engineer'],
  genai_applied: ['genai', 'generative ai', 'llm', 'rag', 'prompt engineering', 'llm engineer'],
  backend_engineer: ['backend engineer', 'backend developer', 'api engineer', 'platform engineer'],
  data_scientist: ['data scientist', 'data science', 'research scientist', 'applied scientist', 'ai safety research'],
  devops_infra: ['devops', 'sre', 'site reliability', 'infrastructure engineer', 'cloud engineer'],
  // Deliberately excludes the bare phrase "software engineer": titles like
  // "AI Software Engineer" contain that substring too, which would tie
  // every AI-specific title against this generic bucket for no reason.
  other_engineering: ['full stack engineer', 'full-stack engineer', 'frontend engineer', 'qa engineer', 'embedded engineer'],
  // 'recruiter' deliberately excluded: real-world validation showed it
  // almost always comes from anti-fraud/EEO boilerplate ("verify you're
  // speaking with an official recruiter...") rather than describing the
  // job itself, and was flipping genuine engineering JDs to non_engineering.
  non_engineering: ['product manager', 'program manager', 'account executive', 'sales', 'marketing', 'designer', 'hr business partner'],
};

// CTO hardening (P0/P1 #3, then a follow-up authority fix): real jobs
// proved two related problems:
//  (a) AI vocabulary alone (OpenAI, Gemini, Zapier, n8n, Tableau, Looker,
//      Excel) can pull a non-engineering role into an engineering family
//      purely on keyword overlap — fixed by requiring functional
//      engineering evidence, not just tech-name keywords.
//  (b) The reverse and more dangerous failure: a GENUINELY engineering JD
//      (e.g. a real "Machine Learning Engineer" posting) can get
//      misclassified `non_engineering` because it incidentally mentions
//      "product managers", "designers", or "marketing" as cross-functional
//      collaborators — ordinary boilerplate in almost any real JD, not
//      evidence the role itself is non-engineering.
//
// The fix: functional engineering-responsibility evidence (ENGINEERING_SIGNALS)
// has substantially higher authority than the WEAK generic nouns in
// FAMILY_KEYWORDS.non_engineering ('product manager', 'designer', 'marketing',
// 'sales', ...), which are single words prone to incidental mention. Only
// the STRONG, deliberate functional phrases in NON_ENGINEERING_SIGNALS below
// (things like "revops", "go-to-market", "product roadmap" — phrases that
// describe what the JOB actually is, not who it collaborates with) can
// outweigh real engineering evidence, and only when comparable to or
// exceeding it — otherwise it's a red flag for manual review, not silent
// non-engineering rejection.
const ENGINEERING_SIGNALS = [
  'build and maintain', 'design and develop', 'write code', 'write production code',
  'software development', 'software engineering', 'backend development', 'frontend development',
  'full-stack', 'full stack', 'api development', 'build apis', 'building apis', 'ship features',
  'train models', 'fine-tune', 'fine-tuning', 'model development', 'deploy models', 'ml pipeline',
  'agent framework', 'agentic workflows', 'infrastructure engineering', 'platform engineering',
  'ci/cd pipeline', 'codebase', 'pull request', 'code review', 'production systems',
  'distributed systems', 'microservices', 'engineering team',
  // Mobile engineering signals (CTO follow-up: iOS/Android JDs were being
  // missed entirely by the original list, since none of the phrases above
  // are how a mobile engineering JD typically describes itself).
  'ios', 'android', 'swift', 'swiftui', 'kotlin', 'mobile development', 'app development',
  'production code', 'shipping production code', 'shipping production software',
];

// STRONG, deliberate functional phrases only — each one describes what the
// JOB ITSELF is, not an incidental mention of another team. Bare single
// words like "sales"/"marketing"/"customer success" are deliberately EXCLUDED
// here (they live only in FAMILY_KEYWORDS.non_engineering as weak signal)
// because a real engineering JD can easily mention "marketing automation"
// as a product domain, or "customer success" as a downstream stakeholder,
// without the role itself being non-engineering.
const NON_ENGINEERING_SIGNALS = [
  'product roadmap', 'product management', 'revops', 'revenue operations',
  'business operations', 'data analyst', 'reporting dashboards', 'spreadsheets',
  'google sheets', 'program management', 'stakeholder management',
  'go-to-market', 'gtm strategy', 'sales enablement', 'business technology',
];

// Word-boundary matching, not plain substring containment — a short signal
// like "ios" must not match inside "previous", "various", "curious", etc.
// (a real bug this exact check caught during validation: "Enterprise AI
// Strategist" was picking up a phantom "ios" engineering signal this way).
function countFunctionalSignals(haystack: string, signals: string[]): { count: number; matched: string[] } {
  const matched = signals.filter(s => {
    const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
  });
  return { count: matched.length, matched };
}

interface FamilyScore {
  family: Exclude<RoleFamily, 'unknown'>;
  count: number;
  matched: string[];
}

function countHits(haystack: string, keywords: string[], titleHaystack: string): { count: number; matched: string[] } {
  const matched: string[] = [];
  let count = 0;
  for (const kw of keywords) {
    const inTitle = titleHaystack.includes(kw);
    const inBody = haystack.includes(kw);
    if (inTitle) { count += 2; matched.push(`${kw} (title)`); }
    else if (inBody) { count += 1; matched.push(`${kw} (body)`); }
  }
  return { count, matched };
}

function scoreFamilies(role: string, jdText: string): FamilyScore[] {
  const titleHaystack = (role || '').toLowerCase();
  const fullHaystack = `${titleHaystack} ${(jdText || '').toLowerCase()}`;

  const scores: FamilyScore[] = [];
  for (const [family, keywords] of Object.entries(FAMILY_KEYWORDS) as [Exclude<RoleFamily, 'unknown'>, string[]][]) {
    const { count, matched } = countHits(fullHaystack, keywords, titleHaystack);
    scores.push({ family, count, matched });
  }
  return scores.sort((a, b) => b.count - a.count);
}

export function classifyRoleFamily(role: string, jdText: string): { family: RoleFamily; confidence: RoleFamilyConfidence; evidence: RoleFamilyEvidence } {
  const scores = scoreFamilies(role, jdText);
  const top = scores[0];
  const runnerUp = scores[1];
  const matchedKeywords: Record<string, string[]> = {};
  for (const s of scores) if (s.count > 0) matchedKeywords[s.family] = s.matched;

  const fullHaystack = `${(role || '').toLowerCase()} ${(jdText || '').toLowerCase()}`;
  const eng = countFunctionalSignals(fullHaystack, ENGINEERING_SIGNALS);
  const nonEng = countFunctionalSignals(fullHaystack, NON_ENGINEERING_SIGNALS);

  const evidence: RoleFamilyEvidence = {
    matched_keywords: matchedKeywords,
    top_family_hits: top.count,
    runner_up_family: runnerUp && runnerUp.count > 0 ? runnerUp.family : null,
    runner_up_hits: runnerUp ? runnerUp.count : 0,
    engineering_signals: eng.matched,
    non_engineering_signals: nonEng.matched,
  };

  if (top.count === 0) return { family: 'unknown', confidence: 'low', evidence };

  const tied = scores.filter(s => s.count === top.count);
  const confidence: RoleFamilyConfidence = tied.length === 1 ? 'high' : 'medium';
  return { family: top.family, confidence, evidence };
}

const ENGINEERING_FAMILIES: Exclude<RoleFamily, 'unknown'>[] = [
  'ai_ml_engineer', 'genai_applied', 'backend_engineer', 'devops_infra', 'other_engineering', 'data_scientist',
];

export function evaluateRoleFamilyGate(role: string, jdText: string, profile: RoleFamilyProfile): RoleFamilyGateResult {
  const scores = scoreFamilies(role, jdText);
  const top = scores[0];
  const matchedKeywords: Record<string, string[]> = {};
  for (const s of scores) if (s.count > 0) matchedKeywords[s.family] = s.matched;
  const runnerUp = scores[1];

  const fullHaystack = `${(role || '').toLowerCase()} ${(jdText || '').toLowerCase()}`;
  const eng = countFunctionalSignals(fullHaystack, ENGINEERING_SIGNALS);
  const nonEng = countFunctionalSignals(fullHaystack, NON_ENGINEERING_SIGNALS);

  const evidence: RoleFamilyEvidence = {
    matched_keywords: matchedKeywords,
    top_family_hits: top.count,
    runner_up_family: runnerUp && runnerUp.count > 0 ? runnerUp.family : null,
    runner_up_hits: runnerUp ? runnerUp.count : 0,
    engineering_signals: eng.matched,
    non_engineering_signals: nonEng.matched,
  };

  if (top.count === 0) {
    return {
      family: 'unknown',
      confidence: 'low',
      passed: true,
      needs_review: true,
      reason: 'no role-family keywords matched — passed provisionally, flagged for review',
      evidence,
    };
  }

  // AUTHORITY RULE (CTO hardening): whenever there is ANY real functional
  // engineering evidence in the JD, it takes priority over the raw
  // FAMILY_KEYWORDS tally — which otherwise lets weak, incidental generic
  // nouns ("product manager", "designer", "marketing" as collaborators)
  // numerically outscore a genuine engineering title/keyword match. This
  // directly fixes the real "Machine Learning Engineer" JD that was
  // misclassified `non_engineering` purely because it mentioned working
  // with product managers and designers.
  if (eng.count > 0) {
    if (nonEng.count > 0 && nonEng.count >= eng.count) {
      // Comparable or greater STRONG non-engineering evidence — genuinely
      // ambiguous (e.g. an "AI Solutions Architect" doing both real
      // engineering AND real go-to-market work). Never resolve this
      // silently either way.
      const bestEngGuess = scores.find(s => s.family !== 'non_engineering') ?? top;
      return {
        family: bestEngGuess.family,
        confidence: 'low',
        passed: true,
        needs_review: true,
        reason: `mixed signals: engineering evidence (${eng.matched.join(', ')}) vs. comparable strong non-engineering evidence (${nonEng.matched.join(', ')}) — flagged for review, not resolved either way`,
        evidence,
      };
    }

    // Engineering evidence dominates (no strong non-engineering phrase, or
    // clearly outweighed by it) — classify by the best-scoring ENGINEERING
    // family, ignoring incidental weak non_engineering keyword noise
    // entirely, regardless of what the raw keyword tally alone would have
    // picked.
    const engScores = scores.filter(s => s.family !== 'non_engineering');
    const engTop = engScores[0];
    if (engTop && engTop.count > 0) {
      const tiedEng = engScores.filter(s => s.count === engTop.count);
      const confidence: RoleFamilyConfidence = tiedEng.length === 1 ? 'high' : 'medium';
      return {
        family: engTop.family,
        confidence,
        passed: profile.acceptable_role_families.includes(engTop.family),
        needs_review: false,
        reason: `functional engineering evidence (${eng.matched.join(', ')}) outweighs incidental non-engineering vocabulary — classified as ${engTop.family}, not overridden by generic collaborator mentions`,
        evidence,
      };
    }
    // No engineering-family keyword hit at all despite functional engineering
    // signals being present (unusual) — fall through to normal logic below.
  }

  // Hard override (CTO P0/P1 #3): AI vocabulary (OpenAI/Gemini/Zapier/n8n/
  // Tableau/Looker/Excel, etc.) picked an engineering-flavored family, but
  // there is ZERO functional evidence of actual engineering work anywhere
  // in the JD, and there IS non-engineering evidence. Do not rely on
  // technology-name keywords alone.
  //
  // "Title evidence should remain strong" (CTO): if the engineering family
  // was matched via the TITLE itself (e.g. the title literally says "AI
  // Engineer"), that is a much stronger signal than a body-only AI-vocab
  // mention — a real, unambiguous engineering title must not be overridden
  // by weak, boilerplate-prone generic nouns alone (a real case found in
  // validation: "recruiter"/"designer" from an EEO footer flipped a
  // genuinely-titled "Applied AI Engineer" to non_engineering). Weak-only
  // evidence can only override a BODY-only (not title-based) engineering
  // pick; a genuinely STRONG, deliberate non-engineering phrase can still
  // override either way.
  const topMatchedViaTitle = (matchedKeywords[top.family] || []).some(k => k.endsWith('(title)'));
  const weakNonEngOnly = nonEng.count === 0 && !!matchedKeywords['non_engineering'];
  const overrideEligible = nonEng.count > 0 || (weakNonEngOnly && !topMatchedViaTitle);

  if (eng.count === 0 && overrideEligible && ENGINEERING_FAMILIES.includes(top.family as any)) {
    return {
      family: 'non_engineering',
      confidence: 'high',
      passed: profile.acceptable_role_families.includes('non_engineering'),
      needs_review: false,
      reason: `keyword scorer picked ${top.family} on AI vocabulary alone, but zero engineering-responsibility evidence found and non-engineering signals present (${[...nonEng.matched, ...(matchedKeywords['non_engineering'] || [])].join(', ')}) — reclassified as non_engineering`,
      evidence,
    };
  }

  const tied = scores.filter(s => s.count === top.count);
  const acceptable = tied.map(s => profile.acceptable_role_families.includes(s.family));
  const allAcceptable = acceptable.every(Boolean);
  const noneAcceptable = acceptable.every(a => !a);

  let result: RoleFamilyGateResult;

  if (tied.length === 1) {
    // Outright winner — no ambiguity at all.
    result = {
      family: top.family,
      confidence: 'high',
      passed: profile.acceptable_role_families.includes(top.family),
      needs_review: false,
      reason: profile.acceptable_role_families.includes(top.family)
        ? `classified as ${top.family} (high confidence) — within acceptable role families`
        : `classified as ${top.family} (high confidence) — outside acceptable role families [${profile.acceptable_role_families.join(', ')}]`,
      evidence,
    };
  } else {
    const tiedNames = tied.map(t => t.family).join(', ');

    if (allAcceptable) {
      // The label is ambiguous, but every candidate is acceptable — the tie
      // can't change the outcome, so this doesn't need a human to resolve it.
      result = {
        family: top.family,
        confidence: 'medium',
        passed: true,
        needs_review: false,
        reason: `tied between ${tiedNames} — all acceptable, so admitted regardless of which is correct`,
        evidence,
      };
    } else if (noneAcceptable) {
      // Same logic in the other direction: every tied candidate is out of
      // scope, so the tie doesn't need a human to resolve it either.
      result = {
        family: top.family,
        confidence: 'medium',
        passed: false,
        needs_review: false,
        reason: `tied between ${tiedNames} — none acceptable, so rejected regardless of which is correct`,
        evidence,
      };
    } else {
      // The tie spans both an acceptable and a non-acceptable family — this
      // is the genuinely consequential case. Never auto-reject; pass
      // provisionally and surface it for a human to resolve.
      result = {
        family: top.family,
        confidence: 'low',
        passed: true,
        needs_review: true,
        reason: `tied between ${tiedNames} — acceptability differs between them, passed provisionally and flagged for review`,
        evidence,
      };
    }
  }

  // Note: the old post-hoc "mixed signal" downgrade that used to run here
  // is now handled upfront by the `eng.count > 0` branch above (which runs
  // before this fallback path even applies), so eng.count is always 0 by
  // the time execution reaches here — no further downgrade is needed.
  return result;
}
