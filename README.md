# NemesisWatcher

Daily Telegram report of **Nemesis boss spawn chances for the Tibia world Havera**.

Every morning, shortly after tibia.com refreshes its Kill Statistics, the bot sends a
chain of messages with:

1. **Which nemesis died in the window that just closed** — so you do not spend the day
   hunting something someone already killed last night.
2. **Which ones can realistically spawn today**, ranked by a probability computed from
   Havera's own kill-statistics history and cross-checked against five public trackers.
3. **Which ones enter their window in the next few days.**
4. A wiki link on every single boss.

---

## Why GitHub Actions and not Cloudflare Workers

The Workers free plan allows **10 ms of CPU per invocation, cron triggers included**.
This bot parses a 220 KB kill-statistics payload plus roughly 2 MB of HTML from five
sites. Fitting that under 10 ms would require splitting the work across ~8 chained
invocations driven by a state machine in KV.

GitHub Actions has no CPU ceiling, runs Node in the runner (so no local Node install is
needed), gives readable logs and a manual "run now" button, and the repository itself
stores the history as versioned JSON. The usual objection to Actions — cron fires 5 to
20 minutes late — does not matter for a report that goes out once a day.

---

## Data sources

### The history (our own model)

`tibiamaps/tibia-kill-stats` on GitHub publishes **one JSON snapshot per world per day,
in the exact TibiaData v4 shape**, and it covers Havera:

```
https://raw.githubusercontent.com/tibiamaps/tibia-kill-stats/main/data/havera/2026-08-22.json
```

Data runs from 2025-12-06 onwards, with a sibling repository covering 2022-08-23 to
2025-12-04. Both are wired into `ARCHIVES` in `src/config.js`.

Two properties of the kill statistics make this work:

- **A race with all four counters at zero is dropped from the list.** A boss that is
  absent was not killed in the last seven days. A boss present with `last_day_killed > 0`
  was killed during the day that just closed. That gives exact last-seen dates.
- The archive snapshot is **byte-identical** to what `api.tibiadata.com/v4/killstatistics/Havera`
  returns for the same day, so the two are interchangeable.

The same repository also maintains the two lookup tables the bot needs, refreshed on
every run by `scripts/refresh-lists.mjs`:

| File | What it gives us |
| --- | --- |
| `analyze-bosses.mjs` | the in-game Bosstiary categories — **`nemesis-boss` is the 108 bosses this bot tracks**, plus `hard-nemesis-boss` and the event categories |
| `normalize-names.mjs` | ~1730 mappings from the raw kill-statistics spelling to the pretty name (`Arthom The Hunter` → `Arthom the Hunter`) |

### The cross-check (third-party opinions)

None of these are behind a Cloudflare challenge; all were verified to parse.

