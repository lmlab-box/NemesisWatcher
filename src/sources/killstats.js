import { get } from '../lib/http.js';
import { ARCHIVES, TIBIADATA_URL, WORLD_SLUG } from '../config.js';

/**
 * Both the live TibiaData response and the archived files use the same shape, and both
 * are large (~220 KB). A single regex pass extracts every entry without building 1300
 * intermediate objects. The archive files are pretty-printed and the API response is
 * minified, hence the \s* between tokens.
 */
const ENTRY_RE =
  /"race"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"last_day_players_killed"\s*:\s*(\d+)\s*,\s*"last_day_killed"\s*:\s*(\d+)/g;

/**
 * A boss only appears in the Kill Statistics list when it was killed at least once in
 * the last seven days — entries with all four counters at zero are dropped by tibia.com
 * (verified: zero such entries in a live response). So `last_day_killed > 0` means the
 * boss was killed during the killstats day that just closed.
 *
 * @returns {Map<string, number>} raw killstats race name -> kills during that day
 */
export function extractDailyKills(rawJson) {
  const kills = new Map();
  ENTRY_RE.lastIndex = 0;
  let match;
  while ((match = ENTRY_RE.exec(rawJson)) !== null) {
    const killed = Number(match[3]);
    if (killed === 0) continue;
    let name = match[1];
    if (name.includes('\\')) {
      // Only reached if tibia.com ever ships a name with a JSON escape in it.
      try {
        name = JSON.parse(`"${name}"`);
      } catch {
        /* keep the raw form rather than dropping the entry */
      }
    }
    kills.set(name, killed);
  }
  return kills;
}

/** Live snapshot of the killstats day that just closed. */
export async function fetchLive() {
  return get(TIBIADATA_URL);
}

function archiveFor(day) {
  return ARCHIVES.find((a) => day >= a.from && (a.to === null || day <= a.to));
}

export function archiveUrl(day) {
  const archive = archiveFor(day);
  if (!archive) return null;
  return `https://raw.githubusercontent.com/${archive.repo}/${archive.branch}/data/${WORLD_SLUG}/${day}.json`;
}

/** Archived snapshot for a killstats day, or null when that day is not covered. */
export async function fetchArchivedDay(day) {
  const url = archiveUrl(day);
  if (!url) return null;
  try {
    return await get(url, { retries: 1 });
  } catch {
    return null; // a missing day must not abort a backfill
  }
}

export const earliestArchivedDay = ARCHIVES.reduce(
  (min, a) => (a.from < min ? a.from : min),
  ARCHIVES[0].from,
);
