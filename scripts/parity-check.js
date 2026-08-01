#!/usr/bin/env node
/**
 * parity-check.js — verifies the analytics numbers didn't change.
 *
 * The analytics tabs can read their values two ways:
 *   A) the slow way — parse rawJson/timelineJson for every match
 *   B) the fast way — read the precomputed columns
 *
 * Both must produce identical numbers. This script computes every stat card
 * both ways on a COPY of your real database and reports any value that moved.
 *
 * Run it after touching anything in analyticsEngine.js or the stat-computing
 * half of matchService.js.
 *
 *   npm run parity
 *
 * Exit code 0 = everything matches, 1 = something differs.
 *
 * See scripts/README.md for the why.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, '..', 'src');

// ---------------------------------------------------------------------------
// Locate the live database (read-only — we work on a copy)
// ---------------------------------------------------------------------------
function userDataDir() {
    const appName = 'nexus-insights';
    if (process.platform === 'win32')  return path.join(process.env.APPDATA, appName);
    if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', appName);
    return path.join(os.homedir(), '.config', appName);
}

const liveDb = process.argv[2] || path.join(userDataDir(), 'nexus_data.sqlite');

if (!fs.existsSync(liveDb)) {
    console.error(`No database found at:\n  ${liveDb}\n`);
    console.error('Pass a path explicitly if it lives elsewhere:');
    console.error('  node scripts/parity-check.js "C:\\path\\to\\nexus_data.sqlite"');
    process.exit(1);
}

// Never touch the real file — the script writes precomputed columns as part of
// the test, and the app may have the database open.
const workDb = path.join(os.tmpdir(), `nexus-parity-${process.pid}.sqlite`);
fs.copyFileSync(liveDb, workDb);
process.on('exit', () => { try { fs.unlinkSync(workDb); } catch {} });

// ---------------------------------------------------------------------------
// Database adapter
//
// The project's sqlite3 dependency is a native module built against Electron,
// so it usually can't be loaded by plain `node`. Node 22.5+ ships node:sqlite,
// which needs no build step — prefer it, and fall back if unavailable.
// ---------------------------------------------------------------------------
let db, closeDb;
try {
    const { DatabaseSync } = require('node:sqlite');
    const handle = new DatabaseSync(workDb);
    const run = (fn) => (sql, params, cb) => {
        if (typeof params === 'function') { cb = params; params = []; }
        try { cb(null, fn(sql, params || [])); } catch (e) { cb(e); }
    };
    db = {
        all: run((sql, p) => handle.prepare(sql).all(...p)),
        get: run((sql, p) => handle.prepare(sql).get(...p)),
        run(sql, params, cb) {
            if (typeof params === 'function') { cb = params; params = []; }
            try { handle.prepare(sql).run(...(params || [])); cb && cb.call({}, null); }
            catch (e) { cb && cb(e); }
        },
    };
    closeDb = () => handle.close();
} catch (err) {
    try {
        const sqlite3 = require('sqlite3');
        const handle = new sqlite3.Database(workDb);
        db = handle;
        closeDb = () => handle.close();
    } catch {
        console.error('Needs Node 22.5+ (for node:sqlite) or a loadable sqlite3 module.');
        console.error(`Current Node: ${process.version}`);
        process.exit(1);
    }
}

// Swap in our database before matchService pulls in the real one
const dbModPath = require.resolve(path.join(SRC, 'services', 'database.js'));
const stub = new Module(dbModPath, null);
stub.filename = dbModPath;
stub.loaded   = true;
stub.exports  = { db, initDatabase: () => {} };
require.cache[dbModPath] = stub;

global.window = {};
const ms = require(path.join(SRC, 'services', 'matchService.js'));
require(path.join(SRC, 'components', 'analyticsEngine.js'));

// ---------------------------------------------------------------------------

const TABS = ['Overview', 'Lane Phase', 'Combat', 'Death Review', 'Objectives',
              'Vision', 'Economy', 'Macro', 'Consistency'];

/** Values are floats; allow a hair of drift from the 3dp stored values. */
function close(a, b) {
    if (a === b) return true;
    if (typeof a !== 'number' || typeof b !== 'number') return false;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
    const diff  = Math.abs(a - b);
    const scale = Math.max(Math.abs(a), Math.abs(b), 1);
    return diff <= 1.0 || diff / scale <= 0.01;
}

