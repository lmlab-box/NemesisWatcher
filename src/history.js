import { WORLD } from './config.js';
import { daysBetween } from './lib/dates.js';

/**
 * Bump this whenever the recorded shape or the recording rule changes. `src/index.js`
 * discards a history built under an older version and rebuilds it from the archive,
 * so an improvement to the rule reaches the whole history instead of only new days.
 *
 * 1 — appearances recorded only when the boss was killed
 * 2 — appearances also recorded when the boss killed players without dying
 */
export const SCHEMA_VERSION = 2;

/**
 * Pure history logic. All filesystem access lives in store.js so that this module —
 * and everything downstream of it — can be exercised outside Node.
 */
export function emptyHistory() {
  return {
    world: WORLD,
    schemaVersion: SCHEMA_VERSION,
    updatedAt: null,
    coverage: { from: null, to: null, days: 0 },
    bosses: {},
  };
}

/**
 * Records one killstats day into the history. Idempotent: re-applying a day that is
 * already recorded changes nothing, so a re-run or a manual dispatch is safe.
 *
 * `appearances` holds every day the boss was seen in the world; `killedOn` is the subset
 * of those days on which it actually died. A boss whose latest appearance is not in
 * `killedOn` was last seen alive and may still be up.
 *
 * @param {Map<string,{killed:number,playersKilled:number}>} activity keyed by raw race name
 * @param {Map<string,string>} byKillStatsName raw name -> pretty name
 */
export function applyDay(history, day, activity, byKillStatsName) {
  const seen = new Map();
  for (const [rawName, counters] of activity) {
    const name = byKillStatsName.get(rawName);
    if (!name) continue;
    if (counters.killed <= 0 && counters.playersKilled <= 0) continue;

    seen.set(name, counters);
    const entry = (history.bosses[name] ??= { appearances: [], killedOn: [] });
    entry.killedOn ??= [];

    if (!entry.appearances.includes(day)) {
      entry.appearances.push(day);
      entry.appearances.sort();
    }
    if (counters.killed > 0 && !entry.killedOn.includes(day)) {
      entry.killedOn.push(day);
      entry.killedOn.sort();
    }
  }

  const { coverage } = history;
  coverage.from = coverage.from && coverage.from < day ? coverage.from : day;
  coverage.to = coverage.to && coverage.to > day ? coverage.to : day;
  coverage.days = daysBetween(coverage.from, coverage.to) + 1;
  history.updatedAt = new Date().toISOString();
  history.schemaVersion = SCHEMA_VERSION;
  return seen;
}

/** True when the day is already inside the recorded coverage window. */
export function hasDay(history, day) {
  const { from, to } = history.coverage;
  return Boolean(from && to && day >= from && day <= to);
}
