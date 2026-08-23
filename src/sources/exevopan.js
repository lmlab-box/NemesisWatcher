import { get } from '../lib/http.js';
import { WORLD } from '../config.js';
import { normalizeName } from '../lib/names.js';

export const id = 'exevopan';
export const label = 'ExevoPan';
export const url = `https://www.exevopan.com/bosses/${WORLD}`;

/**
 * Next.js page: the whole dataset is server-rendered into __NEXT_DATA__ as
 * props.pageProps.bossChances = { server, lastUpdated, bosses: [{ name, lastAppearence, currentChance }] }.
 * lastAppearence is epoch milliseconds; currentChance is already 0..1.
 */
export async function fetchSource() {
  const html = await get(url);
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('__NEXT_DATA__ not found');

  const chances = JSON.parse(match[1])?.props?.pageProps?.bossChances;
  if (!chances?.bosses) throw new Error('bossChances missing from page props');

  const entries = new Map();
  for (const boss of chances.bosses) {
    if (!boss?.name) continue;
    entries.set(normalizeName(boss.name), {
      chance: typeof boss.currentChance === 'number' ? boss.currentChance : null,
      lastSeen: boss.lastAppearence ? new Date(boss.lastAppearence).toISOString().slice(0, 10) : null,
    });
  }
  return { entries, updatedAt: chances.lastUpdated ? new Date(chances.lastUpdated).toISOString() : null };
}
