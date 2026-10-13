// Run: cd agents && npx ts-node scraper/__tests__/apify-retry.test.ts
import assert from 'assert';
import { withRetry } from '../apify-search';

const noSleep = async () => {};

(async () => {
  let calls = 0;
  const ok = await withRetry(async () => {
    calls++;
    if (calls < 3) throw new Error('read ECONNRESET');
    return 'done';
  }, 3, 0, noSleep);
  assert.strictEqual(ok, 'done');
  assert.strictEqual(calls, 3);
  console.log('PASS retries a reset connection until it works');

  calls = 0;
  await assert.rejects(
    withRetry(async () => { calls++; throw new Error('boom'); }, 3, 0, noSleep),
    /boom/
  );
  assert.strictEqual(calls, 3);
  console.log('PASS gives up after the last attempt and rethrows');

  console.log('\n2 tests passed');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
