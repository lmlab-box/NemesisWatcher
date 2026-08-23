import { HTTP } from './config.js';
import { mapLimit } from './lib/http.js';
import { dayRange } from './lib/dates.js';
import { extractDailyKills, fetchArchivedDay, earliestArchivedDay } from './sources/killstats.js';
import { applyDay } from './history.js';

/**
 * Rebuilds the appearance history from the public daily archive of tibia.com kill
 * statistics. Days already covered are skipped, so this is cheap to re-run and can be
 * used to extend the window backwards later.
 */
export async function backfill({ history, bossList, from, to, onProgress = () => {} }) {
  const start = from < earliestArchivedDay ? earliestArchivedDay : from;
  const days = dayRange(start, to);

  let fetched = 0;
  let missing = 0;

  const snapshots = await mapLimit(days, HTTP.concurrency, async (day) => {
    const raw = await fetchArchivedDay(day);
    if (!raw) {
      missing++;
      onProgress({ day, ok: false, done: ++fetched, total: days.length });
      return null;
    }
    const kills = extractDailyKills(raw);
    onProgress({ day, ok: true, done: ++fetched, total: days.length, entries: kills.size });
    return { day, kills };
  });

  // Apply in chronological order so appearance arrays stay sorted as they are built.
  for (const snapshot of snapshots) {
    if (snapshot) applyDay(history, snapshot.day, snapshot.kills, bossList.byKillStatsName);
  }

  return { days: days.length, missing, from: start, to };
}
