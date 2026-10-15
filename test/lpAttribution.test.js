const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { SRC } = require('./helpers');

const { absoluteLp, gamesBetween, attributeReadings, deltasByMatch } =
    require(path.join(SRC, 'services', 'lpAttribution.js'));

const MIN = 60 * 1000;
const T0  = Date.UTC(2026, 9, 1, 18, 0);

/** Reading `m` minutes after T0. wins/losses optional (old rows have none). */
const reading = (id, m, extra = {}) => ({ id, recorded_at: T0 + m * MIN, ...extra });
const game    = (matchId, endMin) => ({ matchId, endAt: T0 + endMin * MIN });
const links   = (readings, games) => Object.fromEntries(attributeReadings(readings, games));

test('absoluteLp is continuous across divisions, tiers and apex', () => {
    assert.equal(absoluteLp('GOLD', 'I', 98) + 10, absoluteLp('PLATINUM', 'IV', 8));
    assert.equal(absoluteLp('SILVER', 'II', 50) - absoluteLp('SILVER', 'III', 70), 80);
    assert.equal(absoluteLp('MASTER', 'I', 120), absoluteLp('DIAMOND', 'IV', 0) + 400 + 120);
    assert.equal(absoluteLp('GRANDMASTER', 'I', 300), absoluteLp('MASTER', 'I', 300));
});

test('gamesBetween counts wins + losses, null when either side lacks them', () => {
    assert.equal(gamesBetween({ wins: 10, losses: 9 }, { wins: 11, losses: 9 }), 1);
    assert.equal(gamesBetween({ wins: 10, losses: 9 }, { wins: 10, losses: 9 }), 0);
    assert.equal(gamesBetween({ wins: 10, losses: 9 }, { wins: 11, losses: 10 }), 2);
    assert.equal(gamesBetween({}, { wins: 11, losses: 9 }), null);
    assert.equal(gamesBetween({ wins: null, losses: null }, { wins: 1, losses: 0 }), null);
});

test('back-to-back games: a reading taken before its game is synced waits instead of taking the previous game', () => {
    // A ends at 30, read at 31 (−18). B ends at 70, read at 71 (+21) — but B isn't stored yet.
    const readings = [
        reading(1, 0,  { wins: 10, losses: 10 }),
        reading(2, 31, { wins: 10, losses: 11 }),
        reading(3, 71, { wins: 11, losses: 11 }),
    ];
    assert.deepEqual(links(readings, [game('A', 30)]), { 1: null, 2: 'A', 3: null });
    // After the next sync B is stored and the reading finds it.
    assert.deepEqual(links(readings, [game('A', 30), game('B', 70)]), { 1: null, 2: 'A', 3: 'B' });
});

test('same scenario on old readings without wins/losses', () => {
    const readings = [reading(1, 0), reading(2, 31), reading(3, 71)];
    assert.deepEqual(links(readings, [game('A', 30)]), { 1: null, 2: 'A', 3: null });
    assert.deepEqual(links(readings, [game('A', 30), game('B', 70)]), { 1: null, 2: 'A', 3: 'B' });
});

test('an LP change with no game played (refund, decay) is not credited to any game', () => {
    const readings = [
        reading(1, 0,   { wins: 10, losses: 10 }),
        reading(2, 31,  { wins: 10, losses: 11 }),
        reading(3, 200, { wins: 10, losses: 11 }),   // +LP later, same W/L
    ];
    assert.deepEqual(links(readings, [game('A', 30)]), { 1: null, 2: 'A', 3: null });
});

test('a change covering two games is not split or pinned on one of them', () => {
    const counted = [reading(1, 0, { wins: 10, losses: 10 }), reading(2, 90, { wins: 11, losses: 11 })];
    // Even if only one of the two games is stored so far
    assert.deepEqual(links(counted, [game('A', 30)]), { 1: null, 2: null });
    assert.deepEqual(links(counted, [game('A', 30), game('B', 80)]), { 1: null, 2: null });

    const old = [reading(1, 0), reading(2, 90)];
    assert.deepEqual(links(old, [game('A', 30), game('B', 80)]), { 1: null, 2: null });
});

test('one game counted but none or two stored in the window: no link', () => {
    const readings = [reading(1, 0, { wins: 1, losses: 0 }), reading(2, 60, { wins: 2, losses: 0 })];
    assert.deepEqual(links(readings, []), { 1: null, 2: null });
    assert.deepEqual(links(readings, [game('A', 20), game('B', 50)]), { 1: null, 2: null });
});

test('a game is never credited to two readings', () => {
    const readings = [reading(1, 0), reading(2, 31), reading(3, 40), reading(4, 50)];
    const out = links(readings, [game('A', 30)]);
    assert.equal(Object.values(out).filter(v => v === 'A').length, 1);
});

