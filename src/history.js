import { WORLD } from './config.js';
import { daysBetween } from './lib/dates.js';

/**
 * Bump this whenever the recorded shape or the recording rule changes. `hydrateHistory`
 * discards a history built under an older version, and `src/index.js` rebuilds it from
 * the archive, so an improvement to the rule reaches the whole history instead of only
 * the days from that point on.
 *
 * 1 — appearances recorded only when the boss was killed
 * 2 — appearances also recorded when the boss killed players without dying,
 *     and `killedOn` records which of those days it actually died
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
 * Turns whatever was on disk into a usable history, deciding whether it can be extended
 * or has to be thrown away and rebuilt.
 *
 * The version must be read from the stored object *before* any defaults are merged in.
 * Filling defaults first and spreading the stored data on top hides a missing
 * `schemaVersion` behind the current one, which silently keeps a stale history alive.
 *
 * The version alone is not enough, though: a file can carry the right number and still
 * hold data written under the old rule, which is exactly what happened when the bug above
 * stamped a schema-1 history as schema 2. So the shape is checked too — under this schema
 * every boss that has been seen carries a `killedOn` array, and a file where that is
 * missing is rebuilt no matter what version it claims.
 *
 * @param {object|null} stored parsed data/history.json, or null when absent
 */
export function hydrateHistory(stored, { force = false } = {}) {
  if (!stored || !stored.coverage?.from) {
    return { history: emptyHistory(), storedVersion: null, stale: false, reason: null };
  }

  if (force) {
    return { history: emptyHistory(), storedVersion: stored.schemaVersion ?? 1, stale: true, reason: 'rebuild requested' };
  }

  // A file written before versioning existed is version 1 by definition.
  const storedVersion = stored.schemaVersion ?? 1;
  if (storedVersion !== SCHEMA_VERSION) {
    return { history: emptyHistory(), storedVersion, stale: true, reason: `schema ${storedVersion}` };
  }

  const entries = Object.values(stored.bosses ?? {});
  const incomplete = entries.filter((e) => e.appearances?.length && !Array.isArray(e.killedOn)).length;
  if (incomplete > 0) {
    return {
      history: emptyHistory(),
      storedVersion,
      stale: true,
      reason: `${incomplete} of ${entries.length} bosses missing killedOn`,
    };
  }

  return { history: { ...emptyHistory(), ...stored }, storedVersion, stale: false, reason: null };
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
