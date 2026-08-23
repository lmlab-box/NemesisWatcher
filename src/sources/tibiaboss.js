import { get } from '../lib/http.js';
import { WORLD_SLUG } from '../config.js';
import { normalizeName } from '../lib/names.js';

export const id = 'tibiaboss';
export const label = 'TibiaBoss';
export const url = `https://www.tibiaboss.com/world/${WORLD_SLUG}`;

/** Statuses whose percentage the site itself does not stand behind. */
const UNUSABLE_STATUS = new Set(['STALE', 'NO DATA']);
const MIN_OBSERVATIONS = 3;

/**
 * Every card exposes its whole state as data-* attributes on the opening <article> tag.
 *
 * This site publishes a percentage even when it has a single observation to go on — it
 * rates Ferumbras at 13% off one sighting while every other source says 0% — so a
 * percentage is only accepted once it rests on a few observations and the row is not
 * marked stale.
 */
export async function fetchSource() {
  const html = await get(url);
  const entries = new Map();

  for (const card of html.matchAll(/<article\b([^>]*class="[^"]*boss-card[^"]*"[^>]*)>/g)) {
    const attrs = card[1];
    const attr = (name) => attrs.match(new RegExp(`data-${name}="([^"]*)"`))?.[1] ?? null;

    const name = attr('display-name') ?? attr('name');
    if (!name) continue;

    const status = attr('status');
    const chance = Number(attr('chance'));
    const days = Number(attr('days'));
    const observations = Number(attr('observations'));
    const trustworthy =
      Number.isFinite(chance) &&
      !UNUSABLE_STATUS.has(status) &&
      Number.isFinite(observations) &&
      observations >= MIN_OBSERVATIONS;

    entries.set(normalizeName(name), {
      chance: trustworthy ? chance / 100 : null,
      label: status,
      daysSince: Number.isFinite(days) ? days : null,
      observations: Number.isFinite(observations) ? observations : null,
    });
  }

  if (entries.size === 0) throw new Error('no boss cards found');
  return { entries, updatedAt: null };
}
