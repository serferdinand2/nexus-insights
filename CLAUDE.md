# Nexus Insights — Project Context

> **Last updated**: 2026-08-01
> **Status**: Active development
>
> **2026-08 changes**: left nav drawer replaces the top tab bar; game-mode
> filters moved onto the summoner row; per-match LP tracking (intra-day
> `lp_history` readings + `matchId` links, migration 3) driven by the League
> client's Live Client Data API on `127.0.0.1:2999`; close-to-tray and
> start-with-Windows; **Coaching tab rewritten** around `coachingEngine.js`
> (input-vs-outcome metric split, role-aware benchmarks, win-rate-gap ranking).
>
> **2026-07 refactor**: config caching, async gunzip, row-by-row migration,
> remake filters in coaching/getStats, shared rank palette
> `components/rankTiers.js`, shared `services/paths.js`, dead code pruned
> including the old match modal. The audit that drove it (`AUDIT_ACTION_PLAN.md`)
> was fully executed and the file removed; it is in git history if needed.

## What Is This?

A **League of Legends personal analytics desktop app** built with **Electron + vanilla JS + SQLite**. It syncs your match history from the Riot Games API, stores it locally, and provides deep performance analytics across 9 statistical categories, an AI-style coaching board, and an achievement badge system — all offline after the first sync.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop framework | Electron 40.1.0 |
| Frontend | Vanilla HTML/CSS/JS (no framework) |
| Database | SQLite3 (`sqlite3` npm package — not `better-sqlite3`) |
| HTTP | Axios 1.6.0 |
| Compression | Node.js built-in zlib (gzip) |
| Build | electron-builder 25.1.8 (NSIS installer, Windows x64 only) |
| Font | Inter (Google Fonts) |

---

## Directory Structure

```
src/
├── main.js                    # Electron main process, creates window, inits DB
├── index.html                 # Single-page UI shell (~404 lines)
├── renderer.js                # Entry point: imports, global state, toast, setup modal (~526 lines)
├── assets/
│   ├── ranks/                 # Rank emblem PNGs (Iron → Challenger)
│   ├── backgrounds/           # 13 region-themed backgrounds
│   └── badges/Badges.csv      # 39 badge definitions
├── components/
│   ├── analyticsEngine.js     # 9-tab stat calculator + rank benchmark system (699 lines)
│   ├── badgeEvaluator.js      # Badge evaluation engine (39 badges)
│   ├── calendarPanel.js       # Activity calendar, time insights, LP progression charts (441 lines)
│   ├── coachingPanel.js       # Coaching board with expandable goal cards (883 lines)
│   ├── filtersPanel.js        # Queue/champion filter logic
│   ├── matchCard.js           # Match card HTML helpers (icons, runes, spells, duration)
│   ├── matchModal.js          # Inline expanded rows — 10-player table + badges
│   ├── syncPanel.js           # Sync button handler + progress bar UI
│   ├── tableRenderer.js       # Match history table rendering + ranked stats
│   └── tooltipSystem.js       # Item/rune tooltip on hover
├── services/
│   ├── riotApi.js             # Riot Games API wrapper (all endpoints)
│   ├── matchService.js        # Match sync, advanced stats, DB read/write (31k)
│   ├── database.js            # SQLite schema, migrations, init (368 lines)
│   ├── config.js              # Config load/save (%APPDATA%/nexus-insights/)
│   ├── dataDragon.js          # Data Dragon CDN: items, runes, spells, champions
│   └── compression.js         # JSON gzip compress/decompress
└── styles/
    ├── app.css                # Main stylesheet (~94KB, dark theme, gold/teal accents)
    └── toast.css              # Toast notification styles
```

**Root files**: `package.json` (no `.env` — the API key lives in the user config; the DB lives in `%APPDATA%/nexus-insights/`)

---

## How the App Looks

