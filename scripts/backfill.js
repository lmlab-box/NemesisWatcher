import { BACKFILL_DAYS } from '../src/config.js';
import { currentKillstatsDay, addDays } from '../src/lib/dates.js';
import { loadBossList, loadHistory, saveHistory } from '../src/store.js';
import { backfill } from '../src/backfill.js';

/**
 * One-off (and safely repeatable) history rebuild.
 *
 *   node scripts/backfill.js            # last BACKFILL_DAYS days
 *   node scripts/backfill.js 2022-08-23 # from an explicit day
 *   BACKFILL_DAYS=900 node scripts/backfill.js
 */
const today = currentKillstatsDay();
const from = process.argv[2] ?? addDays(today, -BACKFILL_DAYS);

const bossList = await loadBossList();
const history = await loadHistory();

console.log(`Backfilling ${from} -> ${today} for ${bossList.bosses.length} nemesis bosses...`);

const result = await backfill({
  history,
  bossList,
  from,
  to: today,
  onProgress: ({ done, total }) => {
    if (done % 25 === 0 || done === total) process.stdout.write(`\r  ${done}/${total} days`);
  },
});

await saveHistory(history);

const tracked = Object.keys(history.bosses).length;
const appearances = Object.values(history.bosses).reduce((n, b) => n + b.appearances.length, 0);
console.log(`\nDone. ${result.days} days requested, ${result.missing} unavailable.`);
console.log(`History: ${history.coverage.from} -> ${history.coverage.to} (${history.coverage.days} days)`);
console.log(`${tracked} nemesis with at least one appearance, ${appearances} appearances total.`);
