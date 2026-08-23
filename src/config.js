// Central configuration. Everything world-specific lives here.

export const WORLD = 'Havera';
export const WORLD_SLUG = 'havera';

/**
 * tibia.com refreshes its Kill Statistics once a day, around 03:00-04:00 CE(S)T
 * (documented as "4 am CET/CEST, or 6 hours before server save").
 * A "killstats day" labelled D therefore covers roughly D-1 03:00 -> D 03:00 Berlin time.
 * We treat 05:00 Berlin as the safe boundary: before it, the day that just closed is
 * still yesterday's.
 */
export const KILLSTATS_TZ = 'Europe/Berlin';
export const KILLSTATS_BOUNDARY_HOUR = 5;

/** Live snapshot of the day that just closed (same payload shape as the archive). */
export const TIBIADATA_URL = `https://api.tibiadata.com/v4/killstatistics/${WORLD}`;

/**
 * Public daily archive of tibia.com kill statistics, one JSON file per world per day,
 * in the exact TibiaData v4 shape. Verified byte-identical to the live API.
 */
export const ARCHIVES = [
  {
    repo: 'tibiamaps/tibia-kill-stats',
    branch: 'main',
    from: '2025-12-06',
    to: null, // ongoing
  },
  {
    repo: 'tibiamaps/tibia-kill-stats-from-2022-08-23-to-2025-12-04',
    branch: 'main',
    from: '2022-08-23',
    to: '2025-12-04',
  },
];

/** Upstream lists we mirror into src/data/nemesis.json (see scripts/refresh-lists.mjs). */
export const UPSTREAM_LISTS = {
  categories: 'https://raw.githubusercontent.com/tibiamaps/tibia-kill-stats/main/analyze-bosses.mjs',
  aliases: 'https://raw.githubusercontent.com/tibiamaps/tibia-kill-stats/main/normalize-names.mjs',
};

/** How far back the one-off backfill walks by default. */
export const BACKFILL_DAYS = Number(process.env.BACKFILL_DAYS || 400);

/** Report bucket thresholds, expressed as probability of spawning on the reported day. */
export const THRESHOLDS = {
  high: 0.15,      // "alta probabilidad"
  possible: 0.04,  // "posible"
  soonDays: 3,     // "entra en ventana en <= N dias"
  maxPerBucket: 25,
};

export const MODEL = {
  // Pseudo-observations pulling a thin hazard estimate towards the geometric prior
  // described in TibiaWiki:Bosses_Spawn_Frequency (Ferumbras ~ 1/15 per day past its minimum).
  priorWeight: 4,
  // Default number of days a boss waits past its own minimum, used to keep a boss with
  // one or two observed intervals from claiming certainty.
  defaultSpreadDays: 10,
  minSpreadDays: 1.5,
  // Nothing is ever reported as a sure thing; a thin sample is capped harder still.
  chanceCeiling: 0.9,
  lowConfidenceCeiling: 0.5,
  // Below this many observed intervals the estimate is flagged as low confidence.
  minGapsForConfidence: 6,
  // A minimum gap this small is the signature of multiple independent spawn points,
  // which the wiki article explicitly calls unpredictable from kill statistics.
  multiSpawnMinGap: 2,
  // Killed on this share of the covered days (with a 1-day minimum gap) means the boss
  // is quest-gated or instanced rather than on a spawn timer.
  frequentRate: 0.2,
  // Coefficient of variation above which the interval distribution is too noisy to trust.
  maxCoefficientOfVariation: 0.9,
};

export const HTTP = {
  retries: 3,
  timeoutMs: 25_000,
  concurrency: 6,
  userAgent: 'NemesisWatcher/1.0 (personal boss tracker; contact via GitHub issues)',
};

/** External opinion sources, weighted against our own model in the consensus. */
export const SOURCE_WEIGHTS = {
  own: 3,
  exevopan: 1,
  guildstats: 1,
  tibiastatistic: 1,
  tibiabossespl: 1,
  tibiaboss: 1,
};