- **Dark theme** throughout, with gold/teal CSS custom property accents
- **Header**: "Nexus Insights" logo centred, settings gear (⚙️) top-right
- **Top navigation**: Two tabs — 📊 **Analytics** (default) and 🎯 **Coaching** (with an unmet-goals badge counter)
- **Analytics tab**:
  - Summoner Name # Tag input + "Sync Matches" button at the top
  - Progress bar with new/filtered/existing counters during sync
  - 9 analytical sub-tabs (pill-button row): Overview · Lane Phase · Combat · Death Review · Objectives · Vision · Economy · Macro · Consistency
  - Stat cards grid below the sub-tabs — each card shows value, rank benchmark colour, and a trend arrow vs. the previous period
  - Ranked Solo/Duo and Ranked Flex cards (rank emblem image + tier text + W-L-WR%)
  - Activity Calendar (month grid, green-heat intensity) + Time Analytics side panel
  - LP Progression line charts (Canvas) for Solo/Duo and Flex
  - Time-insight mini-cards: Best Time of Day, Best Day of Week, Session Stamina (games 1-3/4-6/7+), Win/Loss Streaks
  - Match History list (filterable by queue type + champion dropdown), paginated with "Load 20 More / Load All"
- **Coaching tab**: Data-driven goal cards (collapsed by default, click to expand). Shows a progress ring (goals met/total), each card has a priority badge (HIGH/MED/LOW), quick-tip summary, expandable progress bar + detailed stats + insight text + action advice. Confetti burst when all goals are met.
- **Expanded Match Rows**: clicking a match-table row expands an inline full 10-player breakdown (both teams): items, runes, summoner spells, KDA, CS/min, damage, GD@15/XPD@15, pings, tower damage. Badge awards shown at the top. (The old full-screen Match Detail Modal was removed 2026-07 — it had become unreachable.)
- **Setup Modal**: First-run flow — API key (password field), Summoner Name # Tag, Region (select), Platform (select). Accessible anytime via the settings button.
- **Item/Rune Tooltip**: Hover over any item icon or rune to see name + description.

---

## UI Tabs & Features Detail

### Analytics Tab — 9 Statistical Sub-Tabs

Each sub-tab renders stat cards benchmarked against rank tiers (Iron → Challenger) using colour-coded rank colours. Cards also show a trend indicator (vs. the previous comparison period).

| Sub-tab | Key Stats |
|---------|-----------|
| **Overview** | Win Rate, Avg KDA, KP%, CS/min, Avg CS, Avg Damage, Damage/Min |
| **Lane Phase** | CSD@15, GD@15, XPD@15, CS@10/15/20, Deaths <10m, Plates Taken/Lost, Solo Kill Diff |
| **Combat** | Damage Share%, Damage/Min, Damage/Gold, Kill Participation, Shutdowns Claimed/Given, Multikills |
| **Death Review** | Deaths/Game, Deaths <10m, Isolated Deaths, Shutdown Gold Given, Death Share% |
| **Objectives** | Dragon/Baron/Tower Control%, Heralds/Game, Inhibitors/Game, Obj Steals, Objective Rate |
| **Vision** | Vision Score, VS/Min, Wards Placed/Killed, Control Wards, Vision Advantage |
| **Economy** | Gold/Game, Gold/Min, CS/Game, CS/Min, Gold Share% |
| **Macro** | Avg Game Length, First Blood Rate, Objective Rate, Dragon/Baron Control%, Short/Long game WR |
| **Consistency** | KDA Consistency%, KDA Std Dev, Overall WR, Last 10 WR, Best Win/Worst Loss Streak, Current Streak |

### Coaching Tab

- Reads Solo/Duo (queue 420) matches for the current season from SQLite directly
- Computes coaching metrics: dragon control, early game (GD@15), isolated deaths, champion pool depth, streaks, etc.
- Renders expandable "task cards" sorted by priority (HIGH → MED → LOW)
- Goal status is **data-driven** — auto-resolved when the target metric is met
- Badge counter in the nav tab shows remaining unmet goals
- Confetti burst animation when 100% of goals are achieved

### Activity Calendar

- Month-grid calendar with green heat-map colouring per day (less → more games)
- Month/Year pickers (dropdown)
- Time Analytics side panel: best time of day, best day of week, session stamina buckets, win/loss streaks

### LP Progression Charts

- Canvas-based line charts for Solo/Duo and Flex LP over time
- Uses `lp_history` table — seeded from hardcoded historical snapshots (see `calendarPanel.js`)
- LP is normalised to an absolute scale (e.g. Platinum IV 86LP → numeric value) for continuous charting

### Match History

- Cards list, newest first, showing: champion icon, position, mode, result (Win/Loss), KDA, CS, damage, vision, items strip, time ago
- Filters: queue type checkboxes (Ranked Solo, Ranked Flex, Normal) + champion dropdown
- Pagination: 50 shown initially, "Load 20 More" or "Load All" buttons
- Click any row → expands the inline 10-player breakdown

---

## External APIs

