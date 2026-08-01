# Session Handoff — Nexus Insights

> Context for resuming work in a fresh conversation. Read `CLAUDE.md` first
> (architecture), then this (what changed recently + what's still open).
> Last session date in-app: 2026-07-22.

---

## Uncommitted work — COMMIT THIS FIRST

A large batch of changes is on disk but not in git. Losing it would hurt. From
the project folder:

```
git add -A
git status      # sanity-check what's staged
git commit -m "Perf overhaul, remake exclusion, UI restructure, launcher + icon"
```

`.gitignore` already excludes `node_modules`, `dist`, `.env`, `*.sqlite`.

---

## Environment facts

- **Windows**, project at `C:\Users\anton\OneDrive\Documents\Nexus Insights`
  (inside OneDrive — see corruption note below).
- **Live data** lives in `%APPDATA%\nexus-insights\`: `config.json` (API key,
  Riot ID, region) and `nexus_data.sqlite`. **NOT** in the project folder.
  1,289 matches, ~102MB, already gzip-compressed (migration ran 2026-02-11).
- The DB is inside OneDrive-adjacent AppData, not OneDrive itself — fine. Do
  NOT move a live SQLite file into the OneDrive project folder (sync corruption).
- **API key is set via the in-app Settings dialog only.** There is no `.env`
  and `dotenv` was removed. Editing a `.env` does nothing.
- Node 22.5+ required for `scripts/parity-check.js` (uses built-in `node:sqlite`;
  the repo's `sqlite3` is Electron-built and plain node can't load it).
- Assistant reaches the real DB only if the user re-grants folder access to
  `C:\Users\anton\AppData\Roaming\nexus-insights` (was granted last session).

---

## What was done this session (newest first)

### UI restructure
- **Frameless window** (`frame:false` in main.js). Custom title bar in
  index.html (`.titlebar`): app name "Nexus Insights" **left** (gold gradient,
  `.titlebar-brand`), settings gear + min/maximise/close **right**. Window
  controls wired through `windowControls.js` → IPC `window:control` /
  `window:state` in main.js. `Menu.setApplicationMenu(null)` removed the native
  File/Edit/… menu; F12, Ctrl+Shift+I, Ctrl+R re-bound in main.js.
- **Removed** the big centred gradient header that sat above the nav tabs. Its
  `.header`/`.logo`/`.logo-text` CSS rules are now dead but still present.
- **Match History is its own top-level page** (`#history-tab`), third nav button
  between Analytics and Coaching (📜, id `navHistory`, count pill
  `navHistoryCount`). `switchTopTab` rewritten as a `TOP_TABS` table
  (analytics/history/coaching).
- **Game-modes filter bar moved up** — now above the analytics sub-tabs
  (`#filterSection`, hidden until data loads), stretches full width
  (checkboxes `flex:1 1 0`). It drives analytics + Time Analytics + the history
  page; that's why it stays on the Analytics page, not the history page.
- **Analytics stat cards**: removed the aggregation-type chip
  (`std-stat-type`), centred the stat name (`std-stat-header` justify-content
  center, `std-stat-label` text-align center, max-width 100%).
- **Time Analytics** panel: fixed a layout bug (was `display:flex` on a block
  panel), removed the "TIME ANALYTICS" visible label (kept as sr-only), moved
  Session Stamina under the calendar, stretched Day of Week.
- **Scrollbars hidden globally** but still scrollable (end of app.css). Match
  table has a right-edge fade hint for its hidden horizontal scroll.
- **LP charts**: height iterated a lot — final `.lp-canvas` is
  `flex:0 0 auto; height:152px` (the `flex:1` was silently overriding earlier
  height changes; grid items also needed `align-self:start`). Padding inside
  `drawLpChart` scales with canvas height. `ResizeObserver` redraws on resize
  (fixes the oversized/blurry labels). LP history is cached
  (`getLpHistoryCached`) and seeds run once (`seedLpHistoryOnce`).
- **LP charts are now rank-coloured** (last change): tier bands, gridlines,
  line+fill gradient, dots and labels all use `LP_TIER_COLORS` (matches
  `RANK_COLORS` in analyticsEngine). `makeTierGradient` paints each tier's slice
  with hard boundaries. NOTE: user's Solo range is all-Emerald and Flex all-Gold,
  so each chart currently reads as a single colour — correct, multi-colour only
  shows across a promotion.

### Desktop launcher + icon
- `Launch Nexus Insights.vbs` — starts Electron hidden (no console window),
  self-locating.
- `Create Desktop Shortcut.ps1` — run once to make the desktop shortcut w/ icon.
- `src/assets/icon.png` (user-supplied; was JPEG-with-.png-name, re-saved as real
  PNG) → `icon.ico` (7 sizes 16–256) + `icon-256.png`. Wired into main.js
  (`icon:`) and package.json build (`win.icon`, desktop/start-menu shortcuts).
- User runs the app from the desktop shortcut against source — every restart
  runs current code. Declined an in-app updater (single user, no need).

### Performance (biggest wins) — all verified against real 1,289-match DB
- **Lazy JSON blobs**: `getMatches()` no longer selects rawJson/timelineJson.
  `matchService` owns a per-matchId blob cache (`loadRawJson`/`loadTimelineJson`
  → `getCachedRawJson`/`getCachedTimelineJson`, `clearJsonCache`). Startup blob
  parse (~130MB) eliminated. Details in CLAUDE.md "Lazy JSON Loading".
- **Precomputed analytics columns**: 17 per-match values computed once at
  sync/backfill and stored, so Lane Phase/Combat/Death Review/Vision/Economy
  read plain numbers instead of parsing timelines. **~600–800x faster** on real
  data (6.2s → ~14ms). `isPrecomputed()` marker is `statsComputedAt` (NOT any
  single stat — a remake has null dmgShare but IS indexed). Backfill runs on
  sync and once in background at startup (`backfillAnalyticsInBackground` in
  renderer). Full detail + the two scale traps in CLAUDE.md "Precomputed
  analytics columns".
- **Rate limiter** (`services/rateLimiter.js`): dual-window token bucket
  (20/s AND 100/2min), 429 retry honouring Retry-After, pauses ALL callers on
  429, backoff on 5xx, fail-fast on 4xx. Replaced the fixed 150ms sleep that
  respected 20/s but blew the 100/2min window. API key moved to X-Riot-Token
  header (out of query string). 8 tests.
- **Incremental filtering**: "Load 20 More" appends rows, doesn't rebuild; only
  recomputes analytics/calendar when the filter *signature* changes.
- **Coaching panel**: dropped its private sqlite connection + 24MB renderer-side
  gunzip; `getCoachingData()` in matchService does it once in-process.
- **LP seeding**: was 18 DB round-trips per calendar render → once per session.

### Correctness
- **Remakes excluded from all stats** (user request). `isRemake` column from
  Riot's `gameEndedInEarlySurrender` (fallback `gameDuration<300`).
  `window.isRemake` / `window.excludeRemakes` in renderer. Analytics/calendar/
  time-insights/ranked-cards all exclude; match list KEEPS them (dimmed +
  REMAKE tag). Count badge shows "N remakes excluded". 26 remakes in user's data.
- **NaN guards** in analyticsEngine: `num()`/`ratio()` helpers; a missing
  `totalDamageTaken` no longer blanks the whole Combat tab.

### Security / hygiene
- HTML escaping (`components/dom.js` `escapeHtml`/`escapeAttr`) on all
  Riot-sourced strings (summoner/champion names) in matchModal/matchCard/
  tableRenderer. Tests in `test/dom.test.js`.
- `.gitignore`, `.gitattributes` (LF normalisation), `.env.example`, `README.md`,
  `SECURITY-NOTES.md`, `scripts/README.md` all added. Stale 131MB project-folder
  DB and 161MB `nexus_data.backup.sqlite` deleted (292MB freed). `git rm --cached`
  done for node_modules/dist/.env/DB; **API key is in git history commit
  `e355f20`** — user should rotate it (dev keys expire 24h so likely moot).

### Tooling
- `npm test` — 31 tests (analytics calculators, rate limiter, dom escaping,
  remake logic). All pass.
- `npm run parity` — `scripts/parity-check.js`, the parity harness. Computes
  every stat both ways (blob vs column) on a temp copy of the real DB, proves
  they match, reports speedup. Caught 4 real silent bugs. Run after ANY change
  to analyticsEngine calculators or matchService stat functions. See
  `scripts/README.md`.

---

## Still open (nothing urgent)

- **contextIsolation + preload IPC** (SECURITY-NOTES §4): renderer still runs
  `nodeIntegration:true`. Injection vectors are closed (escaping) so low real
  risk for a single-user local app. Proper fix is entangled with moving timeline
  extraction to main process — do the "precompute" pattern for any remaining
  blob reads first. Parked by mutual agreement.
- **Rotate Riot API key** (git history) — user's call.
- **Dead CSS**: `.header`/`.logo`/`.logo-text` and the old `.settings-btn`
  rules no longer match anything. Harmless; strip if tidying.
- **Smoke test needed**: most UI work this session hasn't been seen running.
  Assistant cannot launch Electron in-sandbox — relies on user screenshots.

---

## Working style that fit this user

- User is **not deeply technical** — explain the *why* in plain terms, use
  concrete before/after numbers, name the actual failure mode.
- Prefers tight iteration on visual tweaks; will say "more/less/double".
  Assistant repeatedly mis-sized the LP charts by reasoning without seeing —
  **ask for a screenshot rather than guessing** on pixel-level layout.
- Verify data/logic changes against the REAL database via the parity harness,
  not just synthetic fixtures (synthetic undersold the speedup 3x vs 600x and
  hid the remake edge case).
- Keep the task list (TaskCreate/TaskUpdate) updated — user sees it as a widget.
- `git` from the sandbox is flaky over the OneDrive mount (index.lock, timeouts);
  prefer having the user run git commands locally.
