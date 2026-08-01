# scripts/

Developer tools. None of these are part of the app — nothing here ships in the
build, and the app never calls them.

---

## parity-check.js — "did I break the numbers?"

```
npm run parity
```

### What problem it solves

The analytics tabs can get their values two ways:

- **the slow way** — open every match's `rawJson` / `timelineJson` and
  recalculate from scratch
- **the fast way** — read values that were calculated once and stored as
  database columns

The fast way is what made Lane Phase, Combat and Death Review load instantly
instead of pausing for six seconds. But it introduced a nasty class of bug:
**if the two ways disagree, nothing crashes.** No error, no red text. Your
CS/min just quietly reads 6.4 when the truth is 6.05, and there is no way to
tell by looking which one is right.

This script computes every stat card **both ways on the same matches** and
compares them, value by value. Agreement means the change was safe.
Disagreement names the exact stat and shows both numbers.

### What it found the first time it ran

Four real bugs, none of which would have thrown an error:

| Bug | Symptom you'd have seen |
|---|---|
| `goldShare` stored as a fraction, read as a percent | Gold Share showing **0.2%** instead of 22.7% |
| Death share read from the match blob, not the `deaths` column | Death Share off by ~4 points |
| The indexer overwrote 7 columns already written at sync time | Silent drift in CSD@15, GD@15, first blood… |
| A 108-second remake had no damage share, so it looked "never indexed" | One match re-parsed from disk on every render, forever |

### When to run it

After changing anything in:

- `src/components/analyticsEngine.js` — the stat calculators
- `src/services/matchService.js` — specifically `computeAdvancedStatsForMatch`,
  `saveComputedStats` or `backfillComputedStats`
- the remake rule, or any benchmark threshold

### Reading the output

```
1289 matches

SLOW  blob load 8642 ms + compute 134 ms = 8776 ms
Indexing: 1289 updated, 0 failed (24263 ms — one time only)
FAST  prefetch 1 ms + compute 10 ms = 11 ms
      (0 rows still need the blobs)

PASS  Overview
PASS  Lane Phase
...
ALL TABS MATCH
Speedup: 797.8x
```

- **`ALL TABS MATCH`** — safe. Exit code 0.
- **`N VALUE(S) DIFFER`** — a `FAIL` line names the card and shows
  `old -> new`. Exit code 1.
- **`rows still need the blobs`** should be 0. Anything higher means those
  matches fall back to the slow path on every render — usually a row whose
  `rawJson` is missing or unparseable.
- **Speedup** is a bonus: it re-measures the performance gap, so a regression
  shows up as the number collapsing toward 1x.

### Safety

It **never touches your real database.** It copies the file to a temp
directory, works on the copy, and deletes it on exit. Safe to run while the app
is open.

### Requirements

Node 22.5 or newer, which includes the built-in `node:sqlite`. The project's
`sqlite3` dependency is compiled against Electron and usually can't be loaded
by plain `node`, so the script prefers the built-in and only falls back to
`sqlite3` if it's loadable.

By default it finds the database at `%APPDATA%\nexus-insights\nexus_data.sqlite`.
Pass a path to use a different one:

```
node scripts/parity-check.js "D:\backup\nexus_data.sqlite"
```

---

## The other scripts

```
npm run diagnose    # "why isn't my latest match showing up?"
npm run coaching    # what the coaching engine says about you, in full
npm run cleanup     # remove matches that belong to the wrong account
```

**diagnose-sync.js** — read-only. Prints the newest matches with how long ago
each ended, which queues are stored, recent LP readings, and whether the
migrations ran. Start here when something is missing from the app.

**coaching-report.js** — read-only. Runs the same analysis as the Coaching tab
but prints the whole ranking rather than just the focus, so you can judge
whether the ordering makes sense before trusting the UI.

**cleanup-matches.js** — the only script that writes. Removes matches synced
while Settings pointed at the wrong Riot ID, since the `matches` table records
your row of a game but not which summoner it came from. Backs the database up
before every change. Close the app first.

> Six earlier one-off analyses (`my_stats.js`, `player_rankings.js`,
> `group_insights.js`, `frequent_players.js`, `improvement_analysis.js`,
> `coaching_data.js`) were deleted in August 2026. They were unmaintained,
> nothing referenced them, and their useful parts now live in
> `coachingEngine.js`. They remain in git history if ever needed.

---

## Related

- `npm test` — unit tests for the stat calculators, the rate limiter, HTML
  escaping and the coaching engine. Fast, no database needed. Run these too.
- `CLAUDE.md` — architecture notes, including the two traps the parity harness
  exists to catch.