### Riot Games API
- **Account-v1**: PUUID lookup from `gameName#tagLine`
- **Summoner-v4**: Summoner info by PUUID
- **League-v4**: Ranked tier, rank, LP, win/loss
- **Match-v5**: Match IDs (paginated), match details, match timelines
- **Rate limits**: 20 req/sec, 100 req/2min — app uses 150ms delay between every API call

### Data Dragon CDN
- `ddragon.leagueoflegends.com/cdn/{version}/...`
- Fetches: items, runes, summoner spells, champion icons
- Version fetched dynamically (fallback: `25.S1.1`)

---

## Database Schema (SQLite)

DB path: `%APPDATA%/nexus-insights/nexus_data.sqlite`

### `matches` table (~60 columns)
| Category | Columns |
|----------|---------|
| Identity | `matchId` (PK), `queueId`, `gameCreation`, `gameDuration` |
| Champion | `championName`, `champLevel`, `teamPosition`, `lane` |
| KDA | `kills`, `deaths`, `assists` |
| Economy | `goldEarned`, `totalMinionsKilled`, `neutralMinionsKilled` |
| Damage | `totalDamageDealtToChampions` |
| Vision | `visionScore`, `wardsPlaced`, `wardsKilled`, `detectorWardsPlaced` |
| Multi-kills | `doubleKills`, `tripleKills`, `quadraKills`, `pentaKills` |
| Objectives | `turretKills`, `inhibitorKills`, `dragonKills`, `baronKills`, `objectivesStolen` |
| Team obj. | `teamDragons`, `enemyDragons`, `teamBarons`, `enemyBarons`, `teamRiftHeralds`, `enemyRiftHeralds`, `teamTowers`, `enemyTowers`, `teamInhibitors`, `enemyInhibitors` |
| Team | `teamId` (100=blue, 200=red), `teamKills` |
| Items | `item0`–`item6` |
| Runes | `primaryRune`, `secondaryRuneStyle` |
| Raw data | `rawJson` (BLOB, gzip), `timelineJson` (BLOB, gzip) |
| Advanced | `csDiff15`, `goldDiff15`, `xpDiff15`, `firstBlood`, `dmgGoldRatio`, `isolatedDeaths`, `objectiveRate` |

**Indexes**: `idx_gameCreation` (DESC), `idx_championName`

### `player_ranks` table
- `puuid` (PK), `soloTier`, `soloRank`, `soloLP`, `flexTier`, `flexRank`, `flexLP`, `fetchedAt`

### `lp_history` table
- `id`, `queue` (SOLO/FLEX), `date`, `tier`, `rank`, `lp`, `recorded_at`
- Used by LP progression charts in the calendar panel

### `schema_version` table
- `version` (PK), `applied_at` — tracks migrations

---

## Key Architecture Patterns

### Match Sync Strategy
- **First sync**: All matches since Season Start (Jan 1, 2026), paginated (100/request)
- **Subsequent syncs**: Forward-only — only after latest stored match timestamp
- **Queue filter**: Only stores 420 (Solo), 440 (Flex), 400 (Normal Draft), 430 (Blind), 480 (Swiftplay), 490 (Quickplay), 700 (Clash)
- **Rate limiting**: Sequential processing, 150ms delay between every API call
- **Timestamp format**: Both `gameCreation` and Riot API `startTime` use **milliseconds** (13 digits). Passing seconds (10 digits) causes Riot to return all matches (treats it as ms epoch ≈ Jan 1970)

### JSON Compression
- `compression.js` gzips `rawJson`/`timelineJson` on **write**, and `decompressJson()` transparently handles both gzip Buffers and legacy uncompressed TEXT
- Migration 1 converts legacy TEXT rows to gzip BLOBs **row-by-row** (rewritten 2026-07: the old version loaded all ~131MB in one query and never completed). It resumes where it stopped, only marks `schema_version` when nothing is left, then VACUUMs (~131MB → ~15MB)
- `getMatches()` does **not** select the blob columns (see Lazy JSON Loading below)

### Advanced Stats (computed from timeline data)
| Stat | Description |
|------|-------------|
| CSD@15 | CS difference vs lane opponent at 15 min |
| GD@15 | Gold difference at 15 min |
| XPD@15 | XP difference at 15 min |
| First Blood | Participated in first kill |
| Dmg/Gold Ratio | Total damage / total gold earned |
| Isolated Deaths | Deaths without nearby teammates (1500 units) or objectives |
| Objective Rate | % of team objectives secured while alive |

