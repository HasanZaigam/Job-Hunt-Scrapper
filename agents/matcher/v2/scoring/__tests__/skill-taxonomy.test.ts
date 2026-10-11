import assert from 'assert';
import { classifySkillRelationship } from '../skill-taxonomy';

type Test = () => void;
const tests: Record<string, Test> = {};

// --- exact ---
tests['identical strings classify as exact'] = () => {
  assert.strictEqual(classifySkillRelationship('Python', 'Python'), 'exact');
};
tests['alias of the same taxonomy leaf classifies as exact'] = () => {
  assert.strictEqual(classifySkillRelationship('Gemini API', 'gemini'), 'exact');
};
tests['identical non-AI phrases still classify as exact'] = () => {
  assert.strictEqual(classifySkillRelationship('REST APIs', 'REST APIs'), 'exact');
};

// --- CTO P0 #2 required regression cases: alias/token matching, no substring containment ---

tests['REGRESSION: Postgres <-> PostgreSQL -> exact (curated alias)'] = () => {
  assert.strictEqual(classifySkillRelationship('Postgres', 'PostgreSQL'), 'exact');
  assert.strictEqual(classifySkillRelationship('PostgreSQL', 'Postgres'), 'exact');
};

tests['REGRESSION: JS <-> JavaScript -> exact (curated alias)'] = () => {
  assert.strictEqual(classifySkillRelationship('JS', 'JavaScript'), 'exact');
};

tests['REGRESSION: TS <-> TypeScript -> exact (curated alias)'] = () => {
  assert.strictEqual(classifySkillRelationship('TS', 'TypeScript'), 'exact');
};

tests['REGRESSION: MCP servers <-> MCP -> exact (phrase-boundary token match)'] = () => {
  assert.strictEqual(classifySkillRelationship('MCP servers', 'MCP'), 'exact');
};

tests['REGRESSION: Go <-> Django -> missing (the exact false-positive bug this fix targets)'] = () => {
  assert.strictEqual(classifySkillRelationship('Go', 'Django'), 'missing');
};

tests['REGRESSION: SQL <-> PostgreSQL -> missing (generic language != specific database)'] = () => {
  assert.strictEqual(classifySkillRelationship('SQL', 'PostgreSQL'), 'missing');
};

tests['REGRESSION: SQL <-> MySQL -> missing'] = () => {
  assert.strictEqual(classifySkillRelationship('SQL', 'MySQL'), 'missing');
};

tests['multi-word required phrase still finds a whole-token match ("Git/GitHub" required vs candidate "Git")'] = () => {
  assert.strictEqual(classifySkillRelationship('Git/GitHub', 'Git'), 'exact');
};

// --- strong_semantic ---
tests['two leaves in the SAME subgroup are strong_semantic (Gemini API vs OpenAI API)'] = () => {
  assert.strictEqual(classifySkillRelationship('Gemini API', 'OpenAI API'), 'strong_semantic');
};
tests['generic umbrella term vs a specific leaf is strong_semantic (GenAI vs LangChain)'] = () => {
  assert.strictEqual(classifySkillRelationship('GenAI', 'LangChain'), 'strong_semantic');
};

// --- required named regression cases from the audit ---
tests['REGRESSION: GenAI (required) vs LLM Integration (candidate evidence) -> strong_semantic'] = () => {
  assert.strictEqual(classifySkillRelationship('GenAI', 'LLM Integration'), 'strong_semantic');
};
tests['REGRESSION: LLMs (required, plural) vs LLM Integration (candidate evidence) -> strong_semantic'] = () => {
  assert.strictEqual(classifySkillRelationship('LLMs', 'LLM Integration'), 'strong_semantic');
};

// --- related ---
tests['two leaves in DIFFERENT subgroups are related, not strong_semantic (Gemini API vs LangChain)'] = () => {
  assert.strictEqual(classifySkillRelationship('Gemini API', 'LangChain'), 'related');
};
tests['RAG vs Vector Databases are related, not strong_semantic (different subgroups)'] = () => {
  assert.strictEqual(classifySkillRelationship('RAG', 'Vector Databases'), 'related');
};

// --- anti-inflation: unrelated AI technologies must NOT get strong_semantic
//     credit merely for being in the broad AI/LLM ecosystem ---
tests['ANTI-INFLATION: GenAI, LangChain, RAG, Gemini API, Vector Database are pairwise related at best (never all equivalent)'] = () => {
  const items = ['LangChain', 'RAG', 'Gemini API', 'Vector Databases'];
  for (const a of items) {
    for (const b of items) {
      if (a === b) continue;
      const strength = classifySkillRelationship(a, b);
      assert.notStrictEqual(strength, 'exact', `${a} vs ${b} must not be exact`);
      assert.notStrictEqual(strength, 'strong_semantic', `${a} vs ${b} must not be strong_semantic — different subgroups, not defensible as equivalent`);
    }
  }
};
tests['ANTI-INFLATION: LangChain (Orchestration) vs Embeddings (Retrieval) is related, not strong_semantic'] = () => {
  assert.strictEqual(classifySkillRelationship('LangChain', 'Embeddings'), 'related');
};

// --- missing ---
tests['no relationship at all classifies as missing (RAG vs Docker)'] = () => {
  assert.strictEqual(classifySkillRelationship('RAG', 'Docker'), 'missing');
};
tests['unrelated non-AI skills classify as missing (Swift vs Python)'] = () => {
  assert.strictEqual(classifySkillRelationship('Swift', 'Python'), 'missing');
};

export function run(): { name: string; passed: boolean; error?: string }[] {
  return Object.entries(tests).map(([name, fn]) => {
    try {
      fn();
      return { name, passed: true };
    } catch (err: any) {
      return { name, passed: false, error: err?.message || String(err) };
    }
  });
}
