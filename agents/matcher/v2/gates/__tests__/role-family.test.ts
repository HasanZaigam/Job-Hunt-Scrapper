import assert from 'assert';
import { classifyRoleFamily, evaluateRoleFamilyGate } from '../role-family';
import type { RoleFamilyProfile } from '../../types';

const PROFILE: RoleFamilyProfile = {
  acceptable_role_families: ['ai_ml_engineer', 'genai_applied', 'backend_engineer'],
};

type Test = () => void;
const tests: Record<string, Test> = {};

tests['"Backend Engineer" title classifies as backend_engineer, high confidence'] = () => {
  const { family, confidence } = classifyRoleFamily('Backend Engineer', 'Build APIs and services.');
  assert.strictEqual(family, 'backend_engineer');
  assert.strictEqual(confidence, 'high');
};

tests['"AI Safety Researcher" classifies as data_scientist, not the candidate\'s acceptable families'] = () => {
  const result = evaluateRoleFamilyGate('AI Safety Researcher', 'PhD-level alignment research required.', PROFILE);
  assert.strictEqual(result.family, 'data_scientist');
  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.needs_review, false);
};

tests['"DevOps Engineer" classifies as devops_infra and is rejected on role_family alone'] = () => {
  const result = evaluateRoleFamilyGate('DevOps Engineer', 'Manage Kubernetes and CI/CD pipelines.', PROFILE);
  assert.strictEqual(result.family, 'devops_infra');
  assert.strictEqual(result.passed, false);
};

tests['tie between two acceptable families passes without needs_review (does not affect outcome)'] = () => {
  // "AI Software Engineer" ties ai_ml_engineer (title) against genai_applied (genai + llm in body).
  const result = evaluateRoleFamilyGate(
    'AI Software Engineer',
    'Build GenAI features using LLM APIs.',
    PROFILE
  );
  assert.strictEqual(result.confidence, 'medium');
  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.needs_review, false, 'a tie between two acceptable families must not need review');
};

tests['tie between an acceptable and a non-acceptable family is low confidence and flagged, never auto-rejected'] = () => {
  // Construct a JD that ties backend_engineer (acceptable) against devops_infra (not acceptable):
  // "backend engineer" title match (+2) vs two devops_infra body mentions ("devops", "site reliability") (+1 each = 2).
  const result = evaluateRoleFamilyGate(
    'Backend Engineer',
    'This backend engineer role also covers devops and site reliability duties.',
    PROFILE
  );
  assert.strictEqual(result.confidence, 'low');
  assert.strictEqual(result.passed, true, 'low-confidence ties must pass provisionally, never auto-reject');
  assert.strictEqual(result.needs_review, true);
};

tests['zero keyword hits anywhere classifies as unknown, passes provisionally with needs_review'] = () => {
  const result = evaluateRoleFamilyGate('Team Member', 'Join our growing organization and make an impact.', PROFILE);
  assert.strictEqual(result.family, 'unknown');
  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.needs_review, true);
};

tests['non_engineering titles (e.g. Product Manager) are rejected, not silently admitted'] = () => {
  const result = evaluateRoleFamilyGate('Product Manager, AI Platform', 'Own the roadmap for our GenAI product.', PROFILE);
  assert.strictEqual(result.passed, false);
};

// --- CTO P0/P1 #3 required regression fixtures ---

tests['FIXTURE: "AI Engineer" with real engineering language passes'] = () => {
  const result = evaluateRoleFamilyGate(
    'AI Engineer',
    'You will build and maintain machine learning models and backend APIs for our platform.',
    PROFILE
  );
  assert.strictEqual(result.passed, true);
};

tests['FIXTURE: "AI Software Engineer" passes'] = () => {
  const result = evaluateRoleFamilyGate('AI Software Engineer', 'Build GenAI features using LLM APIs.', PROFILE);
  assert.strictEqual(result.passed, true);
};

tests['FIXTURE: "ML Engineer" with pipeline/API language passes'] = () => {
  const result = evaluateRoleFamilyGate('ML Engineer', 'Build and maintain production ML pipelines and APIs.', PROFILE);
  assert.strictEqual(result.passed, true);
};

tests['FIXTURE: "Backend Engineer" with design/develop language passes'] = () => {
  const result = evaluateRoleFamilyGate('Backend Engineer', 'Design and develop backend APIs and microservices.', PROFILE);
  assert.strictEqual(result.passed, true);
};

tests['FIXTURE: generic "Software Engineer" with no family keyword -> unknown, passes provisionally with review'] = () => {
  const result = evaluateRoleFamilyGate('Software Engineer', 'Write production code and ship features for our platform.', PROFILE);
  assert.strictEqual(result.family, 'unknown');
  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.needs_review, true);
};

