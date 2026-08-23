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
 * Reads one day of kill statistics.
 *
 * Two counters matter, and both are evidence that the boss was in the world that day:
 *
 *   last_day_killed         players killed the boss
 *   last_day_players_killed the boss killed players
 *
 * The second one is what makes this worth doing. On 2026-08-13 Havera's kill statistics
 * showed Gaz'haragoth with 6 players killed and 0 deaths — it spawned, wiped a team and
 * walked away. Counting only deaths loses exactly the appearances of the bosses that are
 * hardest to kill, which are the ones worth hunting.
 *
 * Presence in the list is *not* evidence for the day: a race stays listed for a week on
 * its last_week counters, with both last_day counters at zero.
 *
 * @returns {Map<string, {killed: number, playersKilled: number}>} keyed by raw race name
 */
export function extractDailyActivity(rawJson) {
  const activity = new Map();
  ENTRY_RE.lastIndex = 0;
  let match;
  while ((match = ENTRY_RE.exec(rawJson)) !== null) {
    const playersKilled = Number(match[2]);
    const killed = Number(match[3]);
    if (killed === 0 && playersKilled === 0) continue;

    let name = match[1];
    if (name.includes('\\')) {
      // Only reached if tibia.com ever ships a name with a JSON escape in it.
      try {
        name = JSON.parse(`"${name}"`);
      } catch {
        /* keep the raw form rather than dropping the entry */
      }
    }
    activity.set(name, { killed, playersKilled });
  }
  return activity;
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
