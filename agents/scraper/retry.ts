// Shared retry/backoff for scrape-time HTTP calls. Every fetcher must keep
// failing in isolation (one source down can't stop a run) — these helpers
// never throw past fetchJsonRetry: callers get null/[] back plus a
// console.warn, same contract every fetcher already had before retries existed.
import fetch from 'node-fetch';

/** Retry a flaky call (network reset, 429, 5xx). Throws the last error after `attempts`. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 1500,
  sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms))
): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < attempts) await sleep(baseDelayMs * i);
    }
  }
  throw last;
}

export class RetryableHttpError extends Error {}

/**
 * GET `url` as JSON with retry/backoff on 429 and 5xx (network errors retry
 * too, same as a 5xx). A genuine 4xx other than 429 is NOT retried — a
 * second attempt at a 404/401 can't succeed. Never throws: logs a warning
 * and returns null once retries are exhausted or on a non-retryable status.
 */
export async function fetchJsonRetry(
  url: string,
  label: string,
  init: Record<string, any> = {},
  attempts = 3,
  baseDelayMs = 1500
): Promise<any | null> {
  try {
    const res = await withRetry(async () => {
      const r = await fetch(url, init);
      if (r.status === 429 || r.status >= 500) throw new RetryableHttpError(`HTTP ${r.status}`);
      return r;
    }, attempts, baseDelayMs);
    if (!res.ok) {
      console.warn(`[fetch] ${label}: HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err: any) {
    console.warn(`[fetch] ${label}: ${err?.message ?? err}`);
    return null;
  }
}
