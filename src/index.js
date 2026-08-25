import { WORLD, BACKFILL_DAYS } from './config.js';
import { currentKillstatsDay, addDays } from './lib/dates.js';
import { loadBossList, loadHistoryFile, saveHistory, loadState, saveState } from './store.js';
import { applyDay, hydrateHistory, SCHEMA_VERSION } from './history.js';
import { extractDailyActivity, fetchLive, fetchArchivedDay } from './sources/killstats.js';
import { fetchExternalSources } from './sources/index.js';
import { backfill } from './backfill.js';
import { buildConsensus, bucketRows } from './consensus.js';
import { buildReport } from './report.js';
import { broadcast, parseRecipients, pinMessage, unpinMessage } from './telegram.js';

const argv = new Set(process.argv.slice(2));
const DRY_RUN = argv.has('--dry-run');
const FORCE = argv.has('--force');
const REBUILD = argv.has('--rebuild');

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

/**
 * A run must never corrupt the history on a bad response. If the payload does not look
 * like a real kill-statistics page for this world, we stop before touching any state —
 * otherwise every boss silently looks "not seen today" and the whole model drifts.
 */
function assertUsable(raw, day) {
  if (!raw || raw.length < 10_000) throw new Error(`killstats payload for ${day} is too small (${raw?.length ?? 0} bytes)`);
  if (!raw.includes('"world"') || !raw.toLowerCase().includes(WORLD.toLowerCase())) {
    throw new Error(`killstats payload for ${day} is not for ${WORLD}`);
  }
  const activity = extractDailyActivity(raw);
  if (activity.size < 50) throw new Error(`killstats payload for ${day} yielded only ${activity.size} active races — looks broken`);
  return activity;
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
  const { history, storedVersion, stale, reason } = hydrateHistory(await loadHistoryFile(), { force: REBUILD });
  log(`tracking ${bossList.bosses.length} nemesis bosses`);
  if (stale) {
    log(`stored history rejected (${reason}, version ${storedVersion}) — rebuilding from the archive`);
  }


  if (!history.coverage.from && process.env.AUTO_BACKFILL !== '0') {
    const from = addDays(day, -BACKFILL_DAYS);
    log(`building history ${from} → ${day} from the archive`);
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
  const activity = assertUsable(raw, day);
  log(`killstats source: ${source} — ${activity.size} races active in the window`);

  applyDay(history, day, activity, bossList.byKillStatsName);

  const activityToday = new Map();
  for (const [rawName, counters] of activity) {
    const name = bossList.byKillStatsName.get(rawName);
    if (name) activityToday.set(name, counters);
  }
  const killedCount = [...activityToday.values()].filter((c) => c.killed > 0).length;
  const survivedCount = [...activityToday.values()].filter((c) => c.killed === 0 && c.playersKilled > 0).length;
  log(`nemesis active in this window: ${activityToday.size} (${killedCount} killed, ${survivedCount} seen alive and not killed)`);

  const externals = await fetchExternalSources();
  for (const feed of externals) {
    log(`  ${feed.ok ? 'ok  ' : 'FAIL'} ${feed.label}: ${feed.ok ? `${feed.entries.size} bosses` : feed.error}`);
  }

  const rows = buildConsensus({ bossList, history, externals, today: day, activityToday });
  const buckets = bucketRows(rows);
  log(
    `buckets: killed=${buckets.killed.length} survived=${buckets.survived.length} stillUp=${buckets.stillUp.length} ` +
      `high=${buckets.high.length} possible=${buckets.possible.length} soon=${buckets.soon.length} frequent=${buckets.frequent.length}`,
  );

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
  const recipients = parseRecipients(process.env.TELEGRAM_CHAT_ID);
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN must be set');
  if (recipients.length === 0) throw new Error('TELEGRAM_CHAT_ID must hold at least one destination');

  const delivery = await broadcast(token, recipients, messages);
  for (const result of delivery) {
    log(`  ${result.ok ? 'sent' : 'FAIL'} → ${result.chatId}${result.ok ? '' : `: ${result.error}`}`);
  }

  const delivered = delivery.filter((r) => r.ok).length;
  if (delivered === 0) {
    throw new Error(`no recipient received the report (${delivery.map((r) => r.error).join(' | ')})`);
  }
  log(`${messages.length} message(s) delivered to ${delivered}/${recipients.length} recipient(s)`);

  // Re-pin so that whoever joins mid-day lands on today's report rather than an empty
  // chat. The previous pin is removed first, and the new id is remembered for tomorrow.
  const pins = { ...(state.pins ?? {}) };
  for (const result of delivery) {
    if (!result.ok || !result.firstMessageId) continue;

    const previous = pins[result.chatId];
    if (previous) await unpinMessage(token, result.chatId, previous);

    const pinned = await pinMessage(token, result.chatId, result.firstMessageId);
    if (pinned.ok) {
      pins[result.chatId] = result.firstMessageId;
      log(`  pinned in ${result.chatId}`);
    } else {
      log(`  could not pin in ${result.chatId}: ${pinned.error}`);
    }
  }

  await saveState({ ...state, lastReportedDay: day, lastRunAt: new Date().toISOString(), killstatsSource: source, pins });
  log('state saved');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
