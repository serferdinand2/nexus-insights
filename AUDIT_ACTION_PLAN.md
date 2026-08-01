# Nexus Insights — Audit & Refactor Action Plan

> Audited: 2026-07-24. All 20 source files in `src/`, plus `index.html`, `app.css`, `package.json`, tests, and scripts.
> Every finding below was verified against the actual code (line numbers reference current files).
> Legend: 🔴 fix first · 🟡 worthwhile · 🟢 polish · ⚠️ needs your decision

---

## Phase 1 — Performance & correctness (high impact)

### 1.1 🔴 Config re-read from disk on every single Riot API call
- **Files**: `src/services/config.js` (39–62), `src/services/riotApi.js` (12–22)
- **Root cause**: `riotGet()` calls `getApiKey()` → `loadConfig()` → `fs.readFileSync` + 4 `console.log` lines, per request. A 500-match sync = ~1,000 requests → ~1,000 synchronous file reads and ~4,000 log lines.
- **Fix**: cache the parsed config in a module variable; invalidate it in `saveConfig()`. Delete the `=== loadConfig DEBUG ===` block (it also logs API-key length — needless leak surface).

### 1.2 🔴 Migration 1 (gzip compression) never completes → DB is ~131 MB instead of ~15 MB
- **File**: `src/services/database.js` (64–130, 363–367)
- **Root causes**:
  1. `runMigrations()` does `SELECT matchId, rawJson, timelineJson FROM matches` — loads the entire ~131 MB of JSON into memory in one call before compressing anything.
  2. It's fired via `setTimeout(..., 500)` after `serialize()` — a race, and any failure is only a console line nobody sees.
- **Fix**: iterate row-by-row (`SELECT matchId FROM matches WHERE typeof(rawJson)='text'`, then fetch/compress/update one match at a time), run after DB init completes (callback/promise, not a timer), report progress, `VACUUM` at the end. Cuts the DB ~90% and speeds up every blob read afterwards.

### 1.3 🔴 Synchronous gunzip on the renderer thread freezes the UI
- **Files**: `src/services/compression.js` (28), used in loops by `matchService.js` (`loadJsonColumn`, `getCoachingData`, `backfillComputedStats`)
- **Root cause**: `zlib.gunzipSync` runs on the renderer's main thread. Opening the Coaching tab gunzips 40 timelines (~24 MB) back-to-back; the startup backfill does it for every un-indexed match. The comment in `coachingPanel.js` claims this "happens in the main process" — it doesn't; `matchService` is required by the renderer.
- **Fix**: add `decompressJsonAsync()` (promisified `zlib.gunzip`) and use it in the three loop call-sites. Zero behavioural change, removes multi-second UI stalls.

### 1.4 🔴 Coaching tab ignores the remake rule
- **File**: `src/services/matchService.js` `getCoachingData` (170–183)
- **Root cause**: the project rule is "remakes are never counted in a statistic", but the coaching query has no `isRemake` filter — every WR/average on the coaching board is polluted by remakes. `getStats()` (215) has the same issue (used for the welcome toast).
- **Fix**: add `AND (isRemake IS NULL OR isRemake = 0 ...)` mirroring `window.isRemake` semantics (flag with duration fallback: `COALESCE(isRemake, gameDuration < 300) = 0`).

### 1.5 🟡 N+1 database queries
- **File**: `src/services/matchService.js`
  - `getMatchParticipantRanks` (901–917): 10 sequential `dbGet`s per modal/expand → one `SELECT ... WHERE puuid IN (...)`.
  - `fetchRanksForNewMatches` (920–946): per-match `dbGet`+decompress and per-puuid cache check → batch both with `IN (...)`.
- **Fix**: single batched queries; behaviour identical.

### 1.6 🟡 Missing index for coaching/daily queries
- **File**: `src/services/database.js`
- **Root cause**: `getCoachingData` filters `queueId = 420 AND gameCreation >= ?` — full table scan over a 60+-column table.
- **Fix**: `CREATE INDEX IF NOT EXISTS idx_queue_time ON matches(queueId, gameCreation)`.

### 1.7 🟡 GD@15 / CSD@15 computed for games shorter than 15 minutes
- **File**: `src/services/matchService.js` (614–640)
- **Root cause**: `frames[15] || frames[frames.length - 1]` silently substitutes the last frame, so a 12-minute stomp records a fake "@15" diff that skews lane-phase benchmarks.
- **Fix**: return `null` when `frames.length <= 15` (matches how `cs15` already gates on duration).

---

## Phase 2 — Architecture & code quality

