/**
 * helpers.js — fixture builders + a stub for services/database.
 *
 * The analytics engine and matchService both reach for `services/database`,
 * which opens the real SQLite file in %APPDATA% and runs migrations. Tests
 * install an in-memory stub in its place before anything requires it.
 */
const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, '..', 'src');

/**
 * Replace services/database with a fake whose rows come from `rows`.
 * Must be called before requiring matchService.
 */
function stubDatabase(rows = []) {
    const dbModPath = path.join(SRC, 'services', 'database.js');

    const byId = new Map(rows.map(r => [r.matchId, r]));

    const db = {
        all(sql, params, cb) {
            if (typeof params === 'function') { cb = params; params = []; }
            try {
                if (/FROM matches WHERE matchId IN/i.test(sql)) {
                    const col = /SELECT matchId, (\w+)/i.exec(sql)[1];
                    const out = params
                        .filter(id => byId.has(id))
                        .map(id => ({ matchId: id, [col]: byId.get(id)[col] ?? null }));
                    return cb(null, out);
                }
                cb(null, rows);
            } catch (e) { cb(e); }
        },
        get(sql, params, cb) {
            if (typeof params === 'function') { cb = params; params = []; }
            cb(null, byId.get(params[0]) ?? rows[0] ?? undefined);
        },
        run(sql, params, cb) { if (cb) cb.call({}, null); },
    };

    const stub = new Module(dbModPath, null);
    stub.filename = dbModPath;
    stub.loaded = true;
    stub.exports = { db, initDatabase: () => {} };
    require.cache[dbModPath] = stub;

    return db;
}

/** Clear a module from the require cache so it re-initialises. */
function fresh(relPath) {
    const p = require.resolve(path.join(SRC, relPath));
    delete require.cache[p];
    return require(p);
}

// ---------------------------------------------------------------------------
// FIXTURES
// ---------------------------------------------------------------------------

let seq = 0;

/**
 * A match row shaped like what getMatches() returns (scalar columns only).
 * Overridable field by field.
 */
function makeMatch(overrides = {}) {
    seq += 1;
    return {
        matchId: `EUW1_${1000 + seq}`,
        queueId: 420,
        gameCreation: Date.UTC(2026, 0, 10, 18, 0, 0) + seq * 3600_000,
        gameDuration: 1800,
        championName: 'Ahri',
        champLevel: 15,
        win: 1,
        kills: 8, deaths: 4, assists: 10,
        goldEarned: 12000,
        totalMinionsKilled: 200,
        totalDamageDealtToChampions: 25000,
        visionScore: 30,
        doubleKills: 0, tripleKills: 0, quadraKills: 0, pentaKills: 0,
        turretKills: 1, inhibitorKills: 0, dragonKills: 0, baronKills: 0,
        objectivesStolen: 0,
        wardsPlaced: 12, wardsKilled: 4, detectorWardsPlaced: 3,
        teamPosition: 'MIDDLE', lane: 'MIDDLE',
        item0: 1, item1: 2, item2: 3, item3: 4, item4: 5, item5: 6, item6: 7,
        teamDragons: 2, enemyDragons: 1, teamBarons: 1, enemyBarons: 0,
        teamRiftHeralds: 1, enemyRiftHeralds: 0,
        teamTowers: 8, enemyTowers: 3,
        teamInhibitors: 1, enemyInhibitors: 0,
        teamId: 100, teamKills: 30,
        primaryRune: 8112, secondaryRuneStyle: 8200,
        csDiff15: 5, goldDiff15: 300, xpDiff15: 200,
        firstBlood: 0, dmgGoldRatio: 2.1, isolatedDeaths: 1, objectiveRate: 0.6,
        ...overrides,
    };
}

/** Minimal Match-V5 rawJson for a match row. */
function makeRawJson(match, extra = {}) {
    const mk = (id, teamId, championName, pos) => ({
        participantId: id,
        teamId,
        championName,
        teamPosition: pos,
        kills: 3, deaths: 2, assists: 5,
        goldEarned: 10000,
        totalDamageDealtToChampions: 20000,
        totalMinionsKilled: 180,
        visionScore: 25,
        summoner1Id: 4, summoner2Id: 14,
        riotIdGameName: `Player${id}`,
        challenges: {
            turretPlatesTaken: 2,
            soloKills: 1,
            damagePerGold: 2.0,
            killParticipation: 0.5,
            visionScoreAdvantageLaneOpponent: 0.1,
        },
    });

    const participants = [
        { ...mk(1, 100, match.championName, match.teamPosition),
          goldEarned: match.goldEarned,
          totalDamageDealtToChampions: match.totalDamageDealtToChampions },
        mk(2, 100, 'Garen', 'TOP'),
        mk(3, 100, 'LeeSin', 'JUNGLE'),
        mk(4, 100, 'Jinx', 'BOTTOM'),
        mk(5, 100, 'Thresh', 'UTILITY'),
        mk(6, 200, 'Zed', match.teamPosition),
        mk(7, 200, 'Darius', 'TOP'),
        mk(8, 200, 'Elise', 'JUNGLE'),
        mk(9, 200, 'Caitlyn', 'BOTTOM'),
        mk(10, 200, 'Leona', 'UTILITY'),
    ];

    return JSON.stringify({
        info: { gameDuration: match.gameDuration, queueId: match.queueId, participants },
        ...extra,
    });
}

/** Minimal timeline with CS progression and a couple of kill events. */
function makeTimelineJson(match, { earlyDeaths = 1 } = {}) {
    const frames = [];
    for (let minute = 0; minute <= 25; minute++) {
        const participantFrames = {};
        for (let p = 1; p <= 10; p++) {
            participantFrames[p] = {
                minionsKilled: minute * 7,
                jungleMinionsKilled: 0,
                totalGold: 500 + minute * 350,
                xp: minute * 400,
            };
        }
        const events = [];
        // Deaths of participant 1 inside the first 10 minutes
        if (minute === 5 && earlyDeaths > 0) {
            for (let i = 0; i < earlyDeaths; i++) {
                events.push({ type: 'CHAMPION_KILL', victimId: 1, killerId: 6, timestamp: 5 * 60_000, bounty: 400 });
            }
        }
        if (minute === 14) {
            events.push({ type: 'ELITE_MONSTER_KILL', monsterType: 'DRAGON', timestamp: 14 * 60_000, killerId: 3 });
        }
        frames.push({ timestamp: minute * 60_000, participantFrames, events });
    }
    return JSON.stringify({ info: { frames } });
}

/** A full DB-shaped row: scalars + the two JSON blobs. */
function makeRow(overrides = {}, opts = {}) {
    const match = makeMatch(overrides);
    return {
        ...match,
        rawJson: makeRawJson(match),
        timelineJson: makeTimelineJson(match, opts),
    };
}

function resetSeq() { seq = 0; }

module.exports = { SRC, stubDatabase, fresh, makeMatch, makeRawJson, makeTimelineJson, makeRow, resetSeq };