### Analytics Engine — Rank Benchmark System
- Every stat card is benchmarked against 10 rank tiers (Iron → Challenger) using `STAT_BENCHMARKS` thresholds in `analyticsEngine.js`
- Card colour is set to the rank-tier colour that the value corresponds to
- Trend arrows compare current filtered period vs. the previous equal-length period (e.g. last 20 games vs the 20 before that)
- `window.computeTabStats(tabName, matches, prevMatches)` is the main export — called by `renderer.js` when switching sub-tabs or changing filters

### Badge System (39 badges, 13 regions)
- Defined in `Badges.csv`, evaluated in `badgeEvaluator.js`
- Regions: Bandle City, Noxus, Demacia, Bilgewater, Freljord, Ionia, Piltover, Zaun, Targon, Shurima, Shadow Isles, Ixtal, The Void
- Some badges disabled (API limitations) — `evaluate: () => false`
- Badge results shown in the expanded match row

### Module Architecture
- Each component file registers functions on `window.*` as side-effects (no ES module `export`)
- `renderer.js` uses `window.require()` (Electron's Node integration) to load all modules
- Global shared state lives on `window.*` (e.g. `window.matchesData`, `window.DDRAGON_BASE`, `window.activeAnalyticsTab`)
- No virtual DOM — all rendering is direct DOM manipulation with template literal strings

---

## Config & Environment

### User config (`%APPDATA%/nexus-insights/config.json`)
```json
{
  "apiKey": "RGAPI-...",
  "gameName": "SummonerName",
  "tagLine": "EUW",
  "region": "europe",
  "platform": "euw1"
}
```

### Region → Platform mapping
| Region | Platforms |
|--------|----------|
| europe | euw1, eun1, tr1, ru |
| americas | na1, br1, la1, la2 |
| asia | kr, jp1 |
| sea | oc1, ph2, sg2, th2, tw2, vn2 |

---

## App Startup Sequence

1. `main.js` → init DB (run migrations) → create Electron BrowserWindow
2. `index.html` loads → `renderer.js` runs
3. Load Data Dragon assets (items, runes, spells, champion list)
4. Check config validity → show setup modal if invalid
5. Load match history from DB → render match cards + ranked stats + analytics cards
6. Init calendar + LP charts; seed LP history snapshots (INSERT OR IGNORE)
7. User can: sync new matches, switch analytical sub-tabs, filter by queue/champion, open match detail modal, switch to Coaching tab

---

## Key Functions Quick Reference

### renderer.js
| Function | Purpose |
|----------|---------|
| `showToast(title, msg, duration)` | Toast notification (exposed on `window`) |
| `showSetupModal(isFirstTime)` | First-time config / Settings modal |
| `saveSetup()` | Validate + persist config, reload app |
| `switchTopTab(tab)` | Switch between Analytics and Coaching |
| `loadMatchHistory()` | Load + render matches from DB |
| `renderMatchHistory()` | Render match card list |
| `loadMoreMatches()` / `loadAllMatches()` | Pagination controls |
| `openSettings()` | Re-open setup modal from gear button |

### analyticsEngine.js
| Function | Purpose |
|----------|---------|
| `window.computeTabStats(tab, matches, prev)` | Main entry — returns array of stat card objects |
| `calcOverview / calcLanePhase / calcCombat / ...` | Per-tab calculators |
| `evaluateBenchmark(value, statId, higherIsBetter)` | Returns rank tier string for a value |
| `buildCard(...)` | Constructs a stat card data object with benchmark + trend |

### coachingPanel.js
| Function | Purpose |
|----------|---------|
| `window.renderCoachingPanel()` | Main entry — queries DB directly, computes all coaching metrics, renders cards |
| `window.coachingToggleBody(id)` | Expand/collapse a coaching card |
| `updateProgressRing(achieved, total)` | Updates the progress ring + nav badge |
| `buildTask({...})` | Builds a single coaching card HTML |

### calendarPanel.js
| Function | Purpose |
|----------|---------|
| `window.initCalendar(matches)` | Render the monthly activity calendar |
| `window.renderLpCharts()` | Draw Canvas LP progression charts |
| `window.calculateTimeInsights(matches)` | Compute + display time-of-day, day-of-week, stamina, streaks |
| `window.toggleCalPicker(type)` | Show/hide month or year dropdown |

### matchService.js
| Function | Purpose |
|----------|---------|
| `syncMatches(puuid, onProgress)` | Full sync pipeline |
| `getMatches(limit)` | Load matches from DB — **scalar columns only**, no JSON blobs |
| `loadRawJson(ids)` / `loadTimelineJson(ids)` | Batch-fetch + parse blobs into the module cache (await before reading) |
| `getCachedRawJson(id)` / `getCachedTimelineJson(id)` | Synchronous cache read; returns `null` if not prefetched |
| `clearJsonCache()` | Drop cached blobs (called on every `loadMatchHistory`) |
| `getStats()` | Aggregate stats query |
| `computeAdvancedStatsForMatch()` | CSD@15, GD@15, isolated deaths, etc. |
| `backfillTimelines(onProgress)` | Download missing timelines |
| `backfillAdvancedStats(onProgress)` | Recalculate advanced stats |
| `saveLpSnapshot / seedLpSnapshot / getLpHistory` | LP history table CRUD |

### riotApi.js
| Function | Purpose |
|----------|---------|
| `getPuuidByRiotId()` | Name#Tag → PUUID |
| `getMatchIds()` | Paginated match ID list |
| `getMatchData()` | Full match JSON |
| `getMatchTimeline()` | Frame-by-frame timeline |
| `getLeagueByPuuid()` | Ranked tier/LP |

---

## Notes

### Distribution (shareable installer) — 2026-10

- **Build with `npm run dist` / `Build Installer.bat`, never plain `npm run build`.**
  `scripts/build-installer.js` temporarily blanks `SOLO_LP_SEED` (the owner's
  hardcoded LP history in `calendarPanel.js`) and the Gold I flex starter point,
  runs electron-builder, then restores the file. It refuses to build if it can't
  find the seed. Plain `build` would ship the owner's rank history.
- Build config: `npmRebuild: false` (sqlite3 in node_modules is already built for
  this Electron; rebuilding needs Python + MSVC), `electronDist` = the local
  Electron, `asarUnpack` `**/*.node`, NSIS `include: installer/installer.nsh`.
- `installer/installer.nsh` removes the HKCU `Run` value **"Nexus Insights"** on
  uninstall (not on upgrade). That name must match `LOGIN_ITEM_NAME` in main.js,
  which is passed as `name` to `setLoginItemSettings` in the packaged branch.
- `paths.js` creates the data folder on require. `database.js` opens SQLite at
  require time — in the main process that is before `ready`, so on a fresh PC
  the folder didn't exist yet. Main also builds the path from
  `appData + 'nexus-insights'` (not `getPath('userData')`) so it can never drift
  from the renderer's hardcoded name.
- **Region is derived from the server, not chosen.** `riotApi.PLATFORM_ROUTING`
  maps platform → Match-V5 cluster (incl. `sea` for OCE/PH/SG/TH/TW/VN, which the
  old dropdown lacked). Account-V1 has no `sea`, so `accountRoutingFor` uses
  `asia` there. The setup Region box is disabled and just mirrors the server.
  `test/riotRouting.test.js` fails if a server is added to the dropdown without
  a routing.
- Sync shows an actionable message for 401 *and* 403 (dev keys expire every
  24h — the most common error a new user hits).
- The sandbox the assistant runs in **cannot** build the NSIS installer: GitHub's
  release-asset CDN is firewalled, so electron-builder can't fetch nsis /
  winCodeSign. Build on Windows. A portable zip can be assembled by hand there
  (asar CLI + raw Electron copy + `resedit` for the exe icon).

### General

- DB file (`nexus_data.sqlite`) is ~131MB with compressed JSON blobs
- The app uses `nodeIntegration: true` in Electron (no context isolation)
  — any HTML injection would have Node access, so every external string goes
  through `escapeHtml()` (`components/dom.js`, tested). Moving to
  contextIsolation is parked: it needs analytics extraction moved to main first.
- All rendering is DOM manipulation — no virtual DOM or framework
- CSS uses custom properties for theming (dark theme, gold/teal accents)
- `electron-builder` configured for Windows x64 NSIS installer only
- `coachingPanel.js` opens its **own** SQLite connection (read-only) because it is lazily loaded and needs a direct DB handle separate from the main `database.js` singleton

### Lazy JSON Loading (perf-critical)

`rawJson`/`timelineJson` total >130MB. Loading them for every row on startup blocked the renderer for seconds and pinned ~1GB of heap, so they are now fetched **on demand**:

- `getMatches()` returns scalar columns only. `window.matchesData` rows have **no** `rawJson`/`timelineJson` properties
- `matchService.js` owns the blob cache (`loadRawJson` / `loadTimelineJson` → `getCachedRawJson` / `getCachedTimelineJson`)
- `analyticsEngine.TAB_JSON_NEEDS` declares which sub-tabs need which blob. Only Lane Phase / Combat / Death Review need timelines; Vision / Economy need rawJson; Overview, Objectives, Macro and Consistency need neither and parse nothing
- `window.prefetchTabJson(tab, ...matchLists)` is awaited by `renderAnalyticsTab()` **before** any DOM mutation, with a staleness guard so a slower render can't overwrite a newer one
- `renderFilteredMatches()` prefetches rawJson for the **visible page only** (match cards read summoner spells out of it)
- `getMatchById()` still does `SELECT *`, so the match modal / expanded row / badge evaluator get full blobs for a single match. `toggleRowExpand` must pass that full row to `createExpandedRow`, not the light `matchesData` row

**If you add a stat that reads rawJson or timelineJson, add its tab to `TAB_JSON_NEEDS` or it will silently compute from `null`.**

### Stat history chart (click a card) — 2026-10

Cards with a green dot open a slide-down chart (`#statHistoryPanel`, between
the card grid and Time Analytics) showing that stat **per month for the last 12
calendar months, ending with the current month** (current month = "so far").

- `components/statHistory.js`. Each month's value comes from running
  `window.computeTabStats` over just that month's games, so the chart can never
  disagree with what the card would show for that month. No second formula.
- Input is exactly what the cards got (current filters, remakes excluded):
  `renderAnalyticsTab` calls `window.syncStatHistory(tab, matches)` after
  drawing cards. That recomputes an open chart on filter change and closes it
  on sub-tab change.
- Not clickable (`isChartable`): `count` cards (Total Matches, the three streak
  cards), `none`, and `con_last10_wr` (no per-month meaning). Ranked Solo/Flex
  boxes are separate elements and never get the dot.
- Rank bands use `window.getStatBenchmark(id)` (exposes `STAT_BENCHMARKS`);
  `benchmarkBands` mirrors `evaluateBenchmark`'s >= / <= rule (tested).
- Months with < 5 games (`LOW_SAMPLE`) are hollow/dashed and **don't set the
  y-scale**: a 2-game 0% month would otherwise flatten a year of real data. If
  off-scale it is pinned to the edge, labelled with its true value.
- `readable()` lightens dark tier colours (Iron, Bronze) for text and dots.
- Slide animation is `grid-template-rows: 0fr → 1fr` on `.stat-history-panel`.
- Real data: 58 chartable cards, slowest 12 ms to compute.

### Remakes are excluded from statistics

Games abandoned in the first minutes (someone failed to connect) are stored and
displayed, but never counted in a statistic.

- `isRemake` column, written at sync/backfill from Riot's own
  `gameEndedInEarlySurrender`, falling back to `gameDuration < 300`
- `window.isRemake(match)` / `window.excludeRemakes(list)` in renderer.js are
  the single source of truth; they fall back to duration for un-backfilled rows
- `renderFilteredMatches` passes the filtered list to the analytics engine, the
  calendar, and the time-insight pass — but the **unfiltered** list to the match
  table, so remakes stay visible
- `displayRankedStats` also excludes them: a remake is neither a win nor a loss
- Remake rows render dimmed with a `REMAKE` tag, and the match-count badge says
  how many were excluded, so the numbers never look unexplained

### Precomputed analytics columns

Every per-match value the analytics tabs used to derive by re-parsing the blobs
is now computed once and stored as a column:

`cs10`, `cs15`, `cs20`, `deathsBefore10`, `platesTaken`, `platesLost`,
`soloKillDiff`, `dmgShare`, `killParticipation`, `dmgTakenPerDeath`,
`multikills`, `shutdownsClaimed`, `shutdownsGiven`, `shutdownBountyGiven`,
`enemyTeamKills`, `visionAdvantage`, `goldShare`

- Written by `computeAdvancedStatsForMatch()` → `saveComputedStats()`, on both
  the sync path and the backfill path, so they can't diverge
- `backfillComputedStats()` fills them for older rows. It runs on sync and once
  in the background at startup (`backfillAnalyticsInBackground` in renderer.js)
- `analyticsEngine.isPrecomputed(match)` uses `dmgShare != null` as the marker.
  Rows without it fall back to parsing the blobs, so the app is correct
  mid-migration
- `prefetchTabJson` only loads blobs for rows that are *not* precomputed —
  once backfilled, the analytics tabs touch no JSON at all

Two traps, both found by the parity harness:

1. **`saveComputedStats` must not rewrite the seven legacy columns**
   (`csDiff15`, `goldDiff15`, `xpDiff15`, `firstBlood`, `dmgGoldRatio`,
   `isolatedDeaths`, `objectiveRate`) — they are already written at sync time.
   That's why `LEGACY_STAT_COLUMNS` is a separate list behind an opt-in flag.
2. **Watch the scale.** `dmgShare`/`goldShare` are stored as fractions, but
   `calcEconomy` builds its array in percent and `calcCombat` in fractions.
   Death share is stored as `enemyTeamKills` rather than a ratio, so the
   calculator keeps dividing the authoritative `deaths` column.

### Left nav rail — 2026-10

The sliding drawer is gone. `#navDrawer` carries `nav-rail` and is always
visible (78px, `--nav-rail-width`; `body` is padded by that). Buttons stack
icon over label. `openNavDrawer/closeNavDrawer/toggleNavDrawer` in renderer.js
are kept as no-ops so older callers don't break. Pages: Analytics, Match
History, Coaching, Chat (`TOP_TABS` in renderer.js).

### Chat page (Ollama) — 2026-10

Chat with your match data using a **local** Ollama model (default `qwen3:8b`)
at `http://127.0.0.1:11434`. The model never computes a number: it calls tools
and the app answers with values from the same formulas as the stat cards.

| File | Role |
|------|------|
| `services/ollama.js` | Node `http` client (no CORS): `listModels()`, streaming `chat()` with tools/think/abort. ECONNREFUSED → `OLLAMA_DOWN` |
| `components/chatTools.js` | 8 tools (`get_overview`, `get_category_stats`, `get_stat_trend`, `get_champion_stats`, `get_role_stats`, `get_recent_games`, `get_rank_and_lp`, `get_coaching_focus`); shared filters queue/champion/role/since/until/last_n_games. `executeTool` never throws |
| `components/chatAgent.js` | Tool-calling loop (`MAX_ROUNDS` 5, repeated calls cached, last round forces an answer), system prompt, `trimHistory` |
| `components/markdown.js` | Escape-first Markdown → HTML (model output can't inject tags) |
| `components/chatPanel.js` | UI; `window.openChatPanel()` called by `switchTopTab('chat')`, re-checks Ollama each open |

- Tool context uses `excludeRemakes(window.matchesData)`, so the chat sees
  exactly what the cards see. "Ranked" means Solo/Duo unless Flex is asked.
- `options: { num_ctx: 8192, temperature: 0.4 }` — the default context
  silently drops the system prompt once tool results pile up.
- `think`: qwen3 gets `false` unless "Think harder" is ticked (much faster).
- Model choice + think toggle persist in localStorage (`nexus.chatModel`,
  `nexus.chatThink`). Cloud models (`…:cloud` / `-cloud`) are listed last and
  the footer warns that data leaves the PC.
- Tests: `chatTools`, `ollama` (fake HTTP server), `chatAgent`, `markdown` (XSS).
  `chatPanel.js` itself needs Electron + sqlite and is checked by hand.
- **If you add a tool**, add its schema to `TOOLS` and a `describeCall` label.

### Updates from GitHub (titlebar ⟳ button) — 2026-10

Installed copies update themselves from **GitHub Releases** of the public repo
`toancina/nexus-insights` (`build.publish` in package.json; electron-builder
writes it into the app as `resources/app-update.yml` on every build).

- `services/updater.js` (main) wraps `electron-updater` with `autoDownload =
  false`. Click → check → if newer: download → `ready` → after 2.5 s
  `quitAndInstall(true, true)` (silent install, relaunch). `beforeRestart` sets
  `isQuitting` so close-to-tray can't swallow the restart. Status goes to the
  renderer on `update:status` `{state, version, percent, message}`; states:
  checking / available / downloading / ready / none / dev / error.
- A **quiet check 8 s after launch** only lights the green dot; it never
  downloads, and stays silent when offline or up to date.
- From source (`!app.isPackaged`) electron-updater isn't loaded; the button
  says to use `git pull`.
- `components/updateButton.js` = the button (spinner while busy, % in tooltip).
- Tests: `test/updater.test.js` (fake autoUpdater).

**Releasing:** `Publish Update.bat` / `npm run release` → bumps the patch
version (`--version X.Y.Z` to override), strips the LP seed, builds, uploads
`Nexus Insights Setup X.exe` + `.blockmap` + `latest.yml` to release `vX`
(`releaseType: release`, not draft — drafts are invisible to the updater),
then `git add -A`, commits "Release vX" and pushes. On failure the version
bump is reverted. Token: `GH_TOKEN` env or
`%APPDATA%\nexus-insights\github-token.txt` (fine-grained, this repo only,
Contents read/write). The installer is unsigned: SmartScreen warns on first
install, updates still work. The portable zip cannot self-update.

**First-time install from GitHub.** The installer is named
`Nexus-Insights-Setup.exe` with no version in it (`nsis.artifactName`), so
`/releases/latest/download/Nexus-Insights-Setup.exe` is a permanent download
link (README top + release page). Differential updates still work, because
electron-updater swaps the version inside the tag part of the URL. After uploading,
`build-installer.js` PATCHes the GitHub release body (electron-builder leaves
it empty): "What's new" = commit subjects since the last `Release v…` commit,
then `installer/release-notes.md` (install guide). Edit that file to change
the guide. Links that would navigate the app window or open a new one are
sent to the browser (`setWindowOpenHandler` / `will-navigate` in main.js).

### UI polish + Skins — 2026-10

- `styles/polish.css` (loaded after app.css) is the consistency layer: spacing
  scale `--s1…--s6`, `--gutter` 12px, radii `--r-ctl/--r-card/--r-panel`,
  surfaces `--surface/--line/--line-strong`, type `--t-label/--t-small/--t-body/--t-value`.
  Floating glass nav rail, filters styled as tabs, rank cards 1 column wide
  (`balanceStatsGrid` counts every card as 1 unit, max 8 columns).
- **Never hard-code the accent.** Use `var(--accent-primary)`,
  `rgba(var(--accent-rgb), a)`, `--accent-deep`, `--on-accent`, `var(--gold)`,
  `rgba(var(--gold-rgb), a)`. `test/skins.test.js` fails if `#00cfbc` or
  `rgba(0,207,188,…)` reappears in the stylesheets. Canvas code reads the
  accent with `getComputedStyle` at draw time (see statHistory `accentColor`).
- Win-rate colours: `components/winRateColor.js` (50% = grey, ±12 points
  saturates). Not skinnable, nor are rank tier colours.
- Skins: `components/skins.js` = data (`vars`, `overlay`, `background`),
  `components/skinsPanel.js` = Skins page + `applySavedSkin()` at startup
  (replaced the old random-background code in renderer.js). Saved as
  `config.skin`; a custom background image is copied into the data folder
  (`config.customBackground`). "Background dim" slider = `config.bgDim[skinId]`
  (0–0.95; unset = skin default: region/image 0.85 or the skin overlay alpha,
  gradients 0). Region image is picked once per app run (`sessionRegion`).
  To add a skin, add an entry to `SKINS`.
- `saveSetup` now merges into the existing config (it used to replace it and
  wipe skin/coaching keys).
- Page footer removed; Riot's legal notice lives in the Settings dialog.

### Coaching page (rewritten 2026-10)

Solo/Duo only, organised around "am I improving game to game?". Uses
`window.matchesData` (remakes excluded) — **not** its own DB query any more —
and re-renders on every open.

- `components/coachingProgress.js` (pure, tested): `rankHeader` (W-L + LP over
  last 10 via `window.lpDeltas`), `lastGameReport` (one game vs the 20 before
  it, ‹ › steps back), `focusHits` (focus metric hit/missed per game, last 10 vs
  the 10 before), `areaTrends` (each Analytics area last 10 vs prev 10 +
  rolling-10 sparkline of a lead stat).
- Every value comes from `computeTabStats` — for the report it's run over a
  one-game list — so Coaching can't disagree with the Analytics cards.
- `coachingEngine.js` still picks the focus (input vs outcome split,
  recoverable win rate); its tilt / watch / outcome evidence moved under a
  collapsed "Details".
- Rank in the header = latest `lp_history` reading for 'solo' (no API call).
- **Known data bug:** `objectiveRate` is 100 for practically every stored game,
  so it's left out of the report and Objectives' sparkline follows `obj_tower`.
  The Analytics "Objective Rate" card and the engine's `objectiveRate` metric
  are affected too.