| Source | What it exposes | How it is read |
| --- | --- | --- |
| [ExevoPan](https://www.exevopan.com/bosses/Havera) | `{name, lastAppearence, currentChance}` | JSON inside `__NEXT_DATA__` |
| [GuildStats](https://guildstats.eu/bosses?world=Havera) | last seen, possibility %, expected in, killed yesterday | HTML table, columns read **by header name** |
| [TibiaStatistic](https://www.tibia-statistic.com/bosshunter/details/havera) | chance label + %, predicted date | `data-*` attributes on each row |
| [TibiaBosses.pl](https://tibiabosses.pl/havera) | minimum waiting days, last seen, can-spawn tick | cells read by `data-label` |
| [TibiaBoss](https://www.tibiaboss.com/world/havera) | status, chance, days, observation count | `data-*` attributes on each card |

A source that breaks is reported as failed in the message footer and drops out of the
consensus — it never aborts the run.

**Rejected during research:** tibia.com itself (Cloudflare challenge on any scripted
request), [TibiaRing](https://www.tibiaring.com/boss.php) (HTTP 403 to scripts),
[tibiopedia.pl](https://tibiopedia.pl/stats/bosses) (redirects to a session setup page),
[tibiaroute](https://tibiaroute.com/boss-places?world=Havera) and
[tibiadozero](https://www.tibiadozero.com.br/ferramentas/boss-tracker/Havera) (Next.js
App Router RSC payloads, parseable but brittle, and they add no signal the others lack),
[tibiapedia.com/boss-timer](https://tibiapedia.com/en/boss-timer/) (a personal cooldown
stopwatch, not world data), [tibiabosses.com](https://www.tibiabosses.com/) (guide blog).

---

## The probability model

Following [TibiaWiki:Bosses_Spawn_Frequency](https://tibia.fandom.com/wiki/TibiaWiki:Bosses_Spawn_Frequency):
a boss cannot appear before its minimum interval has elapsed, and past that point each
further day carries a roughly constant chance (Ferumbras sits near 1/15 per day).

For each boss, `src/model.js` takes the intervals between its own appearances on Havera and:

- reports **0%** while `daysSince < minGap` — it is still on cooldown;
- past that, estimates the **discrete hazard**: of all intervals that reached day *d*,
  what fraction ended on day *d*;
- smooths that towards a geometric prior so a boss with two observations cannot claim
  certainty (an early version rated a boss seen twice, 29 days apart, at 100%);
- caps the result — never above 90%, never above 50% on a thin sample.

Three flags come out of the same data:

- ⚠️ **unreliable** — `minGap ≤ 2` days, the signature of several independent spawn
  points, which the wiki article explicitly calls unpredictable from kill statistics
  (White Pale, Tyrn, Grorlam); or intervals too dispersed to mean anything.
- ♻️ **frequent** — killed on ≥ 20% of covered days with a 1-day minimum. These are
  quest-gated or instanced bosses (Dream Courts, Kilmaresh, Soul War). "When does it
  spawn" is the wrong question for them, so they get their own name-only list instead of
  crowding the ranking.
- 🌙 **event** — tied to a world event rather than a cooldown.

The final number per boss is a weighted mean: **our model at weight 3**, each external
source at weight 1. The message also shows every source's own figure and an agreement
marker — 🟢 tight, 🟠 some spread, 🔴 the sites genuinely disagree.

---

## Setup

### 1. Telegram bot

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.
2. **Open a chat with your new bot and press START.** Without this, Telegram rejects
   every send with `chat not found`.
3. Get your chat id from [@userinfobot](https://t.me/userinfobot).

### 2. Repository

Create a repository on GitHub and upload this folder (drag-and-drop in the web UI works;
no git client needed). A **public** repository gets unlimited Actions minutes.

### 3. Secrets

In the repository: **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | the BotFather token, complete — a truncated paste produces `Unauthorized` |
| `TELEGRAM_CHAT_ID` | your numeric chat id |

Also check **Settings → Actions → General → Workflow permissions** is set to
**Read and write permissions**, so the workflow can commit the updated history.

### 4. First run

**Actions → Daily Nemesis report → Run workflow.** Tick `dry_run` for the first one: it
builds the history from the archive, prints the report to the log and sends nothing.

The first run backfills 400 days (about a minute) and commits `data/history.json`. Every
later run only fetches that day's snapshot and appends to it.

When it looks right, run it again with `dry_run` unticked.

### Schedule

Two crons fire daily, at 03:30 and 04:30 UTC. Whichever lands before 05:00 Berlin time
sees a killstats day it has already reported and exits without sending, so exactly one
report goes out whether Europe is on CET or CEST.

Kill statistics refresh around **03:00–04:00 CE(S)T** — roughly six hours before server
save, not at server save. The archive repository polls at 04:00, 04:30 and 05:00 Berlin
time, so by 05:30 the frozen snapshot is reliably in place.

---

## Testing without Node

There is no Node on the development machine, so `_Testing/` holds a browser harness that
imports the **real** modules over HTTP and runs them against live data.

```powershell
powershell -ExecutionPolicy Bypass -File "_Testing\serve.ps1"
```

Then open <http://127.0.0.1:8787/_Testing/harness.html>. It runs the unit checks, builds
a 180-day history from the archive, fetches all five external sources through the
server's `/proxy` endpoint (they block cross-origin reads) and renders the finished
Telegram messages.

Two things make this possible and are worth preserving:

- **Every filesystem touch lives in `src/store.js`.** Nothing else imports `node:fs`, so
  the whole pipeline loads in a browser.
- The harness shims `globalThis.process` because `src/config.js` reads `process.env`.

`raw.githubusercontent.com` is fetched directly rather than through the proxy — it
already serves `Access-Control-Allow-Origin: *`, and the single-threaded PowerShell
listener would serialise 180 requests.

---

## Layout

```
src/
  config.js          world, archives, thresholds, model tunables — start here
  index.js           the daily run
  model.js           the probability estimate
  consensus.js       merges our model with the external opinions, buckets the result
  report.js          builds the Telegram messages, splits them under the 4096 limit
  history.js         pure history logic (browser-safe)
  store.js           the only module that touches the filesystem
  bosslist.js        indexes the nemesis list and its name aliases
  backfill.js        rebuilds history from the archive
  telegram.js        sendMessage with 429 handling
  lib/               http (retry, timeout, concurrency), dates, name normalisation
  sources/           killstats + one module per third-party site
  data/nemesis.json  the 108 nemesis bosses, regenerated on every run
data/
  history.json       appearance dates per boss — committed by the workflow
  state.json         last reported killstats day, so a re-run does not duplicate a send
scripts/
  backfill.js        node scripts/backfill.js [from-date]
  refresh-lists.mjs  regenerates src/data/nemesis.json from upstream
_Testing/            browser harness + static/proxy server
```

## Manual commands

```bash
node src/index.js --dry-run
```

```bash
node src/index.js --force
```

```bash
BACKFILL_DAYS=900 node scripts/backfill.js
```

---

## Notes and limits

- The report is an estimate, not a schedule. A boss tamed or killed without registering
  a kill never shows up in the kill statistics at all.
- Kill statistics have no time of day. A boss killed just before the daily refresh and
  another killed just after look one day apart when they were minutes apart — the
  one-day fuzziness the wiki article calls "low chance".
- Sites disagree about last-seen dates by a day for exactly this reason (GuildStats says
  Ferumbras 2026-04-23, ExevoPan says 2026-04-24). Our own model uses the archive's day
  labels consistently, so its intervals are internally consistent.
- `data/history.json` is the asset worth keeping. It grows one day at a time and cannot
  be rebuilt beyond what the archive repositories still host.
