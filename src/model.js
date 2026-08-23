import { MODEL } from './config.js';
import { daysBetween } from './lib/dates.js';

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Expected number of days a boss waits past its own minimum before showing up.
 *
 * Computing this straight from the observations breaks on thin data: a boss seen twice,
 * 29 days apart, has an observed spread of exactly 1 day, which would claim a 100%
 * chance every day past day 29. So the observed spread is blended with a weakly
 * informative default, weighted by how many intervals actually back it up.
 */
function spreadEstimate(gaps, minGap) {
  const observed = mean(gaps) - minGap + 1;
  const n = gaps.length;
  const blended = (observed * n + MODEL.defaultSpreadDays * MODEL.priorWeight) / (n + MODEL.priorWeight);
  return Math.max(MODEL.minSpreadDays, blended);
}

/**
 * Estimates the probability that a boss spawns on `today`, from the intervals observed
 * between its own appearances on this world.
 *
 * The method is the one TibiaWiki:Bosses_Spawn_Frequency describes: a boss cannot appear
 * before its minimum interval has elapsed, and past that point each further day carries a
 * roughly constant chance (Ferumbras sits near 1/15 per day). We estimate that as a
 * discrete hazard — of all the intervals that reached day d, what fraction ended on day d —
 * smoothed towards a geometric prior so that a boss with only a handful of observations
 * does not produce a 0% or 100% claim.
 */
export function analyzeBoss(appearances, today, { coverageFrom = null, coverageDays = 0 } = {}) {
  if (!appearances || appearances.length === 0) {
    return {
      status: 'unseen',
      lastSeen: null,
      daysSince: coverageFrom ? daysBetween(coverageFrom, today) : null,
      appearances: 0,
      gaps: [],
      chance: null,
      confidence: 'none',
      unreliable: true,
      frequent: false,
      note: 'sin apariciones en el historial disponible',
    };
  }

  const lastSeen = appearances[appearances.length - 1];
  const daysSince = daysBetween(lastSeen, today);
  const rate = coverageDays > 0 ? appearances.length / coverageDays : 0;

  const gaps = [];
  for (let i = 1; i < appearances.length; i++) {
    gaps.push(daysBetween(appearances[i - 1], appearances[i]));
  }

  if (gaps.length === 0) {
    return {
      status: 'insufficient',
      lastSeen,
      daysSince,
      appearances: appearances.length,
      gaps,
      chance: null,
      confidence: 'none',
      unreliable: true,
      frequent: false,
      note: 'una sola aparicion registrada, no hay intervalos',
    };
  }

  const sorted = [...gaps].sort((a, b) => a - b);
  const minGap = sorted[0];
  const maxGap = sorted[sorted.length - 1];
  const avg = mean(gaps);
  const sd = Math.sqrt(mean(gaps.map((g) => (g - avg) ** 2)));
  const cv = avg > 0 ? sd / avg : 0;
  const prior = 1 / spreadEstimate(gaps, minGap);

  let chance;
  let status;
  if (daysSince < minGap) {
    chance = 0;
    status = 'cooldown';
  } else {
    const hits = gaps.filter((g) => g === daysSince).length;
    const atRisk = gaps.filter((g) => g >= daysSince).length;
    chance = (hits + MODEL.priorWeight * prior) / (atRisk + MODEL.priorWeight);
    status = daysSince > maxGap ? 'overdue' : 'window';
    // Past every interval ever observed, the empirical hazard has no data left;
    // never report less than the base rate in that case.
    if (status === 'overdue') chance = Math.max(chance, prior);
  }

  /**
   * Quest and instanced bosses (Dream Courts, Kilmaresh, Soul War…) are killed by
   * somebody almost every day, so "when does it spawn" is the wrong question for them —
   * they are effectively always available and would otherwise flood the report.
   */
  const frequent = minGap <= 1 && rate >= MODEL.frequentRate;
  const unreliable = minGap <= MODEL.multiSpawnMinGap || cv > MODEL.maxCoefficientOfVariation;
  const confidence =
    gaps.length >= MODEL.minGapsForConfidence && !unreliable
      ? 'high'
      : gaps.length >= 3
        ? 'medium'
        : 'low';

  // A thin sample cannot justify a confident claim, however the arithmetic came out.
  const ceiling = confidence === 'low' ? MODEL.lowConfidenceCeiling : MODEL.chanceCeiling;
  chance = Math.min(ceiling, Math.max(0, chance));

  const notes = [];
  if (frequent) {
    notes.push('aparece casi a diario: boss de acceso por quest o instanciado');
  } else if (minGap <= MODEL.multiSpawnMinGap) {
    notes.push('intervalo minimo muy corto: probablemente varios puntos de spawn, la prediccion por killstats no aplica');
  } else if (cv > MODEL.maxCoefficientOfVariation) {
    notes.push('intervalos muy dispersos, prediccion debil');
  }
  if (gaps.length < 3) notes.push(`solo ${gaps.length} intervalo(s) observado(s)`);

  return {
    status,
    lastSeen,
    daysSince,
    appearances: appearances.length,
    rate,
    gaps,
    minGap,
    maxGap,
    medianGap: quantile(sorted, 0.5),
    meanGap: Number(avg.toFixed(1)),
    windowLow: quantile(sorted, 0.1),
    windowHigh: quantile(sorted, 0.9),
    prior,
    chance,
    daysToWindow: daysSince < minGap ? minGap - daysSince : 0,
    confidence,
    unreliable,
    frequent,
    note: notes.join(' · ') || null,
  };
}