test('deltasByMatch measures each linked reading against the one before it, and adds up', () => {
    const readings = [
        { id: 1, tier: 'GOLD', rank: 'I',  lp: 90, matchId: null },
        { id: 2, tier: 'PLATINUM', rank: 'IV', lp: 8, matchId: 'A' },   // +18 across the promotion
        { id: 3, tier: 'PLATINUM', rank: 'IV', lp: 0, matchId: 'B' },   // −8
        { id: 4, tier: 'PLATINUM', rank: 'IV', lp: 5, matchId: null },  // refund, unlinked
        { id: 5, tier: 'PLATINUM', rank: 'IV', lp: 9, matchId: 'B' },   // defensive: a second link adds
    ];
    assert.deepEqual(deltasByMatch(readings), { A: 18, B: -8 + 4 });
});

// ---------------------------------------------------------------------------
// database.js against a real (temporary) SQLite file
// ---------------------------------------------------------------------------

test('database: readings keep W/L, links are recomputed, deltas come out per game', async () => {
    const os = require('os');
    const fs = require('fs');
    const Module = require('module');

    // Point services/paths at a throwaway folder before database.js opens its file.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-lp-'));
    const pathsFile = path.join(SRC, 'services', 'paths.js');
    const fake = new Module(pathsFile);
    fake.filename = pathsFile; fake.loaded = true; fake.exports = { userDataPath: dir };
    require.cache[pathsFile] = fake;
    const dbFile = path.join(SRC, 'services', 'database.js');
    delete require.cache[dbFile];
    const DB = require(dbFile);

    const run = (sql, p = []) => new Promise((res, rej) => DB.db.run(sql, p, e => e ? rej(e) : res()));
    const all = (sql, p = []) => new Promise((res, rej) => DB.db.all(sql, p, (e, r) => e ? rej(e) : res(r)));

    try {
        await run(`CREATE TABLE matches (matchId TEXT PRIMARY KEY, queueId INTEGER,
                   gameCreation INTEGER, gameDuration INTEGER, isRemake INTEGER)`);
        await run(`CREATE TABLE lp_history (id INTEGER PRIMARY KEY AUTOINCREMENT, queue TEXT NOT NULL,
                   tier TEXT, rank TEXT, lp INTEGER NOT NULL, recorded_date TEXT NOT NULL,
                   recorded_at INTEGER NOT NULL, matchId TEXT, wins INTEGER, losses INTEGER)`);

        const at = (m) => T0 + m * MIN;
        const addReading = (m, lp, wins, losses, matchId = null) => run(
            `INSERT INTO lp_history (queue, tier, rank, lp, recorded_date, recorded_at, matchId, wins, losses)
             VALUES ('solo', 'GOLD', 'II', ?, '2026-10-01', ?, ?, ?, ?)`, [lp, at(m), matchId, wins, losses]);
        const addGame = (id, startMin, seconds, isRemake = 0) => run(
            'INSERT INTO matches VALUES (?, 420, ?, ?, ?)', [id, at(startMin), seconds, isRemake]);

        await addReading(0, 50, 10, 10);
        await addGame('A', 0, 1800);              // ends at 30
        await addReading(31, 32, 10, 11);          // −18 for A
        // B ended at 70 but wasn't synced yet; an old version linked this to A.
        await addReading(71, 53, 11, 11, 'A');
        await addGame('R', 75, 200, 1);            // a remake: never a candidate

        let res = await DB.attachLpReadingsToMatches();
        let rows = await all('SELECT id, matchId FROM lp_history ORDER BY id');
        assert.deepEqual(rows.map(r => r.matchId), [null, 'A', null], 'the wrong link to A is undone');
        assert.ok(res.linked >= 2);
        assert.deepEqual(await DB.getLpDeltasByMatch(), { A: -18 });

        await addGame('B', 40, 1800);              // now synced, ends at 70
        await DB.attachLpReadingsToMatches();
        assert.deepEqual(await DB.getLpDeltasByMatch(), { A: -18, B: 21 });

        // recordLpReading stores W/L, and a game that moved W/L but not LP is still recorded
        const same = await DB.recordLpReading('solo', 'GOLD', 'II', 53, { wins: 11, losses: 11 });
        assert.equal(same.changed, false);
        const zero = await DB.recordLpReading('solo', 'GOLD', 'II', 53, { wins: 11, losses: 12 });
        assert.equal(zero.changed, true);
        assert.equal(zero.delta, 0);
        const last = (await all('SELECT wins, losses FROM lp_history ORDER BY id DESC LIMIT 1'))[0];
        assert.deepEqual({ ...last }, { wins: 11, losses: 12 });
    } finally {
        await new Promise(r => DB.db.close(r));
        delete require.cache[pathsFile];
        delete require.cache[dbFile];
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
