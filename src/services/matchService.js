const { getMatchIds, getMatchData, getMatchTimeline } = require('./riotApi');
const { db } = require('./database');
const { compressJson, decompressJson, decompressJsonAsync } = require('./compression');
const { computeTeamImpact } = require('./teamImpact');
const { oldestFirst, shouldStopSync } = require('./syncOrder');

// Only sync these queue types (Ranked Solo, Ranked Flex, Normal)
const ALLOWED_QUEUES = new Set([420, 440, 400, 430, 480, 490, 700]);

// Rate limiting is handled centrally by the limiter inside riotApi.js, which
// enforces BOTH of Riot's windows (20/sec and 100/2min) and retries on 429.
// Callers no longer sleep manually — doing so on top of the limiter would only
// slow syncs down without making them any safer.
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// A game shorter than this is treated as a remake if Riot didn't flag it.
const REMAKE_MAX_SECONDS = 300; // 5 minutes

// Season start timestamp (Jan 1, 2026 00:00:00 UTC) — milliseconds for Riot API
const RANKED_SEASON_START = new Date('2026-01-01T00:00:00Z').getTime();

// Promisify database methods
function dbGet(sql, params) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function dbRun(sql, params) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// ---------------------------------------------------------------------------
// LAZY JSON BLOB LOADING
// ---------------------------------------------------------------------------
// rawJson + timelineJson are enormous (>100MB across the table). Loading and
// JSON.parse-ing them for every row on startup froze the renderer for seconds
// and pinned hundreds of MB of heap. They are deliberately NOT selected by
// getMatches(); callers pull only the blobs they actually need through the
// helpers below, and results are memoised per matchId.

const rawJsonCache      = new Map(); // matchId -> parsed rawJson (or null)
const timelineJsonCache = new Map(); // matchId -> parsed timelineJson (or null)

// SQLite caps bound parameters at 999 per statement
const SQL_VAR_LIMIT = 900;

function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

// Generic blob loader — fetches only the ids missing from `cache`
async function loadJsonColumn(column, cache, matchIds) {
    const missing = [...new Set(matchIds)].filter(id => id && !cache.has(id));
    if (missing.length === 0) return cache;

    for (const ids of chunk(missing, SQL_VAR_LIMIT)) {
        const placeholders = ids.map(() => '?').join(',');
        const rows = await dbAll(
            `SELECT matchId, ${column} FROM matches WHERE matchId IN (${placeholders})`,
            ids
        );
        for (const row of rows) {
            let parsed = null;
            try {
                // Async gunzip — keeps the renderer thread responsive while
                // decoding dozens of multi-MB blobs.
                parsed = row[column] ? await decompressJsonAsync(row[column]) : null;
            } catch (e) {
                console.warn(`Failed to decode ${column} for ${row.matchId}:`, e.message);
            }
            cache.set(row.matchId, parsed);
        }
        // Any id with no row at all — cache the miss so we don't re-query it
        for (const id of ids) if (!cache.has(id)) cache.set(id, null);
    }
    return cache;
}

/** Ensure rawJson is loaded + parsed for the given match ids. */
async function loadRawJson(matchIds) {
    await loadJsonColumn('rawJson', rawJsonCache, matchIds);
}

/** Ensure timelineJson is loaded + parsed for the given match ids. */
async function loadTimelineJson(matchIds) {
    await loadJsonColumn('timelineJson', timelineJsonCache, matchIds);
}

/** Synchronous read — returns null if the blob has not been prefetched yet. */
function getCachedRawJson(matchId) {
    return rawJsonCache.has(matchId) ? rawJsonCache.get(matchId) : null;
}

function getCachedTimelineJson(matchId) {
    return timelineJsonCache.has(matchId) ? timelineJsonCache.get(matchId) : null;
}

/** Drop everything (call after a sync so refreshed rows are re-read). */
function clearJsonCache() {
    rawJsonCache.clear();
    timelineJsonCache.clear();
}

// Load all matches from database, newest first.
// NOTE: rawJson / timelineJson are intentionally excluded — use loadRawJson /
// loadTimelineJson + the getCached* accessors instead.
async function getMatches(limit = null) {
    const sql = `SELECT matchId, queueId, gameCreation, gameDuration, championName, champLevel,
                win, kills, deaths, assists, goldEarned, totalMinionsKilled,
                totalDamageDealtToChampions, visionScore,
                doubleKills, tripleKills, quadraKills, pentaKills,
                turretKills, inhibitorKills, dragonKills, baronKills, objectivesStolen,
                wardsPlaced, wardsKilled, detectorWardsPlaced,
                teamPosition, lane,
                item0, item1, item2, item3, item4, item5, item6,
                teamDragons, enemyDragons, teamBarons, enemyBarons,
                teamRiftHeralds, enemyRiftHeralds, teamTowers, enemyTowers,
                teamInhibitors, enemyInhibitors, teamId, teamKills,
                primaryRune, secondaryRuneStyle,
                csDiff15, goldDiff15, xpDiff15, firstBlood, dmgGoldRatio, isolatedDeaths, objectiveRate,
                cs10, cs15, cs20, deathsBefore10,
                platesTaken, platesLost, soloKillDiff,
                dmgShare, killParticipation, dmgTakenPerDeath, multikills,
                shutdownsClaimed, shutdownsGiven, shutdownBountyGiven,
                enemyTeamKills, visionAdvantage, goldShare, statsComputedAt, isRemake,
                impactScore, impactRank, impactTag, laneOpponent
         FROM matches
         ORDER BY gameCreation DESC${limit ? ' LIMIT ?' : ''}`;

    return dbAll(sql, limit ? [limit] : []);
}

