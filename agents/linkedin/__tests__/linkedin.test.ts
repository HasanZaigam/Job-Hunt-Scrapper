// Run: cd agents && npx ts-node linkedin/__tests__/linkedin.test.ts
import assert from 'assert';
import baseResume from '../../resume-generator/base-resume.json';
import {
  factsOf,
  parseJson,
  numbersNotInFacts,
  validatePost,
  validateOutreach,
  buildScorecard,
  buildPostPrompt,
  CONNECTION_NOTE_MAX,
} from '../lib';
import { generateValidated, makePosts, makeOutreach } from '../index';

const facts = factsOf(baseResume);
const tests: Record<string, () => void | Promise<void>> = {};

tests['facts keep real numbers and drop contact details'] = () => {
  assert(facts.includes('10,000+'));
  assert(!facts.includes('96167'), 'phone must not reach the model');
  assert(!facts.includes('@gmail.com'), 'email must not reach the model');
};

tests['parseJson strips code fences'] = () => {
  assert.deepStrictEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => parseJson('not json'));
};

tests['numbers: facts numbers pass, invented ones are caught'] = () => {
  assert.deepStrictEqual(numbersNotInFacts('Served 10,000+ concurrent users', facts), []);
  assert.deepStrictEqual(numbersNotInFacts('I learned 3 things', facts), []);
  assert.deepStrictEqual(numbersNotInFacts('Cut latency by 40%', facts), ['40%']);
  assert.deepStrictEqual(numbersNotInFacts('Managed 200 clients', facts), ['200']);
};

const goodBody = 'Short paragraph about a FastAPI service and Redis queues. '.repeat(10).slice(0, 700);

tests['validatePost accepts a clean post'] = () => {
  assert.deepStrictEqual(validatePost({ day: 'Tue', hook: 'What I learned', body: goodBody, hashtags: ['#AI'] }, facts), []);
};

tests['validatePost rejects filler, long bodies, invented numbers, too many tags'] = () => {
  const bad = validatePost(
    { day: 'Tue', hook: 'x', body: 'I am excited to announce 75% faster ' + goodBody, hashtags: ['#a', '#b', '#c', '#d', '#e'] },
    facts
  );
  assert(bad.some((p) => p.includes('banned phrase')));
  assert(bad.some((p) => p.includes('numbers not in facts')));
  assert(bad.some((p) => p.includes('hashtags')));
  assert(validatePost({ day: 'Tue', hook: 'x', body: 'y'.repeat(2000), hashtags: [] }, facts).some((p) => p.includes('too long')));
};

tests['validateOutreach enforces note length'] = () => {
  const long = 'a'.repeat(CONNECTION_NOTE_MAX + 1);
  assert(validateOutreach({ connection_note: long, followup: 'ok' }, facts).length > 0);
  assert.deepStrictEqual(validateOutreach({ connection_note: 'Hi, applied for the AI role.', followup: 'Thanks.' }, facts), []);
};

tests['scorecard shows pace and the review warning'] = () => {
  const goal = { deadline: '2027-01-13', weeklyApplications: 15, weeklyOutreach: 10, weeklyPosts: 3 };
  const msg = buildScorecard({ today: new Date('2026-10-13'), goal, appliedLast7Days: 9, appliedTotal: 25, interviews: 0, offers: 0, matchedWaiting: 12 });
  assert(msg.includes('6 short of target'));
  assert(msg.includes('92 days'));
  assert(msg.includes('review resume'));
};

tests['prompt carries facts and feeds problems back'] = () => {
  const p = buildPostPrompt(facts, '2026-10-12', ['post 1: body too short']);
  assert(p.includes('Applore Technologies'));
  assert(p.includes('body too short'));
};

tests['generateValidated retries once with the problems, then stops'] = async () => {
  const prompts: string[] = [];
  const outputs = [
    JSON.stringify({ connection_note: 'a'.repeat(400), followup: 'ok' }),
    JSON.stringify({ connection_note: 'Hi, I applied for the role.', followup: 'Thanks for your time.' }),
  ];
  const r = await makeOutreach(facts, { company: 'Acme', role: 'AI Engineer' }, async (prompt) => {
    prompts.push(prompt);
    return outputs[prompts.length - 1];
  });
  assert.strictEqual(prompts.length, 2);
  assert(prompts[1].includes('connection_note must be'));
  assert.deepStrictEqual(r.problems, []);
};

tests['makePosts reports problems instead of throwing when the model keeps failing'] = async () => {
  const bad = JSON.stringify([{ day: 'Tue', hook: 'x', body: 'short', hashtags: [] }]);
  const r = await makePosts(facts, '2026-10-12', async () => bad);
  assert(r.problems.length > 0);
};

(async () => {
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try {
      await fn();
      console.log('PASS', name);
    } catch (e: any) {
      failed++;
      console.log('FAIL', name, '-', e?.message);
    }
  }
  if (failed) process.exit(1);
  console.log(`\n${Object.keys(tests).length} tests passed`);
})();

void generateValidated; // exported helper, exercised through makeOutreach
