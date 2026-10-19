// Run: cd agents && npx ts-node scraper/__tests__/retry.test.ts
// fetchJsonRetry is used by greenhouse/lever/ashby/remote-boards now — this
// exercises it against a real local HTTP server (no fetch mocking) so the
// retry-on-5xx / no-retry-on-404 / never-throws contract is verified for real.
import assert from 'assert';
import http from 'http';
import { fetchJsonRetry } from '../retry';

function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, () => {
      const port = (server.address() as any).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise(r => server.close(() => r())),
      });
    });
  });
}

(async () => {
  // 1) Two 500s then a 200 — should retry and eventually return the JSON body.
  {
    let hits = 0;
    const { url, close } = await startServer((_req, res) => {
      hits++;
      if (hits < 3) { res.writeHead(500); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, hits }));
    });
    const data = await fetchJsonRetry(url, 'test-500-then-200', {}, 3, 10);
    assert.deepStrictEqual(data, { ok: true, hits: 3 });
    assert.strictEqual(hits, 3);
    await close();
    console.log('PASS retries 500s then returns the eventual 200 JSON body');
  }

  // 2) A 404 is not retried — one request only, and the function returns null, not a throw.
  {
    let hits = 0;
    const { url, close } = await startServer((_req, res) => { hits++; res.writeHead(404); res.end(); });
    const data = await fetchJsonRetry(url, 'test-404', {}, 3, 10);
    assert.strictEqual(data, null);
    assert.strictEqual(hits, 1);
    await close();
    console.log('PASS does not retry a 404 and returns null');
  }

  // 3) Exhausting retries on persistent 500s returns null, never throws.
  {
    let hits = 0;
    const { url, close } = await startServer((_req, res) => { hits++; res.writeHead(503); res.end(); });
    const data = await fetchJsonRetry(url, 'test-exhausted', {}, 3, 10);
    assert.strictEqual(data, null);
    assert.strictEqual(hits, 3);
    await close();
    console.log('PASS never throws — returns null once retries are exhausted');
  }

  // 4) A connection that just refuses (no server) also resolves to null, not a throw.
  {
    const data = await fetchJsonRetry('http://127.0.0.1:1/unreachable', 'test-unreachable', {}, 2, 10);
    assert.strictEqual(data, null);
    console.log('PASS a network error (connection refused) resolves to null');
  }

  console.log('\n4 tests passed');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
