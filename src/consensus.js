import { SOURCE_WEIGHTS, THRESHOLDS } from './config.js';
import { analyzeBoss } from './model.js';
import { normalizeName } from './lib/names.js';

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** How far apart the numeric opinions are — the honest answer to "which one agrees". */
function agreementOf(values) {
  if (values.length < 2) return { spread: null, level: 'sin contraste' };
  const spread = Math.max(...values) - Math.min(...values);
  const level = spread <= 0.15 ? 'alto' : spread <= 0.35 ? 'medio' : 'bajo';
  return { spread, level };
}

/**
 * Joins our own per-world model with the third-party estimates.
 *
 * Our model carries the heaviest weight because it is computed from Havera's own kill
 * statistics history and every step of it can be inspected; the other sites are black
 * boxes, calibrated differently from each other, and are most useful as a cross-check.
 */
export function buildConsensus({ bossList, history, externals, today, killsToday }) {
  const rows = bossList.bosses.map((boss) => {
    const entry = history.bosses[boss.name];
    const own = analyzeBoss(entry?.appearances ?? [], today, {
      coverageFrom: history.coverage.from,
      coverageDays: history.coverage.days,
    });

    const key = normalizeName(boss.name);
    const external = {};
    for (const source of externals) {
      // Try the pretty name first, then every raw killstats spelling.
      let hit = source.entries.get(key);
      if (!hit) {
        for (const alias of boss.killStatsNames) {
          hit = source.entries.get(normalizeName(alias));
          if (hit) break;
        }
      }
      if (hit) external[source.id] = hit;
    }

    const weighted = [];
    const numeric = [];
    if (typeof own.chance === 'number') {
      weighted.push([own.chance, SOURCE_WEIGHTS.own]);
      numeric.push(own.chance);
    }
    for (const [sourceId, value] of Object.entries(external)) {
      if (typeof value.chance !== 'number') continue;
      weighted.push([value.chance, SOURCE_WEIGHTS[sourceId] ?? 1]);
      numeric.push(value.chance);
    }

    const totalWeight = weighted.reduce((sum, [, w]) => sum + w, 0);
    const consensus = totalWeight > 0
      ? weighted.reduce((sum, [c, w]) => sum + c * w, 0) / totalWeight
      : null;

    // How many independent opinions say this boss can show up at all today.
    const votes = { yes: 0, no: 0 };
    const castVote = (canSpawn) => (canSpawn ? votes.yes++ : votes.no++);
    if (typeof own.chance === 'number') castVote(own.chance >= THRESHOLDS.possible);
    for (const value of Object.values(external)) {
      if (typeof value.chance === 'number') castVote(value.chance >= THRESHOLDS.possible);
      else if (typeof value.canSpawn === 'boolean') castVote(value.canSpawn);
    }

    const killedToday = killsToday.get(boss.name) ?? 0;

    return {
      name: boss.name,
      wiki: boss.wiki,
      hard: boss.hard,
      event: boss.event,
      own,
      external,
      consensus,
      median: median(numeric),
      agreement: agreementOf(numeric),
      sources: numeric.length,
      votes,
      killedToday,
      // A boss killed during the day being reported has just reset its own timer,
      // so today's chance is meaningless for it.
      justKilled: killedToday > 0,
    };
  });

  rows.sort((a, b) => (b.consensus ?? -1) - (a.consensus ?? -1) || a.name.localeCompare(b.name));
  return rows;
}

export function bucketRows(rows) {
  const killed = rows
    .filter((r) => r.justKilled)
    .sort((a, b) => b.killedToday - a.killedToday || a.name.localeCompare(b.name));

  // Quest-gated and instanced bosses are available nearly every day; predicting them is
  // meaningless and they would crowd out the rare spawns the report exists for.
  const frequent = rows
    .filter((r) => !r.justKilled && r.own.frequent)
    .sort((a, b) => a.name.localeCompare(b.name));

  const candidates = rows.filter((r) => !r.justKilled && !r.own.frequent);

  const high = candidates.filter((r) => (r.consensus ?? 0) >= THRESHOLDS.high);
  const possible = candidates.filter(
    (r) => (r.consensus ?? 0) >= THRESHOLDS.possible && (r.consensus ?? 0) < THRESHOLDS.high,
  );
  const soon = candidates
    .filter((r) => (r.consensus ?? 0) < THRESHOLDS.possible)
    .filter((r) => r.own.status === 'cooldown' && r.own.daysToWindow > 0 && r.own.daysToWindow <= THRESHOLDS.soonDays)
    .sort((a, b) => a.own.daysToWindow - b.own.daysToWindow || a.name.localeCompare(b.name));

  return { killed, frequent, high, possible, soon };
}
