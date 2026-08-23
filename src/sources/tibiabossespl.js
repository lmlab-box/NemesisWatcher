import { get } from '../lib/http.js';
import { WORLD_SLUG } from '../config.js';
import { normalizeName } from '../lib/names.js';

export const id = 'tibiabossespl';
export const label = 'TibiaBosses.pl';
export const url = `https://tibiabosses.pl/${WORLD_SLUG}`;

const stripTags = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Cells are labelled with data-label, so they can be read by name. This site is the only
 * one that publishes an explicit "Minimum Waiting Days" per boss, which is a useful
 * independent check on the minimum interval our own model derives from the history.
 */
export async function fetchSource() {
  const html = await get(url);
  const entries = new Map();

  for (const row of html.matchAll(/<tr\b[^>]*data-id=['"]\d+['"][^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = new Map();
    for (const cell of row[1].matchAll(/<td\b[^>]*data-label=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/td>/g)) {
      cells.set(cell[1].toLowerCase(), cell[2]);
    }

    const name = stripTags(cells.get('name') ?? '');
    if (!name) continue;

    const statusHtml = cells.get('status') ?? '';
    // The "can spawn" tick is served as ok.gif; the cross is no.gif.
    const canSpawn = /ok\.gif/i.test(statusHtml) ? true : /no\.gif/i.test(statusHtml) ? false : null;
    const minDays = Number(stripTags(cells.get('minimum waiting days') ?? ''));
    const daysSince = Number(stripTags(cells.get('last seen days ago') ?? ''));

    entries.set(normalizeName(name), {
      // Binary signal only: the site says "can spawn" or "cannot", not a probability.
      chance: null,
      canSpawn,
      minDays: Number.isFinite(minDays) ? minDays : null,
      daysSince: Number.isFinite(daysSince) ? daysSince : null,
    });
  }

  if (entries.size === 0) throw new Error('no boss rows found');
  return { entries, updatedAt: null };
}
