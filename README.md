# NemesisWatcher

Daily Telegram report of **Nemesis boss spawn chances for the Tibia world Havera**.

Every morning, shortly after tibia.com refreshes its Kill Statistics, the bot sends a
chain of messages:

1. **Which nemesis died in the window that just closed** — so you do not spend the day
   hunting something someone already killed last night.
2. **Which ones showed up and were not killed** — they wiped a team and walked away, and
   may still be standing there right now. This is the most actionable line in the report.
3. **Which ones can realistically spawn today**, ranked by a probability computed from
   Havera's own kill-statistics history and cross-checked against five public trackers.
4. **Which ones enter their window in the next few days**, which ones are available any
   day, and which ones have gone so long without a trace that nobody is doing them.

Every boss carries a link to its wiki page.

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
2025-12-04. Both are wired into `ARCHIVES` in `src/config.js`. One day, **2025-12-05**,
is missing from both — the backfill reports it and carries on.

Three properties of the kill statistics make this work:

- **A race with all four counters at zero is dropped from the list.** A boss that is
  absent was not killed and killed nobody in the last seven days.
- **Two counters count as an appearance, not one.** `last_day_killed` is players killing
  the boss; `last_day_players_killed` is the boss killing players. Either one proves it
  was in the world that day. This matters more than it sounds: on 2026-08-13 Havera's
  statistics showed **Gaz'haragoth with 6 players killed and 0 deaths** — it spawned,
  wiped a team and was never killed. Counting only deaths made it look like it had not
  appeared in 308 days, when it had appeared eight times and nobody had managed to kill
  it since 2025-10-18.
- Presence in the list is *not* evidence for a given day. A race lingers for a week on
  its `last_week` counters with both `last_day` counters at zero.

The archive snapshot is **byte-identical** to what `api.tibiadata.com/v4/killstatistics/Havera`
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

TibiaBoss publishes a percentage even off a single observation — it rates Ferumbras at
13% where every other source says 0% — so its figure is only accepted once it rests on
at least three observations and the row is not marked stale.

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

## Message layout

The report arrives as five messages. Only the two you act on every morning are expanded:

| Message | Content | Folded? |
| --- | --- | --- |
| 1 | header + **who died in the window** | folded |
| 2 | **🔥 alta probabilidad hoy** | expanded |
| 3–4 | **🟡 posible hoy** | expanded |
| 5 | seen alive · entering their window · always available · dormant · sources | each folded separately |

Folding uses Telegram's `<blockquote expandable>` (Bot API 7.4+): the title and its count
stay visible, the body opens on tap, and opening one section leaves the others alone.
Clients too old to know the attribute render a plain quote instead. A blockquote cannot
straddle two messages, so a section too long to fit is truncated with "… y N más" rather
than split.

"🩸 Apareció y NO lo mataron" is the exception — it appears only when it has content, is
at most a couple of lines, and is the one thing that says *this may be standing there
right now*, so it stays expanded.

---

## The probability model

