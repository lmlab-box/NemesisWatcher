import { WORLD, BACKFILL_DAYS } from './config.js';
import { currentKillstatsDay, addDays } from './lib/dates.js';
import { loadBossList, loadHistory, saveHistory, loadState, saveState } from './store.js';
import { applyDay } from './history.js';
import { extractDailyKills, fetchLive, fetchArchivedDay } from './sources/killstats.js';
import { fetchExternalSources } from './sources/index.js';
import { backfill } from './backfill.js';
import { buildConsensus, bucketRows } from './consensus.js';
import { buildReport } from './report.js';
import { sendAll } from './telegram.js';

const argv = new Set(process.argv.slice(2));
const DRY_RUN = argv.has('--dry-run');
const FORCE = argv.has('--force');

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

/**
 * A run must never corrupt the history on a bad response. If the payload does not look
 * like a real kill-statistics page for this world, we stop before touching any state —
 * otherwise every boss silently looks "not killed today" and the whole model drifts.
 */
function assertUsable(raw, day) {
  if (!raw || raw.length < 10_000) throw new Error(`killstats payload for ${day} is too small (${raw?.length ?? 0} bytes)`);
  if (!raw.includes(`"world"`) || !raw.toLowerCase().includes(WORLD.toLowerCase())) {
    throw new Error(`killstats payload for ${day} is not for ${WORLD}`);
  }
  const kills = extractDailyKills(raw);
  if (kills.size < 50) throw new Error(`killstats payload for ${day} yielded only ${kills.size} killed races — looks broken`);
  return kills;
}

async function main() {
  const day = currentKillstatsDay();
  log(`killstats day: ${day}${DRY_RUN ? ' (dry run)' : ''}`);

  const state = await loadState();
  if (state.lastReportedDay === day && !FORCE && !DRY_RUN) {
    log(`already reported ${day}, nothing to do`);
    return;
  }

  const bossList = await loadBossList();
  const history = await loadHistory();
  log(`tracking ${bossList.bosses.length} nemesis bosses`);

  // First run: build the history from the public archive before reporting anything.
  if (!history.coverage.from && process.env.AUTO_BACKFILL !== '0') {
    const from = addDays(day, -BACKFILL_DAYS);
    log(`empty history — backfilling ${from} → ${day} from the archive`);
    const result = await backfill({
      history,
      bossList,
      from,
      to: day,
      onProgress: ({ done, total }) => {
        if (done % 50 === 0 || done === total) log(`  backfill ${done}/${total}`);
      },
    });
    log(`backfill done: ${result.days} days requested, ${result.missing} missing`);
  }

  // The archive is the frozen, canonical snapshot; the live API is identical but is the
  // only thing available in the minutes right after the daily refresh.
  let raw = await fetchArchivedDay(day);
  let source = 'archive';
  if (!raw) {
    raw = await fetchLive();
    source = 'tibiadata';
  }
  const kills = assertUsable(raw, day);
  log(`killstats source: ${source} — ${kills.size} races killed in the window`);

  applyDay(history, day, kills, bossList.byKillStatsName);

  const killsToday = new Map();
  for (const [rawName, count] of kills) {
    const name = bossList.byKillStatsName.get(rawName);
    if (name) killsToday.set(name, count);
  }
  log(`nemesis killed in this window: ${killsToday.size}`);

  const externals = await fetchExternalSources();
  for (const feed of externals) {
    log(`  ${feed.ok ? "ok  " : "FAIL"} ${feed.label}: ${feed.ok ? `${feed.entries.size} bosses` : feed.error}`);
  }

  const rows = buildConsensus({ bossList, history, externals, today: day, killsToday });
  const buckets = bucketRows(rows);
  log(`buckets: killed=${buckets.killed.length} high=${buckets.high.length} possible=${buckets.possible.length} soon=${buckets.soon.length} frequent=${buckets.frequent.length}`);

  const messages = buildReport({ day, buckets, history, externals, bossList });

  // The history is derived data, not an outward-facing effect, so a dry run still keeps
  // it — otherwise the first run's 400-day backfill would be thrown away.
  await saveHistory(history);

  if (DRY_RUN) {
    console.log(`\n${'='.repeat(70)}\n${messages.join(`\n${'-'.repeat(70)}\n`)}\n${'='.repeat(70)}\n`);
    log(`${messages.length} message(s), ${messages.reduce((n, m) => n + m.length, 0)} chars total — not sent`);
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set');

  await sendAll(token, chatId, messages);
  log(`sent ${messages.length} message(s)`);

  await saveState({ ...state, lastReportedDay: day, lastRunAt: new Date().toISOString(), killstatsSource: source });
  log('state saved');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
