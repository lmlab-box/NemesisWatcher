import { HTTP } from './config.js';
import { mapLimit } from './lib/http.js';
import { dayRange } from './lib/dates.js';
import { extractDailyActivity, fetchArchivedDay, earliestArchivedDay } from './sources/killstats.js';
import { applyDay } from './history.js';

/**
 * Rebuilds the appearance history from the public daily archive of tibia.com kill
 * statistics. Days already covered are skipped, so this is cheap to re-run and can be
 * used to extend the window backwards later.
 *
 * One known hole: the current archive starts on 2025-12-06 and the legacy one ends on
 * 2025-12-04, so 2025-12-05 is missing from both. A boss seen only that day is invisible
 * and one interval around it is a day long.
 */
export async function backfill({ history, bossList, from, to, onProgress = () => {} }) {
  const start = from < earliestArchivedDay ? earliestArchivedDay : from;
  const days = dayRange(start, to);

  let fetched = 0;
  let missing = 0;
  const missingDays = [];

  const snapshots = await mapLimit(days, HTTP.concurrency, async (day) => {
    const raw = await fetchArchivedDay(day);
    if (!raw) {
      missing++;
      missingDays.push(day);
      onProgress({ day, ok: false, done: ++fetched, total: days.length });
      return null;
    }
    const activity = extractDailyActivity(raw);
    onProgress({ day, ok: true, done: ++fetched, total: days.length, entries: activity.size });
    return { day, activity };
  });

  // Apply in chronological order so appearance arrays stay sorted as they are built.
  for (const snapshot of snapshots) {
    if (snapshot) applyDay(history, snapshot.day, snapshot.activity, bossList.byKillStatsName);
  }

  return { days: days.length, missing, missingDays, from: start, to };
}
