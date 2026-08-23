import { normalizeName } from './lib/names.js';

/**
 * Indexes the 108 bosses of the in-game Bosstiary "Nemesis" category, mirrored from
 * tibiamaps/tibia-kill-stats (see scripts/refresh-lists.mjs).
 *
 * `killStatsNames` are the raw spellings tibia.com uses, which differ in casing from the
 * pretty names ("Arthom The Hunter" -> "Arthom the Hunter").
 */
export function indexBossList(raw) {
  if (!raw?.bosses?.length) throw new Error('nemesis boss list is missing or empty');

  const bosses = raw.bosses.map((boss) => ({
    ...boss,
    killStatsNames: Array.isArray(boss.killStatsNames) ? boss.killStatsNames : [boss.killStatsNames],
  }));

  /** raw killstats spelling -> pretty name */
  const byKillStatsName = new Map();
  /** normalized key -> pretty name, for matching third-party sites */
  const byNormalized = new Map();

  for (const boss of bosses) {
    byNormalized.set(normalizeName(boss.name), boss.name);
    for (const alias of boss.killStatsNames) {
      byKillStatsName.set(alias, boss.name);
      byNormalized.set(normalizeName(alias), boss.name);
    }
  }

  return { generatedAt: raw.generatedAt, bosses, byKillStatsName, byNormalized };
}
