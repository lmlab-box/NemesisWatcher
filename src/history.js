import { WORLD } from './config.js';
import { daysBetween } from './lib/dates.js';

/**
 * Pure history logic. All filesystem access lives in store.js so that this module —
 * and everything downstream of it — can be exercised outside Node.
 */
export function emptyHistory() {
  return { world: WORLD, updatedAt: null, coverage: { from: null, to: null, days: 0 }, bosses: {} };
}

/**
 * Records one killstats day into the history. Idempotent: re-applying a day that is
 * already recorded changes nothing, so a re-run or a manual dispatch is safe.
 *
 * @param {Map<string,number>} kills raw killstats race name -> kills that day
 * @param {Map<string,string>} byKillStatsName raw name -> pretty name
 */
export function applyDay(history, day, kills, byKillStatsName) {
  const seen = new Set();
  for (const [rawName, killed] of kills) {
    const name = byKillStatsName.get(rawName);
    if (!name || killed <= 0) continue;
    seen.add(name);
    const entry = (history.bosses[name] ??= { appearances: [] });
    if (!entry.appearances.includes(day)) {
      entry.appearances.push(day);
      entry.appearances.sort();
    }
  }

  const { coverage } = history;
  coverage.from = coverage.from && coverage.from < day ? coverage.from : day;
  coverage.to = coverage.to && coverage.to > day ? coverage.to : day;
  coverage.days = daysBetween(coverage.from, coverage.to) + 1;
  history.updatedAt = new Date().toISOString();
  return seen;
}

/** True when the day is already inside the recorded coverage window. */
export function hasDay(history, day) {
  const { from, to } = history.coverage;
  return Boolean(from && to && day >= from && day <= to);
}
