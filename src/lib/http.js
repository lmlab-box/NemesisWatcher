import { HTTP } from '../config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch() with a timeout, bounded retries and a polite User-Agent.
 * Retries on network errors and on 429/5xx; 4xx other than 429 fail immediately.
 */
export async function get(url, { as = 'text', headers = {}, retries = HTTP.retries } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': HTTP.userAgent, accept: '*/*', ...headers },
      });
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        lastError = new Error(`HTTP ${res.status} for ${url}`);
        if (!retryable) throw lastError;
        continue;
      }
      return as === 'json' ? await res.json() : await res.text();
    } catch (err) {
      lastError = err;
      if (err?.message?.startsWith('HTTP 4')) throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error(`failed to fetch ${url}`);
}

/** Runs tasks with a fixed concurrency ceiling, preserving input order in the result. */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
