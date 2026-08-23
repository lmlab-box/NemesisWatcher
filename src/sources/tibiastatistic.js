import { get } from '../lib/http.js';
import { WORLD_SLUG } from '../config.js';
import { normalizeName } from '../lib/names.js';

export const id = 'tibiastatistic';
export const label = 'TibiaStatistic';
export const url = `https://www.tibia-statistic.com/bosshunter/details/${WORLD_SLUG}`;

const CHANCE_ORDER = { nochance: 0, lowchance: 0.05, mediumchance: 0.2, highchance: 0.35 };

/** Rows carry their state in data-* attributes, which is far more stable than cell order. */
export async function fetchSource() {
  const html = await get(url);
  const entries = new Map();

  for (const row of html.matchAll(/<tr\b([^>]*class="[^"]*boss-row[^"]*"[^>]*)>([\s\S]*?)<\/tr>/g)) {
    const attrs = row[1];
    const body = row[2];
    const key = attrs.match(/data-boss-key="([^"]*)"/)?.[1];
    if (!key) continue;

    const label = attrs.match(/data-chance="([^"]*)"/)?.[1] ?? null;
    const percent = body.match(/chance-percentage[^>]*>\s*\((\d+(?:\.\d+)?)%\)/);
    const lastSeen = body.match(/(\d{4}-\d{2}-\d{2})\s*\(/)?.[1] ?? null;
    const daysAgo = body.match(/days-text[^>]*>\s*(\d+)\s*days? ago/)?.[1];

    entries.set(normalizeName(key), {
      chance: percent ? Number(percent[1]) / 100 : (CHANCE_ORDER[label] ?? null),
      label,
      lastSeen,
      daysSince: daysAgo ? Number(daysAgo) : null,
      category: attrs.match(/data-category="([^"]*)"/)?.[1] ?? null,
    });
  }

  if (entries.size === 0) throw new Error('no boss rows found');
  return { entries, updatedAt: null };
}