Following [TibiaWiki:Bosses_Spawn_Frequency](https://tibia.fandom.com/wiki/TibiaWiki:Bosses_Spawn_Frequency):
a boss cannot appear before its minimum interval has elapsed, and past that point each
further day carries a roughly constant chance (Ferumbras sits near 1/15 per day).

For each boss, `src/model.js` takes the intervals between its own appearances on Havera and:

- **collapses runs of consecutive days into one sighting.** Kill statistics have no
  clock, so a boss that spawns just before the daily refresh and dies just after
  registers on two days and would look like a one-day respawn. Only strictly adjacent
  days are merged, so a boss with several real spawn points keeps its short intervals.
- reports **0%** while `daysSince < minGap` — it is still on cooldown;
- past that, estimates the **discrete hazard**: of all intervals that reached day *d*,
  what fraction ended on day *d*;
- smooths that towards a geometric prior so a boss with two observations cannot claim
  certainty (an early version rated a boss seen twice, 29 days apart, at 100%);
- caps the result — never above 90%, never above 50% on a thin sample.

Four flags come out of the same data:

- 👀 **still up** — the last sighting has no kill recorded on any of its days. Either it
  despawned or it is still there. Reported for its own section, not ranked.
- ⚠️ **unreliable** — `minGap ≤ 2` days after collapsing, the signature of several
  independent spawn points, which the wiki article explicitly calls unpredictable from
  kill statistics (White Pale, Tyrn, Grorlam); or intervals too dispersed to mean anything.
- ♻️ **frequent** — seen on ≥ 20% of covered days with a short minimum. Quest-gated or
  instanced bosses (Dream Courts, Kilmaresh, Soul War). "When does it spawn" is the wrong
  question, so they get a name-only list instead of crowding the ranking.
- 🥶 **dormant** — more than 3× its longest ever interval, and at least 60 days. Not
  "due", just nobody is doing it (Zarabustor at 205 days against a 45-day maximum). The
  rule deliberately leaves the genuine long cycles alone: Ferumbras at 119 days against a
  175-day maximum stays in the ranking.
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

Create a repository on GitHub and upload this folder. A **public** repository gets
unlimited Actions minutes; a private one gets 2000/month, of which this bot uses ~60.

### 3. Secrets

**Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | the BotFather token, complete — a truncated paste produces `Unauthorized` |
| `TELEGRAM_CHAT_ID` | your numeric chat id |

Also set **Settings → Actions → General → Workflow permissions** to **Read and write
permissions**, so the workflow can commit the updated history.

### 4. First run

**Actions → Daily Nemesis report → Run workflow.** GitHub labels the inputs with their
descriptions rather than their names, so `dry_run` reads *"Build the report and print it
without sending to Telegram"*. Tick it for the first run.

That run backfills 400 days (about a minute), prints the report to the log, sends
nothing, and still commits `data/history.json` — the backfill is derived data, and
throwing it away would only mean doing it again.

When the log looks right, run it again with the box unticked.

> **Use "Run workflow", not "Re-run jobs".** A re-run replays an *old* run at the commit
> it was created from, so it runs the old code and tries to push a history built from it.
> The commit step rebases and retries when that push is rejected, but the report itself
> will be whatever that older commit produced.

### Schedule

Two crons fire daily, at 03:30 and 04:30 UTC. Whichever lands before 05:00 Berlin time
sees a killstats day it has already reported and exits without sending, so exactly one
report goes out whether Europe is on CET or CEST.

Kill statistics refresh around **03:00–04:00 CE(S)T** — roughly six hours before server
save, not at server save. The archive repository polls at 04:00, 04:30 and 05:00 Berlin
time, so by 05:30 the frozen snapshot is reliably in place.

> Triggering the workflow by hand before 05:00 Berlin is fine, but it will report the
> *previous* killstats day while the third-party sites have already moved on to the new
> one, which shows up as extra 🔴 disagreement markers.

---

## Changing the recording rule

`src/history.js` exports a `SCHEMA_VERSION`. When the rule for what counts as an
appearance changes, bump it: `src/index.js` sees the stored history was built under an
older version, throws it away and rebuilds from the archive, so the improvement reaches
every day of history rather than only the days from that point on.

---

## Testing without Node

There is no Node on the development machine, so `_Testing/` holds a browser harness that
imports the **real** modules over HTTP and runs them against live data.

```powershell
powershell -ExecutionPolicy Bypass -File "_Testing\serve.ps1"
```

Then open <http://127.0.0.1:8787/_Testing/harness.html>. It runs 36 unit checks, builds a
400-day history from the archive, fetches all five external sources through the server's
`/proxy` endpoint (they block cross-origin reads) and renders the finished Telegram
messages.

Two things make this possible and are worth preserving:

- **Every filesystem touch lives in `src/store.js`.** Nothing else imports `node:fs`, so
  the whole pipeline loads in a browser.
- The harness shims `globalThis.process` because `src/config.js` reads `process.env`.

`raw.githubusercontent.com` is fetched directly rather than through the proxy — it
already serves `Access-Control-Allow-Origin: *`, and the single-threaded PowerShell
listener would serialise 400 requests.

---

## File layout

```
src/
  config.js          world, archives, thresholds, model tunables — start here
  index.js           the daily run
  model.js           the probability estimate and its flags
  consensus.js       merges our model with the external opinions, buckets the result
  report.js          builds the Telegram messages, splits them under the 4096 limit
  history.js         pure history logic + SCHEMA_VERSION (browser-safe)
  store.js           the only module that touches the filesystem
  bosslist.js        indexes the nemesis list and its name aliases
  backfill.js        rebuilds history from the archive
  telegram.js        sendMessage with 429 handling
  lib/               http (retry, timeout, concurrency), dates, name normalisation
  sources/           killstats + one module per third-party site
  data/nemesis.json  the 108 nemesis bosses, regenerated on every run
data/
  history.json       appearances and kills per boss — committed by the workflow
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
  one-day fuzziness the wiki article calls "low chance", and the reason consecutive days
  are collapsed into one sighting.
- Sites disagree about last-seen dates by a day for exactly this reason (GuildStats says
  Ferumbras 2026-04-23, ExevoPan says 2026-04-24). Our own model uses the archive's day
  labels consistently, so its intervals are internally consistent.
- `data/history.json` is the asset worth keeping. It grows one day at a time and cannot
  be rebuilt beyond what the archive repositories still host.
