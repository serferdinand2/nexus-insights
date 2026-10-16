/**
 * Issue #5: LP checkpoints stored in the database (replacing the hard-coded
 * SOLO_LP_SEED), against a real temporary SQLite file.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Module = require('module');
const { SRC } = require('./helpers');

test('checkpoints: add, list, delete only manual rows; migration marks old seed rows', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ckpt-'));
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
        await run(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`);
        await run(`CREATE TABLE matches (matchId TEXT PRIMARY KEY, queueId INTEGER, gameCreation INTEGER,
                   gameDuration INTEGER, isRemake INTEGER)`);
        // An lp_history from before migration 5 (no `manual` column yet)
        await run(`CREATE TABLE lp_history (id INTEGER PRIMARY KEY AUTOINCREMENT, queue TEXT NOT NULL,
                   tier TEXT, rank TEXT, lp INTEGER NOT NULL, recorded_date TEXT NOT NULL,
                   recorded_at INTEGER NOT NULL, matchId TEXT, wins INTEGER, losses INTEGER)`);
        const noon = d => new Date(d + 'T12:00:00Z').getTime();
        // An old seed row (noon UTC, no W/L) and a tracked reading
        await run(`INSERT INTO lp_history (queue, tier, rank, lp, recorded_date, recorded_at) VALUES ('solo','EMERALD','IV',16,'2026-04-15',?)`, [noon('2026-04-15')]);
        await run(`INSERT INTO lp_history (queue, tier, rank, lp, recorded_date, recorded_at, wins, losses) VALUES ('solo','SILVER','II',79,'2026-10-14',?,40,38)`, [noon('2026-10-14') + 1234]);

        await DB.migrateLpCheckpoints();
        let rows = await all('SELECT recorded_date, manual FROM lp_history ORDER BY id');
        assert.deepEqual(rows.map(r => [r.recorded_date, r.manual]), [['2026-04-15', 1], ['2026-10-14', null]],
            'the seed row becomes a deletable checkpoint; the tracked reading does not');
        await DB.migrateLpCheckpoints();                     // runs once only
        assert.equal((await all('SELECT * FROM schema_version WHERE version = 5')).length, 1);

        const added = await DB.addLpCheckpoint('flex', 'GOLD', 'I', 78, '2026-09-01');
        assert.ok(added.id > 0);
        const list = await DB.getLpCheckpoints();
        assert.deepEqual(list.map(c => [c.queue, c.recorded_date, c.tier, c.rank, c.lp]),
            [['flex', '2026-09-01', 'GOLD', 'I', 78], ['solo', '2026-04-15', 'EMERALD', 'IV', 16]]);
        const flexReading = (await DB.getLpReadings('flex'))[0];
        assert.equal(flexReading.recorded_at, noon('2026-09-01'), 'a checkpoint stands at noon UTC of its date');

        await assert.rejects(DB.addLpCheckpoint('solo', 'GOLD', 'V', 10, '2026-09-01'), /division/);
        await assert.rejects(DB.addLpCheckpoint('solo', 'GOLD', 'I', 120, '2026-09-01'), /LP/);
        await assert.rejects(DB.addLpCheckpoint('solo', 'GOLD', 'I', 50, 'not a date'), /date/);

        // Delete only ever touches manual rows
        const tracked = (await all("SELECT id FROM lp_history WHERE manual IS NULL"))[0].id;
        assert.equal(await DB.deleteLpCheckpoint(tracked), 0);
        assert.equal(await DB.deleteLpCheckpoint(added.id), 1);
        assert.deepEqual((await DB.getLpCheckpoints()).map(c => c.queue), ['solo']);
    } finally {
        await new Promise(r => DB.db.close(r));
        delete require.cache[pathsFile];
        delete require.cache[dbFile];
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