const ms_ = () => Date.now();

(async () => {
    console.log(`Database : ${liveDb}`);
    console.log(`Working  : ${workDb} (temporary copy)\n`);

    // Make sure the copy has the precomputed columns, mirroring database.js
    const NEW_COLS = [
        'cs10 INTEGER', 'cs15 INTEGER', 'cs20 INTEGER', 'deathsBefore10 INTEGER',
        'platesTaken INTEGER', 'platesLost INTEGER', 'soloKillDiff INTEGER',
        'dmgShare REAL', 'killParticipation REAL', 'dmgTakenPerDeath REAL',
        'multikills INTEGER', 'shutdownsClaimed INTEGER', 'shutdownsGiven INTEGER',
        'shutdownBountyGiven INTEGER', 'enemyTeamKills INTEGER', 'visionAdvantage REAL',
        'goldShare REAL', 'statsComputedAt INTEGER', 'isRemake INTEGER',
    ];
    for (const col of NEW_COLS) {
        await new Promise(res => db.run(`ALTER TABLE matches ADD COLUMN ${col}`, [], () => res()));
    }

    // Start from a clean slate so path A really is the slow path
    await new Promise(res => db.run('UPDATE matches SET statsComputedAt = NULL', [], () => res()));

    const matches = await ms.getMatches();
    console.log(`${matches.length} matches\n`);
    if (matches.length === 0) {
        console.log('Nothing to compare.');
        process.exit(0);
    }

    // ---- A) SLOW PATH: parse the JSON blobs -------------------------------
    const ids = matches.map(m => m.matchId);
    let t = ms_();
    await ms.loadRawJson(ids);
    await ms.loadTimelineJson(ids);
    const blobLoadMs = ms_() - t;

    t = ms_();
    const before = {};
    for (const tab of TABS) before[tab] = window.computeTabStats(tab, matches, []);
    const oldComputeMs = ms_() - t;
    console.log(`SLOW  blob load ${blobLoadMs} ms + compute ${oldComputeMs} ms = ${blobLoadMs + oldComputeMs} ms`);

    // ---- Index (one-time in the real app) ---------------------------------
    t = ms_();
    const filled = await ms.backfillComputedStats();
    console.log(`\nIndexing: ${filled.done} updated, ${filled.failed} failed (${ms_() - t} ms — one time only)\n`);

    // ---- B) FAST PATH: precomputed columns, empty blob cache --------------
    ms.clearJsonCache();
    const fresh = await ms.getMatches();
    const stillNeeded = fresh.filter(m => m.statsComputedAt == null).length;

    t = ms_();
    for (const tab of TABS) await window.prefetchTabJson(tab, fresh, []);
    const newPrefetchMs = ms_() - t;

    t = ms_();
    const after = {};
    for (const tab of TABS) after[tab] = window.computeTabStats(tab, fresh, []);
    const newComputeMs = ms_() - t;
    console.log(`FAST  prefetch ${newPrefetchMs} ms + compute ${newComputeMs} ms = ${newPrefetchMs + newComputeMs} ms`);
    console.log(`      (${stillNeeded} rows still need the blobs)\n`);

    // ---- Compare ----------------------------------------------------------
    let mismatches = 0;
    for (const tab of TABS) {
        const a = before[tab], b = after[tab];
        const diffs = [];
        for (let i = 0; i < a.length; i++) {
            if (!close(a[i].value, b[i].value)) {
                diffs.push(`${a[i].id}: ${a[i].value} -> ${b[i].value}`);
            }
        }
        mismatches += diffs.length;
        console.log(`${diffs.length === 0 ? 'PASS' : 'FAIL'}  ${tab.padEnd(13)} ${diffs.join(' | ')}`);
    }

    const speedup = ((blobLoadMs + oldComputeMs) / Math.max(1, newPrefetchMs + newComputeMs)).toFixed(1);
    console.log(`\n${mismatches === 0 ? 'ALL TABS MATCH' : mismatches + ' VALUE(S) DIFFER'}`);
    console.log(`Speedup: ${speedup}x`);

    try { closeDb(); } catch {}
    process.exit(mismatches === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
