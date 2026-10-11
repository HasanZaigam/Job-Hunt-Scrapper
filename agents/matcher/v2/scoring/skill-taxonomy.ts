// Small, curated AI/LLM skill taxonomy — deliberately NOT exhaustive.
// Scope: this taxonomy governs matching ONLY for AI/LLM-flavored skill
// terms. Non-AI skills (Python, PostgreSQL, Docker, ...) are unaffected —
// they still match via plain normalized substring containment, same as
// before this change.
//
// The core rule this file exists to enforce: AI/LLM technologies are NOT
// all interchangeable. "Gemini API", "LangChain", "RAG", and "Vector
// Databases" are four functionally different things that happen to share a
// broad category. Two skills only earn `strong_semantic` credit when they
// sit in the SAME subgroup (a defensible, specific relationship — e.g. two
// LLM provider APIs). Two skills in different subgroups (e.g. an LLM API
// vs. an orchestration framework) are `related` at best — adjacent, not
// equivalent. A generic umbrella term ("GenAI", "LLM") matched against any
// specific leaf technology is `strong_semantic`, because the umbrella term
// isn't a specific tool that could be confused with a different specific
// tool — any concrete AI/LLM evidence legitimately satisfies it.

export type MatchStrength = 'exact' | 'strong_semantic' | 'related' | 'missing';

interface TaxonomyLeaf {
  canonical: string;
  group: string;
  aliases: string[];
}

const LEAVES: TaxonomyLeaf[] = [
  { canonical: 'Gemini API', group: 'LLM APIs', aliases: ['gemini', 'google gemini api'] },
  { canonical: 'OpenAI API', group: 'LLM APIs', aliases: ['openai', 'gpt api', 'chatgpt api'] },
  { canonical: 'Anthropic API', group: 'LLM APIs', aliases: ['anthropic', 'claude api'] },

  { canonical: 'RAG', group: 'LLM Application', aliases: ['retrieval augmented generation', 'retrieval-augmented generation'] },
  { canonical: 'Agents', group: 'LLM Application', aliases: ['ai agents', 'agentic workflows', 'autonomous agents'] },
  { canonical: 'Prompt Engineering', group: 'LLM Application', aliases: ['prompt design'] },
  { canonical: 'Tool Calling', group: 'LLM Application', aliases: ['function calling', 'mcp', 'model context protocol'] },

  { canonical: 'LangChain', group: 'Orchestration', aliases: [] },
  { canonical: 'LangGraph', group: 'Orchestration', aliases: [] },

  { canonical: 'Vector Databases', group: 'Retrieval', aliases: ['vector database', 'vector db', 'vector store'] },
  { canonical: 'Embeddings', group: 'Retrieval', aliases: ['embedding models', 'text embeddings'] },
  { canonical: 'Hybrid Search', group: 'Retrieval', aliases: [] },
];

// Generic umbrella terms — NOT specific technologies. Matching one of these
// against any taxonomy leaf is `strong_semantic`, never `exact` (they name
// no specific tool) and never merely `related` (any concrete AI/LLM
// evidence genuinely satisfies a generic requirement like "GenAI").
const ROOT_ALIASES = [
  'ai', 'artificial intelligence', 'genai', 'generative ai',
  'llm', 'llms', 'large language models', 'llm integration', 'llm apis', 'ai/ml',
];

function norm(s: string): string {
  return (s || '').toLowerCase().trim();
}

function findLeaf(term: string): TaxonomyLeaf | null {
  const t = norm(term);
  // Exact match first (canonical or alias).
  for (const leaf of LEAVES) {
    if (norm(leaf.canonical) === t) return leaf;
    if (leaf.aliases.some(a => norm(a) === t)) return leaf;
  }
  // Phrase-boundary match — e.g. "MCP servers" contains the whole token
  // "mcp" (the Tool Calling alias), so it should resolve to that leaf even
  // though it isn't an exact string match.
  for (const leaf of LEAVES) {
    if (tokensMatchAsSubsequence(leaf.canonical, term)) return leaf;
    if (leaf.aliases.some(a => tokensMatchAsSubsequence(a, term))) return leaf;
  }
  return null;
}

function isRootAlias(term: string): boolean {
  return ROOT_ALIASES.includes(norm(term));
}