### 2.1 ⚠️ Match Detail Modal is unreachable (dead feature or regression?)
- **Files**: `src/components/matchModal.js` (`openMatchModal`, `closeModalOnBackdrop`), `src/components/matchCard.js` (`renderMatchCard` — its only caller), `index.html` (#matchModal), `app.css`
- **Finding**: nothing renders `renderMatchCard` anymore (history is a table; rows use `toggleRowExpand`). The modal, its HTML, and ~11 CSS blocks (`.match-card`, `.match-primary`, …) are unreachable. CLAUDE.md still documents the modal as a feature.
- **Decision needed**: (a) delete modal + card + CSS, or (b) rewire a "details" affordance on table rows to open it. I'd suggest (a) — the expanded row already shows the 10-player table and badges.

### 2.2 🟡 Confirmed dead code (safe deletes)
- `src/components/filtersPanel.js` `updateTrendIndicators` (91–177) — targets DOM ids (`avgCsDiff15Trend`…) that no longer exist in `index.html`.
- `src/components/tableRenderer.js` — `getInsight*` family (439–487), `getInsightColor`, `getRankFromWinRate`, `getRankFromCS`; the extended fields of `calculateStats` (367–405) are consumed by nobody (only wins/losses/winRate used via `getRankedStats`).
- `src/components/coachingPanel.js` `updateProgressRing` (40–65) — defined, never called (ring is built inline).
- `src/services/matchService.js` `getDailyStats` (986–1003) — exported, zero callers. Also two leftover empty `if (i < ...) { }` blocks (810–813, 976–977) from removed sleeps.
- `src/components/dom.js` `escapeAttr` — unused.
- `package.json`/CLAUDE.md drift: dotenv isn't a dependency, there's no `.env` or root `nexus_data.sqlite`; update CLAUDE.md while at it.

### 2.3 🟡 Three parallel rank-tier colour/threshold systems
- **Files**: `analyticsEngine.js` (`RANK_COLORS`, `STAT_BENCHMARKS`), `tableRenderer.js` (`getRankColor` + 6 `getRankFrom*` threshold sets — different hex values for the same tiers), `calendarPanel.js` (`LP_TIER_COLORS` — a third palette)
- **Fix**: one `src/components/rankTiers.js` exporting the palette + a generic `tierFor(value, thresholds, higherIsBetter)`; the same gold looks the same everywhere.

### 2.4 🟡 Startup schema churn
- **File**: `src/services/database.js` (277–358)
- **Root cause**: ~60 `ALTER TABLE ADD COLUMN` attempts fail-and-swallow on every launch.
- **Fix**: read `PRAGMA table_info(matches)` once and only ALTER missing columns.

### 2.5 🟡 Duplicated `userDataPath` resolution
- **Files**: `database.js` (10–27) and `config.js` (6–18) — identical 3-platform logic.
- **Fix**: extract `src/services/paths.js`.

### 2.6 🟢 Small correctness/consistency nits
- `analyticsEngine.js`: `con_kda_std` card is `benchmarkable: true` but has no `STAT_BENCHMARKS` entry → permanent "Unrated" chip; set `benchmarkable: false`.
- `matchService.computeAdvancedStatsForMatch` finds "me" by `championName + teamId`; caller has the puuid — pass it through (robust against future modes).
- Lane-opponent lookup duplicated twice inside the same function (560–565 vs 620–627).
- `sleep()` in matchService only used by the rank-retry path — fine, but remove the misleading top comment block if the empty blocks go.

---

## Phase 3 — UI/UX polish

### 3.1 🟡 "Load 20 More" loads 50
- **Files**: `index.html` (408), `renderer.js` (`loadMoreMatches`: `displayedMatchCount += 50`)
- **Fix**: pick one — rename the button or change the step.

### 3.2 🟡 Global Enter key triggers Sync
- **File**: `renderer.js` (606–608) — `keypress` on `document` fires `handleSync()` even while typing in the Settings modal or filters.
- **Fix**: scope to the summoner-name/tag inputs.

### 3.3 🟡 Coaching cards contain hardcoded personal/stale text
- **File**: `coachingPanel.js` — literals like "Your Apr–Jun GD@15 was −475", "Jan–Mar WR 65.2%", "61.7% of your deaths", and champion-specific advice ("Nocturne", "Leblanc") baked into insight strings (379, 398, 441–444, 464, 504, 524…).
- **Fix**: compute these from `rows` (period splits are one `filter` each) or drop the sentences. Right now the board shows numbers that stopped being true months ago.

### 3.4 🟢 Accessibility
- Analytics sub-tabs: add `role="tablist"` / `aria-selected`; they're plain buttons today (`index.html` 141–151).
- Progress bar: `role="progressbar"` + `aria-valuenow` (`syncPanel.js`).
- Modals: `aria-modal="true"`, focus trap, Escape for the setup modal (only #matchModal has Escape today).
- Tooltip div: `role="tooltip"`.

### 3.5 🟢 CSS cleanup
- **File**: `styles/app.css` (5,121 lines)
- 14 duplicate selector definitions (`.main-card`, `.match-history`, `.team-header`, `.analytical-tab`, `.settings-btn`, `.header`, …) — merge each pair; later blocks silently override earlier ones today.
- Dead styles for removed features: `.match-card` family, `.header` (replaced by titlebar), leftover orb/background rules.
- Move the inline styles in `index.html` (progress-details block, legend squares) into classes.

### 3.6 🟢 Loading feedback
- Tab switches await `prefetchTabJson` with no visual cue for not-yet-indexed rows; a lightweight skeleton/spinner in `#analyticsCardsContainer` covers the mid-migration case. Low priority — once 1.2/backfill completes, prefetch is a no-op.

---

## Suggested execution order

| Step | Items | Risk | Verification |
|------|-------|------|-------------|
| 1 | 1.1, 1.5, 1.6, 2.2 dead-code deletes | Low | `npm test` + launch, sync a page, open every tab |
| 2 | 1.3 async gunzip, 1.4 remake filter | Low-med | Coaching tab numbers change slightly (expected — remakes excluded); UI stays responsive |
| 3 | 1.2 migration rewrite | Medium (touches live DB; keeps the existing pre-migration backup step) | file size drops to ~15 MB; spot-check match modal/expanded rows decode |
| 4 | 1.7, 2.3, 2.4, 2.5, 2.6 | Low | parity: `npm run parity` |
| 5 | Phase 3 | Low | visual pass |

**Open decisions for you**: 2.1 (delete vs rewire match modal), 3.1 (button label vs step), 3.3 (recompute vs delete the hardcoded coaching prose).

Existing tests (`test/analytics.test.js`, `rateLimiter.test.js`, `dom.test.js`) and `scripts/parity-check.js` will be run after each step.
