import { get } from '../lib/http.js';
import { WORLD } from '../config.js';
import { normalizeName } from '../lib/names.js';

export const id = 'guildstats';
export const label = 'GuildStats';
export const url = `https://guildstats.eu/bosses?world=${WORLD}`;

const stripTags = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The main table is plain server-rendered HTML. Columns are read by header name rather
 * than by position, so an added column upstream does not silently shift the parse.
 * GuildStats has archived kill statistics for every world since 2015 and is the source
 * TibiaWiki itself credits for its spawn-frequency analysis.
 */
export async function fetchSource() {
  const html = await get(url);

  const table = html.match(/<table[^>]*class="[^"]*sortable-table[^"]*"[^>]*>([\s\S]*?)<\/table>/);
  if (!table) throw new Error('bosses table not found');

  const headers = [...table[1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
    stripTags(m[1]).toLowerCase(),
  );
  const columnOf = (needle) => headers.findIndex((h) => h.includes(needle));
  const iName = columnOf('boss name');
  const iLastSeen = columnOf('last seen');
  const iPossibility = columnOf('possibility');
  const iExpected = columnOf('expected in');
  const iKilled = columnOf('yesterday killed');
  if (iName < 0) throw new Error('unexpected table layout');

  const entries = new Map();
  for (const row of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)];
    if (cells.length <= iName) continue;

    const name = stripTags(cells[iName][2]);
    if (!name) continue;

    const sortValue = (i) => {
      if (i < 0 || i >= cells.length) return null;
      const m = cells[i][1].match(/data-sort-value="([^"]*)"/);
      return m ? m[1] : null;
    };
    const text = (i) => (i >= 0 && i < cells.length ? stripTags(cells[i][2]) : '');

    const percent = text(iPossibility).match(/([\d.]+)\s*%/);
    const lastSeenEpoch = Number(sortValue(iLastSeen));
    const expected = text(iExpected).match(/(\d+)/); // the cell holds a bare day count, e.g. "3"

    entries.set(normalizeName(name), {
      chance: percent ? Number(percent[1]) / 100 : null,
      lastSeen: Number.isFinite(lastSeenEpoch) && lastSeenEpoch > 0
        ? new Date(lastSeenEpoch * 1000).toISOString().slice(0, 10)
        : null,
      expectedInDays: expected ? Number(expected[1]) : null,
      killedYesterday: Number(text(iKilled)) || 0,
    });
  }

  if (entries.size === 0) throw new Error('table parsed but no rows matched');
  return { entries, updatedAt: null };
}