// Get full match details by ID (including rawJson for team composition)
async function getMatchById(matchId) {
    const match = await dbGet(
        `SELECT * FROM matches WHERE matchId = ?`,
        [matchId]
    );
    if (match) {
        if (match.rawJson) match.rawJson = decompressJson(match.rawJson);
        if (match.timelineJson) match.timelineJson = decompressJson(match.timelineJson);
    }
    return match;
}

/**
 * Data backing the Coaching tab.
 *
 * This used to live in coachingPanel.js, which opened its OWN sqlite3
 * connection from the renderer and gunzipped 40 timelines (~24MB) on every
 * visit to the tab. Both the connection and the decompression now happen in
 * the main process, and only the derived numbers cross the IPC boundary.
 */
async function getCoachingData(seasonStart, timelineSample = 40) {
    // Remakes are excluded here for the same reason they are excluded from
    // every other statistic: 0/0/0 KDA rows drag every average toward zero
    // and count wins/losses that never happened. COALESCE mirrors
    // window.isRemake's duration fallback for rows that predate the column.
    const rows = await dbAll(`
        SELECT matchId, win, championName, kills, deaths, assists,
               gameDuration, gameCreation,
               totalDamageDealtToChampions, goldEarned,
               totalMinionsKilled, visionScore,
               detectorWardsPlaced, wardsPlaced, wardsKilled,
               isolatedDeaths, goldDiff15, csDiff15, xpDiff15, objectiveRate,
               teamDragons, enemyDragons, teamBarons, teamKills, firstBlood,
               doubleKills, tripleKills, turretKills, objectivesStolen,
               dmgGoldRatio,
               -- Needed by coachingEngine: role decides which benchmark
               -- applies, and these are the early-game inputs it ranks on.
               teamPosition, deathsBefore10, cs10, cs15, soloKillDiff,
               killParticipation, dmgShare
        FROM matches
        WHERE queueId = 420 AND gameCreation >= ?
          AND COALESCE(isRemake, CASE WHEN gameDuration < ${REMAKE_MAX_SECONDS} THEN 1 ELSE 0 END) = 0
        ORDER BY gameCreation ASC
    `, [seasonStart]);

    if (!rows || rows.length === 0) return { rows: [], firstDrakeTimes: [] };

    const timelineRows = await dbAll(`
        SELECT timelineJson FROM matches
        WHERE queueId = 420 AND gameCreation >= ? AND timelineJson IS NOT NULL
        ORDER BY gameCreation DESC LIMIT ?
    `, [seasonStart, timelineSample]);

    // Reduce each timeline to a single number here so the renderer never has
    // to see (or hold in memory) the timeline payloads themselves.
    const firstDrakeTimes = [];
    for (const tr of timelineRows) {
        let tl = null;
        try { tl = await decompressJsonAsync(tr.timelineJson); } catch { /* skip bad row */ }
        if (!tl) continue;
        let earliest = Infinity;
        for (const frame of (tl.info?.frames ?? [])) {
            for (const e of (frame.events || [])) {
                if (e.type === 'ELITE_MONSTER_KILL' && e.monsterType === 'DRAGON' && e.timestamp < earliest) {
                    earliest = e.timestamp;
                }
            }
        }
        if (Number.isFinite(earliest)) firstDrakeTimes.push(earliest / 60000);
    }

    return { rows, firstDrakeTimes };
}

// Get summary stats (remakes excluded — they are not statistics)
async function getStats() {
    const stats = await dbGet(
        `SELECT
            COUNT(*) as totalMatches,
            SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) as wins,
            AVG(kills) as avgKills,
            AVG(deaths) as avgDeaths,
            AVG(assists) as avgAssists,
            AVG(totalDamageDealtToChampions) as avgDamage,
            AVG(visionScore) as avgVision,
            AVG(totalMinionsKilled) as avgCs,
            SUM(pentaKills) as totalPentas,
            SUM(quadraKills) as totalQuadras,
            SUM(dragonKills) as totalDragons,
            SUM(baronKills) as totalBarons,
            SUM(turretKills) as totalTurrets,
            AVG(wardsPlaced) as avgWardsPlaced
         FROM matches
         WHERE COALESCE(isRemake, CASE WHEN gameDuration < ${REMAKE_MAX_SECONDS} THEN 1 ELSE 0 END) = 0`
    );
    return stats;
}

