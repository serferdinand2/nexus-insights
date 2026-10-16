const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Module = require('module');
const sqlite3 = require('sqlite3');
const { SRC } = require('./helpers');

test('a write waits for a lock held by the other connection instead of failing (#35)', async () => {
    // Point services/paths at a throwaway folder before database.js opens its file.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-busy-'));
    const pathsFile = path.join(SRC, 'services', 'paths.js');
    const fake = new Module(pathsFile);
    fake.filename = pathsFile; fake.loaded = true; fake.exports = { userDataPath: dir };
    require.cache[pathsFile] = fake;
    const dbFile = path.join(SRC, 'services', 'database.js');
    delete require.cache[dbFile];
    const DB = require(dbFile);

    // A second connection to the same file, like the other process
    const other = new sqlite3.Database(path.join(dir, 'nexus_data.sqlite'));
    const on = (conn, sql) => new Promise((res, rej) => conn.run(sql, e => (e ? rej(e) : res())));

    try {
        await on(DB.db, 'CREATE TABLE t (v INTEGER)');
        await on(other, 'BEGIN EXCLUSIVE');
        await on(other, 'INSERT INTO t VALUES (1)');
        setTimeout(() => other.run('COMMIT'), 2000);  // longer than sqlite3's own 1 s default

        const started = Date.now();
        await on(DB.db, 'INSERT INTO t VALUES (2)');  // with sqlite3's default: SQLITE_BUSY after 1 s
        assert.ok(Date.now() - started >= 1900, 'it waited for the lock');

        const rows = await new Promise((res, rej) => DB.db.all('SELECT v FROM t ORDER BY v', (e, r) => (e ? rej(e) : res(r))));
        assert.deepEqual(rows.map(r => r.v), [1, 2]);
    } finally {
        await new Promise(r => other.close(r));
        await new Promise(r => DB.db.close(r));
        delete require.cache[pathsFile];
        delete require.cache[dbFile];
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