// Deterministic, non-AI skill matching (CTO P0 #2). Generic substring
// containment is banned — it produced real false positives like "Go"
// matching inside "Django" purely because the letters happen to co-occur.
// Replaced with two mechanisms only:
//   1. A small curated alias table for genuine synonyms of the SAME
//      technology (Postgres/PostgreSQL, JS/JavaScript, TS/TypeScript).
//   2. Whole-word, phrase-boundary matching: one side's word tokens must
//      appear as a contiguous subsequence of the other side's word tokens
//      (e.g. "Git" is a whole token inside "Git/GitHub"; "MCP" is a whole
//      token inside "MCP servers"). A token is never matched against a
//      mere substring of a different, longer word.
const ALIAS_GROUPS: string[][] = [
  ['postgres', 'postgresql'],
  ['js', 'javascript'],
  ['ts', 'typescript'],
  ['mongo', 'mongodb'],
  ['k8s', 'kubernetes'],
  ['py', 'python'],
];

function aliasGroupOf(term: string): string[] | null {
  const t = norm(term);
  return ALIAS_GROUPS.find(g => g.includes(t)) ?? null;
}

function tokenize(s: string): string[] {
  return norm(s).split(/[^a-z0-9+#.]+/).filter(Boolean);
}

function tokensMatchAsSubsequence(a: string, b: string): boolean {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  if (aTokens.length === 0 || bTokens.length === 0) return false;
  const [shorter, longer] = aTokens.length <= bTokens.length ? [aTokens, bTokens] : [bTokens, aTokens];
  for (let i = 0; i <= longer.length - shorter.length; i++) {
    if (shorter.every((tok, j) => longer[i + j] === tok)) return true;
  }
  return false;
}

function deterministicMatch(a: string, b: string): boolean {
  const an = norm(a);
  const bn = norm(b);
  if (an === bn) return true;

  const aGroup = aliasGroupOf(an);
  if (aGroup && aGroup.includes(bn)) return true;

  return tokensMatchAsSubsequence(a, b);
}

/**
 * Classify the relationship between one required/preferred skill and one
 * candidate-evidenced skill. Returns the single best applicable tier for
 * this pair — callers compare a requirement against every candidate skill
 * and keep the strongest result found across all of them.
 */
export function classifySkillRelationship(required: string, candidate: string): MatchStrength {
  const r = norm(required);
  const c = norm(candidate);

  // 1. Exact — identical, or same taxonomy leaf via alias.
  if (r === c) return 'exact';
  const rLeaf = findLeaf(required);
  const cLeaf = findLeaf(candidate);
  if (rLeaf && cLeaf && rLeaf.canonical === cLeaf.canonical) return 'exact';

  // 2. Generic umbrella term vs. any concrete taxonomy evidence (either
  //    direction) — a defensible strong match, not a specific-tool mixup.
  const rIsRoot = isRootAlias(required);
  const cIsRoot = isRootAlias(candidate);
  if (rIsRoot && cIsRoot) return 'strong_semantic';
  if (rIsRoot && cLeaf) return 'strong_semantic';
  if (cIsRoot && rLeaf) return 'strong_semantic';

  // 3. Same specific subgroup — e.g. two LLM provider APIs.
  if (rLeaf && cLeaf && rLeaf.group === cLeaf.group) return 'strong_semantic';

  // 4. Different subgroups within the taxonomy — adjacent, not equivalent.
  if (rLeaf && cLeaf) return 'related';

  // 5. Neither side is AI/LLM-flavored at all (e.g. "Python" vs
  //    "PostgreSQL") — deterministic alias/token matching, no substring
  //    containment (see deterministicMatch above).
  if (!rLeaf && !rIsRoot && !cLeaf && !cIsRoot) {
    return deterministicMatch(required, candidate) ? 'exact' : 'missing';
  }

  // 6. One side is AI/LLM-flavored (leaf or root) and the other genuinely
  //    isn't (e.g. required "RAG" vs candidate "Docker") — no defensible
  //    relationship.
  return 'missing';
}

/** Best match strength for `required` against the full candidate skill list. */
export function bestMatchStrength(required: string, candidateSkills: string[]): MatchStrength {
  const order: MatchStrength[] = ['exact', 'strong_semantic', 'related', 'missing'];
  let best: MatchStrength = 'missing';
  for (const c of candidateSkills) {
    const s = classifySkillRelationship(required, c);
    if (order.indexOf(s) < order.indexOf(best)) best = s;
    if (best === 'exact') break;
  }
  return best;
}

export function bestMatchingSkill(required: string, candidateSkills: string[]): { skill: string; strength: MatchStrength } | null {
  const order: MatchStrength[] = ['exact', 'strong_semantic', 'related', 'missing'];
  let best: { skill: string; strength: MatchStrength } | null = null;
  for (const c of candidateSkills) {
    const s = classifySkillRelationship(required, c);
    if (s === 'missing') continue;
    if (!best || order.indexOf(s) < order.indexOf(best.strength)) best = { skill: c, strength: s };
    if (best.strength === 'exact') break;
  }
  return best;
}