async function syncMatches(puuid, onProgress) {
    console.log('Fetching match IDs for PUUID:', puuid);

    // Batch-load existing match IDs for fast lookup
    const existingRows = await dbAll("SELECT matchId FROM matches");
    const existingIds = new Set(existingRows.map(r => r.matchId));
    console.log(`Existing matches in DB: ${existingIds.size}`);

    // Get the most recent match timestamp
    const latestMatch = await dbGet("SELECT MAX(gameCreation) as latestTime FROM matches");

    let allMatchIds = [];

    // Determine startTime for the API
    let startTime;
    if (latestMatch && latestMatch.latestTime) {
        // FORWARD-ONLY SYNC: fetch matches AFTER the most recent one
        // Both gameCreation and Riot API startTime use milliseconds (13 digits)
        startTime = latestMatch.latestTime + 1;
        console.log(`Forward sync: fetching matches after ${new Date(latestMatch.latestTime).toISOString()}`);
        console.log(`DEBUG: Latest match gameCreation (ms): ${latestMatch.latestTime}`);
        console.log(`DEBUG: Forward start time (ms): ${startTime}`);
        console.log(`DEBUG: Forward start time (ISO): ${new Date(startTime).toISOString()}`);
    } else {
        // First sync: fetch all matches since season start
        startTime = RANKED_SEASON_START;
        console.log('First sync: fetching ALL matches since Jan 1, 2026...');
    }

    // Fetch match IDs per allowed queue type to avoid fetching unwanted queues (ARAM, Arena, etc.)
    const queueArray = [...ALLOWED_QUEUES];
    console.log(`Fetching match IDs for ${queueArray.length} queue types: ${queueArray.join(', ')}`);
    for (const queueId of queueArray) {
        const ids = await getMatchIds(puuid, startTime, queueId, existingIds);
        console.log(`Queue ${queueId}: ${ids.length} NEW match IDs found`);
        allMatchIds.push(...ids);
    }
    console.log(`Total match IDs across all queues: ${allMatchIds.length}`);
    console.log(`DEBUG: First 5 match IDs:`, allMatchIds.slice(0, 5));

    // Deduplicate and filter out matches already in DB. Oldest first: the next
    // sync starts after the newest stored game, so an interrupted sync must
    // never have stored a game newer than one it missed (issue #13).
    const matchIds = oldestFirst(new Set(allMatchIds)).filter(id => !existingIds.has(id));
    const skipped = allMatchIds.length - matchIds.length;
    console.log(`${matchIds.length} new matches to process (${skipped} already in DB)`);

    // If no new matches, return early
    if (matchIds.length === 0) {
        console.log('No new matches to sync');
        if (onProgress) onProgress(0, 0, 'complete');
        return { newMatches: 0, skipped, total: allMatchIds.length };
    }

    let newMatches = 0;
    let queueSkipped = 0;
    let processed = 0;
    const newMatchIds = [];
    const total = matchIds.length;

    // Report initial progress
    if (onProgress) onProgress(0, total);

    // Process matches sequentially to respect rate limits (20 req/s, 100 req/2min)
    for (const id of matchIds) {
        try {
            const data = await getMatchData(id);
            const info = data.info;

            // Skip matches from unwanted queue types
            if (!ALLOWED_QUEUES.has(info.queueId)) {
                console.log(`Skipping match ${id} (queue ${info.queueId} not in allowed list)`);
                queueSkipped++;
                processed++;
                if (onProgress) {
                    onProgress(processed, total, 'progress', {
                        new: newMatches,
                        queueFiltered: queueSkipped,
                        alreadyInDB: skipped
                    });
                }
                continue;
            }

            // Fetch timeline data for badge evaluation
            let timelineData = null;
            try {
                    timelineData = await getMatchTimeline(id);
            } catch (tlErr) {
                console.warn(`Could not fetch timeline for ${id}: ${tlErr.message}`);
            }

            // Find yourself in the participants list
            const me = info.participants.find(p => p.puuid === puuid);

            if (me) {
                // Extract team objectives
                const myTeam = info.teams.find(t => t.teamId === me.teamId);
                const enemyTeam = info.teams.find(t => t.teamId !== me.teamId);

                const teamKills = info.participants
                    .filter(p => p.teamId === me.teamId)
                    .reduce((sum, p) => sum + p.kills, 0);

                const myObjectives = myTeam?.objectives || {};
                const enemyObjectives = enemyTeam?.objectives || {};

                const teamDragons = myObjectives.dragon?.kills || 0;
                const enemyDragons = enemyObjectives.dragon?.kills || 0;
                const teamBarons = myObjectives.baron?.kills || 0;
                const enemyBarons = enemyObjectives.baron?.kills || 0;
                const teamRiftHeralds = myObjectives.riftHerald?.kills || 0;
                const enemyRiftHeralds = enemyObjectives.riftHerald?.kills || 0;
                const teamTowers = myObjectives.tower?.kills || 0;
                const enemyTowers = enemyObjectives.tower?.kills || 0;
                const teamInhibitors = myObjectives.inhibitor?.kills || 0;
                const enemyInhibitors = enemyObjectives.inhibitor?.kills || 0;

                // Extract rune data
                const primaryRune = me.perks?.styles?.[0]?.selections?.[0]?.perk || null;
                const secondaryRuneStyle = me.perks?.styles?.[1]?.style || null;

                // Compute advanced stats
                const advStats = computeAdvancedStatsForMatch(data, timelineData, me.championName, me.teamId);

                await dbRun(
                    `INSERT OR IGNORE INTO matches (
                        matchId, queueId, gameCreation, gameDuration, championName, champLevel,
                        win, kills, deaths, assists, goldEarned, totalMinionsKilled,
                        totalDamageDealtToChampions, visionScore,
                        doubleKills, tripleKills, quadraKills, pentaKills,
                        turretKills, inhibitorKills, dragonKills, baronKills, objectivesStolen,
                        wardsPlaced, wardsKilled, detectorWardsPlaced,
                        teamPosition, lane,
                        item0, item1, item2, item3, item4, item5, item6,
                        teamDragons, enemyDragons, teamBarons, enemyBarons,
                        teamRiftHeralds, enemyRiftHeralds, teamTowers, enemyTowers,
                        teamInhibitors, enemyInhibitors, teamId, teamKills,
                        primaryRune, secondaryRuneStyle,
                        rawJson, timelineJson,
                        csDiff15, goldDiff15, xpDiff15, firstBlood, dmgGoldRatio, isolatedDeaths, objectiveRate
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        id, info.queueId, info.gameCreation, info.gameDuration, me.championName, me.champLevel,
                        me.win ? 1 : 0, me.kills, me.deaths, me.assists, me.goldEarned, (me.totalMinionsKilled || 0) + (me.neutralMinionsKilled || 0),
                        me.totalDamageDealtToChampions, me.visionScore,
                        me.doubleKills, me.tripleKills, me.quadraKills, me.pentaKills,
                        me.turretKills, me.inhibitorKills, me.dragonKills, me.baronKills, me.objectivesStolen,
                        me.wardsPlaced, me.wardsKilled, me.detectorWardsPlaced,
                        me.teamPosition, me.lane,
                        me.item0, me.item1, me.item2, me.item3, me.item4, me.item5, me.item6,
                        teamDragons, enemyDragons, teamBarons, enemyBarons,
                        teamRiftHeralds, enemyRiftHeralds, teamTowers, enemyTowers,
                        teamInhibitors, enemyInhibitors, me.teamId, teamKills,
                        primaryRune, secondaryRuneStyle,
                        compressJson(data), timelineData ? compressJson(timelineData) : null,
                        advStats.csDiff15, advStats.goldDiff15, advStats.xpDiff15, advStats.firstBlood, advStats.dmgGoldRatio, advStats.isolatedDeaths, advStats.objectiveRate
                    ]
                );
                // Write the precomputed analytics values through the same
                // path the backfill uses, so both stay consistent.
                await saveComputedStats(id, advStats);

                newMatches++;
                newMatchIds.push(id);
                console.log(`Saved match ${id}: ${me.championName} (${me.teamPosition || me.lane}) - ${me.kills}/${me.deaths}/${me.assists}`);
            }
        } catch (error) {
            console.error(`Error processing match ${id}:`, error.message);
            // Storing newer games past this one would leave it missing for
            // good, so stop. The next sync resumes here.
            if (shouldStopSync(error)) {
                error.savedBeforeStop = newMatches;
                throw error;
            }
        }

        // Update progress after each match
        processed++;
        if (onProgress) {
            onProgress(processed, total, 'progress', {
                new: newMatches,
                queueFiltered: queueSkipped,
                alreadyInDB: skipped
            });
        }
    }

    console.log(`Sync complete: ${newMatches} new, ${skipped} already in DB, ${queueSkipped} queue-filtered`);
    if (onProgress) {
        onProgress(total, total, 'complete', {
            new: newMatches,
            queueFiltered: queueSkipped,
            alreadyInDB: skipped
        });
    }
    return { newMatches, skipped: skipped + queueSkipped, total: matchIds.length, newMatchIds };
}

// Compute advanced stats given the participant index and parsed data
/**
 * Columns written by saveComputedStats(). Kept as one list so the schema, the
 * writer and the backfill can't drift apart.
 */
const COMPUTED_STAT_COLUMNS = [
    'cs10', 'cs15', 'cs20', 'deathsBefore10',
    'platesTaken', 'platesLost', 'soloKillDiff',
    'dmgShare', 'killParticipation', 'dmgTakenPerDeath', 'multikills',
    'shutdownsClaimed', 'shutdownsGiven', 'shutdownBountyGiven',
    'enemyTeamKills', 'visionAdvantage', 'goldShare',
    'statsComputedAt', 'isRemake',
    'impactScore', 'impactRank', 'impactTag',
    'laneOpponent',
];

/**
 * The seven columns that existed before this change. The backfill deliberately
 * does NOT rewrite them: they were already populated at sync time by this same
 * function, so recomputing them would be churn at best, and at worst would
 * silently alter values the UI has been benchmarking against.
 */
const LEGACY_STAT_COLUMNS = [
    'csDiff15', 'goldDiff15', 'xpDiff15', 'firstBlood', 'dmgGoldRatio',
    'isolatedDeaths', 'objectiveRate',
];

/**
 * Persist the computed values for one match.
 *
 * Done as a separate UPDATE rather than by widening the (already 58-column)
 * INSERT in syncMatches, so the sync path and the backfill path write these
 * through exactly the same code.
 */
async function saveComputedStats(matchId, stats, { includeLegacy = false } = {}) {
    // Stamp the row so we can tell "indexed" from "indexed, value not applicable"
    stats = { ...stats, statsComputedAt: Date.now() };
    const candidates = includeLegacy
        ? [...LEGACY_STAT_COLUMNS, ...COMPUTED_STAT_COLUMNS]
        : COMPUTED_STAT_COLUMNS;
    const cols = candidates.filter(c => stats[c] !== undefined);
    if (cols.length === 0) return;
    await dbRun(
        `UPDATE matches SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE matchId = ?`,
        [...cols.map(c => stats[c]), matchId]
    );
}

/**
 * Fill in the precomputed columns for matches that predate them.
 * Safe to re-run; only touches rows where the values are still NULL.
 *
 * `impactRank IS NULL` / `laneOpponent IS NULL` pick up rows indexed before
 * those columns existed. Neither stays NULL after a pass: the champion + team
 * that find "you" come from the same participant the row was synced from, and
 * "no lane opponent" is stored as ''.
 */
async function backfillComputedStats(onProgress) {
    const rows = await dbAll(`
        SELECT matchId, championName, teamId
        FROM matches
        WHERE rawJson IS NOT NULL
          AND (statsComputedAt IS NULL OR impactRank IS NULL OR laneOpponent IS NULL)
        ORDER BY gameCreation DESC
    `);

    let done = 0, failed = 0;
    for (const row of rows) {
        try {
            const blobs = await dbGet(
                'SELECT rawJson, timelineJson FROM matches WHERE matchId = ?',
                [row.matchId]
            );
            const raw = await decompressJsonAsync(blobs.rawJson);
            const tl  = blobs.timelineJson ? await decompressJsonAsync(blobs.timelineJson) : null;

            const stats = computeAdvancedStatsForMatch(raw, tl, row.championName, row.teamId);
            await saveComputedStats(row.matchId, stats);
            done++;
        } catch (err) {
            failed++;
            console.warn(`Backfill failed for ${row.matchId}:`, err.message);
        }
        if (onProgress) onProgress(done + failed, rows.length);
    }

    clearJsonCache();
    console.log(`Computed-stat backfill: ${done} updated, ${failed} failed, ${rows.length} total`);
    return { done, failed, total: rows.length };
}

function computeAdvancedStatsForMatch(matchData, timelineData, myChampionName, myTeamId) {
    const result = {
        csDiff15: null,
        goldDiff15: null,
        xpDiff15: null,
        firstBlood: 0,
        dmgGoldRatio: null,
        isolatedDeaths: null,
        objectiveRate: null,

        // Per-match values the analytics tabs used to derive by re-parsing
        // rawJson/timelineJson on every render. Computed once, stored, read
        // back as plain numbers.
        cs10: null, cs15: null, cs20: null,
        deathsBefore10: null,
        platesTaken: null, platesLost: null, soloKillDiff: null,
        dmgShare: null, killParticipation: null,
        dmgTakenPerDeath: null, multikills: null,
        shutdownsClaimed: null, shutdownsGiven: null, shutdownBountyGiven: null,
        enemyTeamKills: null, visionAdvantage: null, goldShare: null,
        isRemake: null,
        impactScore: null, impactRank: null, impactTag: null,
        laneOpponent: null
    };

    try {
        const info = typeof matchData === 'string' ? JSON.parse(matchData) : matchData;
        const participants = info.info ? info.info.participants : info.participants;
        if (!participants) return result;

        // Find "me"
        const me = participants.find(p => p.championName === myChampionName && p.teamId === myTeamId);
        if (!me) return result;

        const myPId = me.participantId || (participants.indexOf(me) + 1);

        // === First Blood ===
        result.firstBlood = (me.firstBloodKill || me.firstBloodAssist) ? 1 : 0;

        // === Lane opponent: same position on the other team ('' = none) ===
        const opponent = me.teamPosition
            ? participants.find(p => p.teamId !== me.teamId && p.teamPosition === me.teamPosition)
            : null;
        result.laneOpponent = opponent ? opponent.championName : '';

        // === Team impact: score, rank of 10, MVP/SVP ===
        const impact = computeTeamImpact(participants).get(myPId);
        if (impact) {
            result.impactScore = impact.score;
            result.impactRank  = impact.rank;
            result.impactTag   = impact.tag;
        }

        // === Remake ===
        // Riot's flag is authoritative; the duration check catches payloads
        // that predate it or omit it.
        const duration = (info.info ? info.info.gameDuration : info.gameDuration) || 0;
        result.isRemake = (me.gameEndedInEarlySurrender || duration < REMAKE_MAX_SECONDS) ? 1 : 0;

        // === Dmg/Gold Ratio ===
        if (me.goldEarned > 0) {
            result.dmgGoldRatio = parseFloat(((me.totalDamageDealtToChampions || 0) / me.goldEarned).toFixed(3));
        }

        // ── Values derived from the match payload alone (no timeline) ──────
        const myTeam    = participants.filter(p => p.teamId === me.teamId);
        const enemyTeam = participants.filter(p => p.teamId !== me.teamId);
        const myPosition = me.teamPosition || me.lane || '';
        const laneOpponent = myPosition
            ? enemyTeam.find(p => (p.teamPosition || p.lane || '') === myPosition)
            : null;

        const n = (v) => (Number.isFinite(v) ? v : 0);
        const safeRatio = (a, b) => (n(b) > 0 && Number.isFinite(n(a) / n(b)) ? n(a) / n(b) : null);
        const round3 = (v) => (v === null ? null : parseFloat(v.toFixed(3)));

        const teamDamage = myTeam.reduce((s, p) => s + n(p.totalDamageDealtToChampions), 0);
        const teamGold   = myTeam.reduce((s, p) => s + n(p.goldEarned), 0);
        const teamKills  = myTeam.reduce((s, p) => s + n(p.kills), 0);
        const enemyKills = enemyTeam.reduce((s, p) => s + n(p.kills), 0);

        result.dmgShare  = round3(safeRatio(me.totalDamageDealtToChampions, teamDamage));
        result.goldShare = round3(safeRatio(me.goldEarned, teamGold));
        // Stored raw rather than as a ratio so death share stays keyed off the
        // authoritative `deaths` column rather than the participant blob.
        result.enemyTeamKills = enemyKills;

        result.killParticipation = round3(
            Number.isFinite(me.challenges?.killParticipation)
                ? me.challenges.killParticipation
                : safeRatio(n(me.kills) + n(me.assists), teamKills)
        );

        // totalDamageTaken is missing on some older/alternate-queue payloads
        result.dmgTakenPerDeath = Number.isFinite(me.totalDamageTaken)
            ? round3(me.totalDamageTaken / Math.max(1, n(me.deaths)))
            : null;

        result.multikills = n(me.doubleKills) + n(me.tripleKills) + n(me.quadraKills) + n(me.pentaKills);

        if (me.challenges) {
            result.platesTaken = n(me.challenges.turretPlatesTaken);
            result.soloKillDiff = n(me.challenges.soloKills)
                - n(laneOpponent?.challenges?.soloKills);
            result.visionAdvantage = round3(n(me.challenges.visionScoreAdvantageLaneOpponent));
        }
        if (laneOpponent?.challenges) {
            result.platesLost = n(laneOpponent.challenges.turretPlatesTaken);
        }

        // Parse timeline if available
        const timeline = timelineData
            ? (typeof timelineData === 'string' ? JSON.parse(timelineData) : timelineData)
            : null;

        if (!timeline || !timeline.info || !timeline.info.frames) return result;

        const frames = timeline.info.frames;

        // === CSD@15, GD@15, XPD@15 ===
        // Frame index 15 = 15 minutes (each frame is 1 minute). Games that
        // ended before 15:00 stay null — substituting the last frame recorded
        // a fake "@15" diff for 12-minute stomps and skewed the benchmarks.
        const frame15 = frames.length > 15 ? frames[15] : null;
        if (frame15 && frame15.participantFrames) {
            const myFrame = frame15.participantFrames[myPId];
            // laneOpponent is resolved once above (same position, enemy team)
            if (myFrame && laneOpponent) {
                const oppPId = laneOpponent.participantId || (participants.indexOf(laneOpponent) + 1);
                const oppFrame = frame15.participantFrames[oppPId];
                if (oppFrame) {
                    const myCs = (myFrame.minionsKilled || 0) + (myFrame.jungleMinionsKilled || 0);
                    const oppCs = (oppFrame.minionsKilled || 0) + (oppFrame.jungleMinionsKilled || 0);
                    result.csDiff15 = myCs - oppCs;
                    result.goldDiff15 = (myFrame.totalGold || 0) - (oppFrame.totalGold || 0);
                    result.xpDiff15 = (myFrame.xp || 0) - (oppFrame.xp || 0);
                }
            }
        }

        // ── CS at 10 / 15 / 20 minutes ────────────────────────────────────
        const csAt = (minute) => {
            const frame = frames.find(f => f.timestamp >= minute * 60 * 1000)
                || frames[frames.length - 1];
            const pf = frame && frame.participantFrames && frame.participantFrames[myPId];
            return pf ? (pf.minionsKilled || 0) + (pf.jungleMinionsKilled || 0) : null;
        };
        const durationSec = (info.info ? info.info.gameDuration : info.gameDuration) || 0;
        if (durationSec >= 10 * 60) result.cs10 = csAt(10);
        if (durationSec >= 15 * 60) result.cs15 = csAt(15);
        if (durationSec >= 20 * 60) result.cs20 = csAt(20);

        // === Isolated Deaths ===
        // Deaths where no teammate is within 1500 units and no objective taken within 15s
        let isolatedCount = 0;
        const allEvents = frames.flatMap(f => f.events || []);

        // ── Early deaths and shutdown bounties, from kill events ──────────
        let earlyDeaths = 0, shutdownsClaimed = 0, shutdownsGiven = 0, bountyGiven = 0;
        for (const e of allEvents) {
            if (e.type !== 'CHAMPION_KILL') continue;
            if (e.victimId === myPId) {
                if (e.timestamp < 10 * 60 * 1000) earlyDeaths++;
                if (e.bounty && e.bounty > 300) { shutdownsGiven++; bountyGiven += e.bounty; }
            }
            if (e.killerId === myPId && e.bounty && e.bounty > 300) shutdownsClaimed++;
        }
        result.deathsBefore10      = earlyDeaths;
        result.shutdownsClaimed    = shutdownsClaimed;
        result.shutdownsGiven      = shutdownsGiven;
        result.shutdownBountyGiven = bountyGiven;
        const killEvents = allEvents.filter(e => e.type === 'CHAMPION_KILL');
        const objectiveEvents = allEvents.filter(e =>
            e.type === 'ELITE_MONSTER_KILL' || e.type === 'BUILDING_KILL'
        );

        const myDeaths = killEvents.filter(e => e.victimId === myPId);
        const myTeamPIds = participants
            .filter(p => p.teamId === me.teamId && (p.participantId || participants.indexOf(p) + 1) !== myPId)
            .map(p => p.participantId || (participants.indexOf(p) + 1));

        for (const death of myDeaths) {
            const deathPos = death.position;
            if (!deathPos) { isolatedCount++; continue; }

            // Find nearest frame to death timestamp
            const frameIdx = Math.min(Math.floor(death.timestamp / 60000), frames.length - 1);
            const nearFrame = frames[frameIdx];
            if (!nearFrame || !nearFrame.participantFrames) { isolatedCount++; continue; }

            // Check if any teammate is within 1500 units
            let hasNearbyTeammate = false;
            for (const tmPId of myTeamPIds) {
                const tmFrame = nearFrame.participantFrames[tmPId];
                if (tmFrame && tmFrame.position) {
                    const dx = deathPos.x - tmFrame.position.x;
                    const dy = deathPos.y - tmFrame.position.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist <= 1500) {
                        hasNearbyTeammate = true;
                        break;
                    }
                }
            }

            // Check if an objective was taken within 15 seconds of the death
            let objectiveNearby = false;
            for (const obj of objectiveEvents) {
                if (Math.abs(obj.timestamp - death.timestamp) <= 15000) {
                    objectiveNearby = true;
                    break;
                }
            }

            if (!hasNearbyTeammate && !objectiveNearby) {
                isolatedCount++;
            }
        }
        result.isolatedDeaths = isolatedCount;

        // === Objective Rate ===
        // % of objectives (drakes, barons, grubs) your team secured while you were alive
        const teamObjEvents = allEvents.filter(e =>
            e.type === 'ELITE_MONSTER_KILL' &&
            myTeamPIds.concat([myPId]).includes(e.killerId)
        );

        if (teamObjEvents.length > 0) {
            // Check if player was alive at each objective kill
            const myDeathTimestamps = myDeaths.map(d => d.timestamp);
            // Build alive periods: start=0, die, respawn (~20-50s based on level, use next frame alive)
            let aliveCount = 0;
            for (const obj of teamObjEvents) {
                // Simple check: was the player's most recent death before this event,
                // and enough time has passed to respawn?
                const recentDeath = myDeathTimestamps.filter(t => t < obj.timestamp).pop();
                if (!recentDeath) {
                    // Never died before this objective
                    aliveCount++;
                } else {
                    // Check if respawned: at least 15-60s based on game time
                    // Use frame data to check if player has moved since death
                    const frameIdx = Math.min(Math.floor(obj.timestamp / 60000), frames.length - 1);
                    const frame = frames[frameIdx];
                    if (frame && frame.participantFrames && frame.participantFrames[myPId]) {
                        const pos = frame.participantFrames[myPId].position;
                        // If player position is not in fountain (roughly), they're alive
                        if (pos) {
                            const inFountain = (me.teamId === 100)
                                ? (pos.x < 1500 && pos.y < 1500)
                                : (pos.x > 13500 && pos.y > 13500);
                            // If death was very recent (within 30s) and in fountain, probably dead
                            if (obj.timestamp - recentDeath < 30000 && inFountain) {
                                continue; // was dead
                            }
                            aliveCount++;
                        }
                    }
                }
            }
            result.objectiveRate = parseFloat(((aliveCount / teamObjEvents.length) * 100).toFixed(1));
        }

    } catch (e) {
        console.warn('Error computing advanced stats:', e.message);
    }

    return result;
}

// Get league/rank data for a PUUID (using new PUUID-based endpoint)
async function getLeagueData(puuid) {
    try {
        console.log('Getting league data for PUUID:', puuid);
        const leagueData = await require('./riotApi').getLeagueByPuuid(puuid);
        return leagueData;
    } catch (error) {
        console.error('Error fetching league data:', error);
        return { solo: null, flex: null };
    }
}

// Backfill timeline data for existing matches that don't have it
async function backfillTimelines(onProgress) {
    const rows = await dbAll("SELECT matchId FROM matches WHERE timelineJson IS NULL ORDER BY gameCreation DESC");
    if (rows.length === 0) {
        console.log('All matches already have timeline data.');
        return { updated: 0, failed: 0, total: 0 };
    }

    console.log(`Backfilling timeline data for ${rows.length} matches...`);
    let updated = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i++) {
        const matchId = rows[i].matchId;
        try {
            const timelineData = await getMatchTimeline(matchId);
            await dbRun("UPDATE matches SET timelineJson = ? WHERE matchId = ?", [compressJson(timelineData), matchId]);
            updated++;
            console.log(`[${i + 1}/${rows.length}] Timeline saved for ${matchId}`);
        } catch (err) {
            failed++;
            console.warn(`[${i + 1}/${rows.length}] Failed timeline for ${matchId}: ${err.message}`);
        }

        if (onProgress) onProgress(i + 1, rows.length);
    }

    console.log(`Backfill complete: ${updated} updated, ${failed} failed out of ${rows.length}`);
    return { updated, failed, total: rows.length };
}

// Backfill advanced stats for existing matches that have rawJson but no advanced stats
async function backfillAdvancedStats(onProgress) {
    const rows = await dbAll(
        "SELECT matchId, rawJson, timelineJson, championName, teamId FROM matches WHERE rawJson IS NOT NULL AND csDiff15 IS NULL ORDER BY gameCreation DESC"
    );
    if (rows.length === 0) {
        console.log('All matches already have advanced stats.');
        return { updated: 0, total: 0 };
    }

    console.log(`Computing advanced stats for ${rows.length} matches...`);
    let updated = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
            const rawData = await decompressJsonAsync(row.rawJson);
            const tlData = await decompressJsonAsync(row.timelineJson);
            const stats = computeAdvancedStatsForMatch(rawData, tlData, row.championName, row.teamId);
            await dbRun(
                `UPDATE matches SET csDiff15 = ?, goldDiff15 = ?, xpDiff15 = ?, firstBlood = ?, dmgGoldRatio = ?, isolatedDeaths = ?, objectiveRate = ? WHERE matchId = ?`,
                [stats.csDiff15, stats.goldDiff15, stats.xpDiff15, stats.firstBlood, stats.dmgGoldRatio, stats.isolatedDeaths, stats.objectiveRate, row.matchId]
            );
            updated++;
        } catch (err) {
            console.warn(`Failed advanced stats for ${row.matchId}: ${err.message}`);
        }

        if (onProgress) onProgress(i + 1, rows.length);
    }

    console.log(`Advanced stats backfill complete: ${updated}/${rows.length}`);
    return { updated, total: rows.length };
}

// === Player Rank Caching ===
const RANK_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function getPlayerRank(puuid, maxAgeMs = RANK_CACHE_TTL_MS) {
    // Check cache first
    const cached = await dbGet(
        "SELECT * FROM player_ranks WHERE puuid = ? AND fetchedAt > ?",
        [puuid, Date.now() - maxAgeMs]
    );
    if (cached) return cached;

    // Fetch from API
    try {
        const leagueData = await require('./riotApi').getLeagueByPuuid(puuid);
        const now = Date.now();

        const row = {
            puuid,
            soloTier: leagueData.solo?.tier || null,
            soloRank: leagueData.solo?.rank || null,
            soloLP: leagueData.solo?.leaguePoints ?? null,
            flexTier: leagueData.flex?.tier || null,
            flexRank: leagueData.flex?.rank || null,
            flexLP: leagueData.flex?.leaguePoints ?? null,
            fetchedAt: now
        };

        await dbRun(
            `INSERT INTO player_ranks (puuid, soloTier, soloRank, soloLP, flexTier, flexRank, flexLP, fetchedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(puuid) DO UPDATE SET
                soloTier=excluded.soloTier, soloRank=excluded.soloRank, soloLP=excluded.soloLP,
                flexTier=excluded.flexTier, flexRank=excluded.flexRank, flexLP=excluded.flexLP,
                fetchedAt=excluded.fetchedAt`,
            [row.puuid, row.soloTier, row.soloRank, row.soloLP, row.flexTier, row.flexRank, row.flexLP, row.fetchedAt]
        );

        return row;
    } catch (error) {
        console.warn(`Failed to fetch rank for ${puuid}: ${error.message}`);
        // Return stale cache if available
        const stale = await dbGet("SELECT * FROM player_ranks WHERE puuid = ?", [puuid]);
        return stale || null;
    }
}

// Get cached rank data for all participants in a match (no API calls)
async function getMatchParticipantRanks(matchId) {
    const match = await dbGet("SELECT rawJson FROM matches WHERE matchId = ?", [matchId]);
    if (!match || !match.rawJson) return {};

    const data = decompressJson(match.rawJson);
    const participants = data.info.participants;

    const puuids = participants.map(p => p.puuid).filter(Boolean);
    const rankMap = {};
    for (const puuid of puuids) rankMap[puuid] = null;

    if (puuids.length > 0) {
        const rows = await dbAll(
            `SELECT * FROM player_ranks WHERE puuid IN (${puuids.map(() => '?').join(',')})`,
            puuids
        );
        for (const row of rows) rankMap[row.puuid] = row;
    }

    return rankMap;
}

// Fetch ranks for participants of newly synced matches only
async function fetchRanksForNewMatches(matchIds, onProgress) {
    if (!matchIds || matchIds.length === 0) return { fetched: 0, failed: 0, total: 0 };

    // Collect unique PUUIDs from the new matches (batched blob fetch)
    const allPuuids = new Set();
    for (const ids of chunk(matchIds, SQL_VAR_LIMIT)) {
        const rows = await dbAll(
            `SELECT rawJson FROM matches WHERE matchId IN (${ids.map(() => '?').join(',')}) AND rawJson IS NOT NULL`,
            ids
        );
        for (const row of rows) {
            try {
                const data = decompressJson(row.rawJson);
                for (const p of data.info.participants) {
                    if (p.puuid && p.puuid.length >= 40) allPuuids.add(p.puuid);
                }
            } catch (e) { /* skip malformed */ }
        }
    }

    // Filter out those already cached within TTL (one batched query)
    const cutoff = Date.now() - RANK_CACHE_TTL_MS;
    const freshPuuids = new Set();
    for (const ids of chunk([...allPuuids], SQL_VAR_LIMIT)) {
        const rows = await dbAll(
            `SELECT puuid FROM player_ranks WHERE fetchedAt > ? AND puuid IN (${ids.map(() => '?').join(',')})`,
            [cutoff, ...ids]
        );
        for (const row of rows) freshPuuids.add(row.puuid);
    }
    const puuidsToFetch = [...allPuuids].filter(p => !freshPuuids.has(p));

    if (puuidsToFetch.length === 0) {
        console.log('All player ranks for new matches are already cached.');
        return { fetched: 0, failed: 0, total: 0 };
    }

    console.log(`Fetching ranks for ${puuidsToFetch.length} players from ${matchIds.length} new matches...`);
    let fetched = 0;
    let failed = 0;

    for (let i = 0; i < puuidsToFetch.length; i++) {
        const MAX_RETRIES = 2;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                await getPlayerRank(puuidsToFetch[i], 0);
                fetched++;
                break;
            } catch (err) {
                if (attempt < MAX_RETRIES) {
                    await sleep(1000 * (attempt + 1));
                } else {
                    failed++;
                    console.warn(`Failed rank for player ${i + 1}/${puuidsToFetch.length}: ${err.message}`);
                }
            }
        }

        if (onProgress) onProgress(i + 1, puuidsToFetch.length);
    }

    console.log(`Rank fetch complete: ${fetched} fetched, ${failed} failed`);
    return { fetched, failed, total: puuidsToFetch.length };
}

const {
    saveLpSnapshot, getLpHistory,
    recordLpReading, getLpReadings, attachLpReadingsToMatches,
    getLpDeltasByMatch, absoluteLp,
    addLpCheckpoint, deleteLpCheckpoint, getLpCheckpoints
} = require('./database');

module.exports = { syncMatches, getMatches, getStats, getMatchById, getLeagueData, backfillTimelines, backfillAdvancedStats, getMatchParticipantRanks, fetchRanksForNewMatches, saveLpSnapshot, getLpHistory,
    recordLpReading, getLpReadings, attachLpReadingsToMatches, getLpDeltasByMatch, absoluteLp,
    addLpCheckpoint, deleteLpCheckpoint, getLpCheckpoints,
    loadRawJson, loadTimelineJson, getCachedRawJson, getCachedTimelineJson, clearJsonCache,
    getCoachingData, saveComputedStats, backfillComputedStats,
    computeAdvancedStatsForMatch, COMPUTED_STAT_COLUMNS };


