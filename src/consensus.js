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
export function buildConsensus({ bossList, history, externals, today, activityToday }) {
  const rows = bossList.bosses.map((boss) => {
    const entry = history.bosses[boss.name];
    const own = analyzeBoss(entry?.appearances ?? [], today, {
      coverageFrom: history.coverage.from,
      coverageDays: history.coverage.days,
      killedOn: entry?.killedOn ?? [],
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

    const today_ = activityToday.get(boss.name) ?? { killed: 0, playersKilled: 0 };

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
      killedToday: today_.killed,
      playersKilledToday: today_.playersKilled,
      // A boss killed during the day being reported has just reset its own timer,
      // so today's chance is meaningless for it.
      justKilled: today_.killed > 0,
      // It showed up and walked away — the most actionable line in the whole report.
      survivedToday: today_.killed === 0 && today_.playersKilled > 0,
    };
  });

  rows.sort((a, b) => (b.consensus ?? -1) - (a.consensus ?? -1) || a.name.localeCompare(b.name));
  return rows;
}

export function bucketRows(rows) {
  const killed = rows
    .filter((r) => r.justKilled)
    .sort((a, b) => b.killedToday - a.killedToday || a.name.localeCompare(b.name));

  const survived = rows
    .filter((r) => r.survivedToday)
    .sort((a, b) => b.playersKilledToday - a.playersKilledToday || a.name.localeCompare(b.name));

  /**
   * Last seen alive on an earlier day and never killed since. It either despawned or is
   * still standing there — worth a look before trusting any probability.
   */
  const stillUp = rows
    .filter((r) => !r.justKilled && !r.survivedToday && !r.own.frequent)
    .filter((r) => r.own.stillUp && r.own.daysSince > 0 && r.own.daysSince <= THRESHOLDS.stillUpMaxDays)
    .sort((a, b) => a.own.daysSince - b.own.daysSince || a.name.localeCompare(b.name));

  const stillUpNames = new Set(stillUp.map((r) => r.name));

  // Quest-gated and instanced bosses are available nearly every day; predicting them is
  // meaningless and they would crowd out the rare spawns the report exists for.
  const frequent = rows
    .filter((r) => !r.justKilled && !r.survivedToday && r.own.frequent)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Far past anything ever observed for them: not "due", just nobody is doing them.
  const dormant = rows
    .filter((r) => !r.justKilled && !r.survivedToday && !r.own.frequent && !stillUpNames.has(r.name))
    .filter((r) => r.own.dormant)
    .sort((a, b) => b.own.daysSince - a.own.daysSince);
  const dormantNames = new Set(dormant.map((r) => r.name));

  const candidates = rows.filter(
    (r) => !r.justKilled && !r.survivedToday && !r.own.frequent
      && !stillUpNames.has(r.name) && !dormantNames.has(r.name),
  );
  const high = candidates.filter((r) => (r.consensus ?? 0) >= THRESHOLDS.high);
  const possible = candidates.filter(
    (r) => (r.consensus ?? 0) >= THRESHOLDS.possible && (r.consensus ?? 0) < THRESHOLDS.high,
  );
  const soon = candidates
    .filter((r) => (r.consensus ?? 0) < THRESHOLDS.possible)
    .filter((r) => r.own.status === 'cooldown' && r.own.daysToWindow > 0 && r.own.daysToWindow <= THRESHOLDS.soonDays)
    .sort((a, b) => a.own.daysToWindow - b.own.daysToWindow || a.name.localeCompare(b.name));

  return { killed, survived, stillUp, frequent, dormant, high, possible, soon };
}