tests['FIXTURE: "AI Analyst" doing GenAI-branded reporting work is reclassified non_engineering, not admitted on AI vocabulary alone'] = () => {
  const result = evaluateRoleFamilyGate(
    'AI Analyst',
    'Use GenAI tools to build reporting dashboards for business stakeholders.',
    PROFILE
  );
  assert.strictEqual(result.family, 'non_engineering');
  assert.strictEqual(result.passed, false);
};

tests['FIXTURE: "Senior Data and AI Specialist / RevOps" is reclassified non_engineering — the real-world false positive this hardening fixes'] = () => {
  const result = evaluateRoleFamilyGate(
    'Senior Data and AI Specialist',
    'Use Google Sheets, Airtable, and Zapier to manage RevOps workflows, leveraging LLMs and generative AI tools like OpenAI and Gemini API for data enrichment.',
    PROFILE
  );
  assert.strictEqual(result.family, 'non_engineering');
  assert.strictEqual(result.passed, false);
};

tests['FIXTURE: "AI Product Manager" is non_engineering, rejected'] = () => {
  const result = evaluateRoleFamilyGate('AI Product Manager', 'Own the product roadmap for our GenAI features.', PROFILE);
  assert.strictEqual(result.family, 'non_engineering');
  assert.strictEqual(result.passed, false);
};

tests['FIXTURE: "AI Solutions Architect" with genuinely mixed engineering + business signals is flagged needs_review, not confidently admitted'] = () => {
  const result = evaluateRoleFamilyGate(
    'AI Solutions Architect',
    'Design distributed systems and APIs for our GenAI platform, while working directly with customers on go-to-market strategy and stakeholder management.',
    PROFILE
  );
  assert.strictEqual(result.needs_review, true, 'mixed engineering + non-engineering signals must be flagged for review, not silently resolved either way');
};

// --- CTO final hardening pass: functional evidence must outrank incidental
// cross-functional vocabulary. Required regression fixtures. ---

tests['FIXTURE 1: ML Engineer + incidental product managers/designers mention -> remains engineering (the real Twilio bug)'] = () => {
  const result = evaluateRoleFamilyGate(
    'Machine Learning Engineer',
    'Build and maintain production ML systems using Python, Java, SQL, MLOps, LangChain, Docker, and Kubernetes. You will collaborate with product managers and designers on the roadmap.',
    PROFILE
  );
  assert.strictEqual(result.family, 'ai_ml_engineer');
  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.needs_review, false);
};

tests['FIXTURE 2: AI Engineer + incidental marketing mention -> remains engineering'] = () => {
  const result = evaluateRoleFamilyGate(
    'AI Engineer',
    'Design and develop GenAI-powered backend services. Familiarity with marketing use cases is a plus.',
    PROFILE
  );
  assert.strictEqual(result.passed, true);
  assert.notStrictEqual(result.family, 'non_engineering');
};

tests['FIXTURE 3: Backend Engineer + incidental sales mention -> remains engineering'] = () => {
  const result = evaluateRoleFamilyGate(
    'Backend Engineer',
    'Design and develop backend APIs and microservices that power our sales team\'s tools.',
    PROFILE
  );
  assert.strictEqual(result.passed, true);
  assert.notStrictEqual(result.family, 'non_engineering');
};

tests['FIXTURE 4: Software Engineer + "product roadmap" mention but real engineering signal dominates -> remains engineering'] = () => {
  const result = evaluateRoleFamilyGate(
    'Software Engineer',
    'Actively shipping production code for our app. Participate in product discussions to help shape the product roadmap.',
    PROFILE
  );
  assert.notStrictEqual(result.family, 'non_engineering');
  assert.strictEqual(result.passed, true);
};

tests['FIXTURE 5: iOS Engineer + "product team" mention -> remains engineering (mobile signals now recognized)'] = () => {
  const result = evaluateRoleFamilyGate(
    'Software Engineer, iOS',
    'Swift and SwiftUI development shipping production code for our iOS app. Work within a dedicated product team.',
    PROFILE
  );
  assert.notStrictEqual(result.family, 'non_engineering');
  assert.strictEqual(result.passed, true);
};

tests['FIXTURE 6: AI Product Manager -> non_engineering (unchanged, correctly rejected)'] = () => {
  const result = evaluateRoleFamilyGate('AI Product Manager', 'Own the product roadmap for our GenAI features.', PROFILE);
  assert.strictEqual(result.family, 'non_engineering');
  assert.strictEqual(result.passed, false);
};

tests['FIXTURE 7: RevOps / Data & AI Specialist -> non_engineering (unchanged, correctly rejected)'] = () => {
  const result = evaluateRoleFamilyGate(
    'Senior Data and AI Specialist',
    'Use Google Sheets, Airtable, and Zapier to manage RevOps workflows, leveraging LLMs and generative AI tools for data enrichment.',
    PROFILE
  );
  assert.strictEqual(result.family, 'non_engineering');
  assert.strictEqual(result.passed, false);
};

