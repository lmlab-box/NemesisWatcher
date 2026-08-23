import * as exevopan from './exevopan.js';
import * as guildstats from './guildstats.js';
import * as tibiastatistic from './tibiastatistic.js';
import * as tibiabossespl from './tibiabossespl.js';
import * as tibiaboss from './tibiaboss.js';

export const EXTERNAL_SOURCES = [exevopan, guildstats, tibiastatistic, tibiabossespl, tibiaboss];

/**
 * Fetches every third-party opinion in parallel. A source that breaks — layout change,
 * outage, Cloudflare — is reported as failed and simply drops out of the consensus;
 * it never aborts the run, because our own model is the part that must always work.
 */
export async function fetchExternalSources() {
  const settled = await Promise.allSettled(
    EXTERNAL_SOURCES.map(async (source) => ({ ...(await source.fetchSource()), source })),
  );

  return EXTERNAL_SOURCES.map((source, i) => {
    const result = settled[i];
    if (result.status === 'fulfilled') {
      return { id: source.id, label: source.label, url: source.url, ok: true, entries: result.value.entries, updatedAt: result.value.updatedAt };
    }
    return { id: source.id, label: source.label, url: source.url, ok: false, entries: new Map(), error: result.reason?.message ?? String(result.reason) };
  });
}