tests['FIXTURE 8: Marketing AI Specialist -> non_engineering'] = () => {
  const result = evaluateRoleFamilyGate(
    'Marketing AI Specialist',
    'Use GenAI and LLM tools to optimize marketing campaigns and customer acquisition funnels.',
    PROFILE
  );
  assert.strictEqual(result.family, 'non_engineering');
  assert.strictEqual(result.passed, false);
};

tests['FIXTURE 9: AI Program Manager -> non_engineering'] = () => {
  const result = evaluateRoleFamilyGate(
    'AI Program Manager',
    'Coordinate GenAI initiatives across teams, manage program timelines and stakeholder communication.',
    PROFILE
  );
  assert.strictEqual(result.family, 'non_engineering');
  assert.strictEqual(result.passed, false);
};

tests['REGRESSION: real Twilio "Machine Learning Engineer" JD text -> remains ai_ml_engineer/genai_applied, never non_engineering'] = () => {
  const result = evaluateRoleFamilyGate(
    'Machine Learning Engineer',
    `This is a hands-on, builder-focused engineering role. Design, implement, and maintain scalable, enterprise-grade ML solutions in production.
    Build reproducible ML workflows for data preparation, training, evaluation, and inference using modern orchestration and MLOps tooling.
    5+ years of experience building, deploying, and operating data and ML systems in production. Proficient in Python, Java, and SQL; strong software engineering fundamentals.
    Practical experience with LLMs and generative AI workflows, including foundation model fine-tuning, RAG, and vector databases.
    You will collaborate closely with a cross-functional team of engineers, architects, product managers, UI/UX designers, and ML/data science partners.
    Domain experience (plus) in communications, marketing automation, or customer engagement analytics.`,
    PROFILE
  );
  assert.notStrictEqual(result.family, 'non_engineering', `expected an engineering family, got ${result.family}`);
  assert.strictEqual(result.passed, true);
};

// --- Two bugs caught live during the 50-job real recall validation, fixed
// in this same hardening pass ---

tests['BUGFIX: bare "ios" signal must not match inside unrelated words ("various", "previous", "curious")'] = () => {
  const result = evaluateRoleFamilyGate(
    'Enterprise AI Strategist',
    'Coordinate GenAI initiatives across various teams, working with product managers and account executives on previous and curious use cases.',
    PROFILE
  );
  assert.strictEqual(result.family, 'non_engineering', `"ios" must not phantom-match inside "various"/"previous"/"curious" — got ${result.family}`);
};

tests['BUGFIX: a title-based engineering match (e.g. "Applied AI Engineer") is not overridden by boilerplate recruiter/designer mentions alone'] = () => {
  const result = evaluateRoleFamilyGate(
    'Applied AI Engineer, Agents & Automations',
    'Build LLM-powered agents and backend systems using RAG. Cohere is an equal opportunity employer; if contacted by a recruiter or asked to interview with a designer on our team, please verify official channels.',
    PROFILE
  );
  assert.notStrictEqual(result.family, 'non_engineering', `title-based "Applied AI Engineer" must not be overridden by EEO-boilerplate recruiter/designer mentions — got ${result.family}`);
  assert.strictEqual(result.passed, true);
};

tests['BUGFIX: a BODY-only (non-title) engineering pick can still be overridden by weak non-engineering evidence (RevOps case unaffected)'] = () => {
  const result = evaluateRoleFamilyGate(
    'Senior Data and AI Specialist',
    'Use Google Sheets, Airtable, and Zapier to manage RevOps workflows, leveraging LLMs and generative AI tools for data enrichment. Work with recruiters and designers on hiring.',
    PROFILE
  );
  assert.strictEqual(result.family, 'non_engineering', 'a body-only AI-vocab pick with no title-based engineering signal should still be overridable');
};

tests['TITLE: "AI Sales Engineer" is non_engineering and rejected even with heavy LLM/RAG vocabulary in the body'] = () => {
  const result = evaluateRoleFamilyGate(
    'AI Sales Engineer, (EMEA)',
    'Join our engineering team. You will demo our LLM, RAG and generative AI platform to prospects, partnering with the account executive on deals.',
    PROFILE
  );
  assert.strictEqual(result.family, 'non_engineering');
  assert.strictEqual(result.passed, false);
};

tests['TITLE: "AI Solutions Engineer" (a target title) is NOT caught by the sales-title rule'] = () => {
  const result = evaluateRoleFamilyGate('AI Solutions Engineer', 'Build LLM integrations and RAG pipelines for customers.', PROFILE);
  assert.notStrictEqual(result.family, 'non_engineering');
};

tests['KEYWORDS: "AI agent engineer" and "Agentic AI Engineer" classify as acceptable families'] = () => {
  for (const title of ['AI agent engineer', 'Agentic AI Engineer', 'AI Automation Engineer']) {
    const result = evaluateRoleFamilyGate(title, 'Build agents with tool calling.', PROFILE);
    assert.strictEqual(result.passed, true, `${title} -> ${result.family}`);
    assert.notStrictEqual(result.family, 'unknown', title);
  }
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
