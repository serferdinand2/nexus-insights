#!/usr/bin/env node
/**
 * build-installer.js — produce a clean, shareable Windows installer.
 *
 *   npm run dist          (or double-click "Build Installer.bat")
 *
 * Output: dist\Nexus Insights Setup <version>.exe
 *
 * WHY THIS ISN'T JUST `electron-builder`
 * --------------------------------------
 * The source contains one piece of personal data: SOLO_LP_SEED in
 * src/components/calendarPanel.js, a hardcoded copy of the owner's own
 * Solo/Duo rank history (plus a Gold I flex starter point). Built as-is, every
 * person who installs the app would see someone else's LP climb on their chart.
 *
 * So for the duration of the build this script swaps in a copy with those seeds
 * emptied, then restores the original — the owner's running app is unaffected.
 * If it can't find the seed to strip, it refuses to build rather than risk
 * shipping it.
 *
 * Everything else is already per-user: the API key, Riot ID and match database
 * live in %APPDATA%\nexus-insights on whichever PC runs the app, and are never
 * part of the package. A fresh install starts empty.
 *
 * Flags:
 *   --dry-run   do the strip + checks + restore, but skip electron-builder
 */

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT    = path.join(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const SEED_FILE = path.join(ROOT, 'src', 'components', 'calendarPanel.js');
const BACKUP    = SEED_FILE + '.build-backup';

function fail(msg) {
    console.error('\n  ERROR: ' + msg + '\n');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// 0. Recover from an interrupted earlier build
// ---------------------------------------------------------------------------
// If a previous run was killed mid-build, the stripped file is still in place
// and the original is sitting in the backup. Put it back before anything else.
if (fs.existsSync(BACKUP)) {
    console.log('  Restoring calendarPanel.js left over from an interrupted build...');
    fs.copyFileSync(BACKUP, SEED_FILE);
    fs.unlinkSync(BACKUP);
}

// ---------------------------------------------------------------------------
// 1. Preflight — is everything the build needs present?
// ---------------------------------------------------------------------------
const need = [
    ['node_modules/electron/dist/electron.exe',               'Electron'],
    ['node_modules/electron-builder/package.json',            'electron-builder'],
    ['node_modules/sqlite3/build/Release/node_sqlite3.node',  'the sqlite3 database driver'],
    ['src/assets/icon.ico',                                   'the app icon'],
];
for (const [rel, what] of need) {
    if (!fs.existsSync(path.join(ROOT, rel))) {
        fail(`Missing ${what} (${rel}).\n  Run "npm install" in this folder first, then try again.`);
    }
}

const pkg = require(path.join(ROOT, 'package.json'));
console.log(`\n  Building Nexus Insights ${pkg.version} installer\n`);

// ---------------------------------------------------------------------------
// 2. Strip personal data (temporarily)
// ---------------------------------------------------------------------------
const original = fs.readFileSync(SEED_FILE, 'utf8');
let cleaned = original;

const SEED_RE = /const SOLO_LP_SEED = \[[\s\S]*?\];/;
if (!SEED_RE.test(cleaned)) {
    fail('Could not find SOLO_LP_SEED in calendarPanel.js — the source has changed.\n' +
         '  Refusing to build in case personal LP history would ship.\n' +
         '  Update the pattern in scripts/build-installer.js.');
}
cleaned = cleaned.replace(SEED_RE, 'const SOLO_LP_SEED = [];');

// Optional hardcoded flex starter point — strip it if present
cleaned = cleaned.replace(
    /\s*const flexHist = await getLpHistory\('flex'\);\s*if \(flexHist\.length === 0\) \{\s*await seedLpSnapshot\('flex'[^\n]*\n\s*\}/,
    '\n        // (flex starter snapshot removed for distribution)');

// Final guard: no dated personal snapshots may remain
if (/\{\s*date:\s*'20\d\d-\d\d-\d\d',\s*tier:/.test(cleaned)) {
    fail('Personal LP snapshots still present after stripping. Not building.');
}
if (/seedLpSnapshot\('flex'/.test(cleaned)) {
    fail('Hardcoded flex LP snapshot still present after stripping. Not building.');
}

let exitCode = 0;
fs.copyFileSync(SEED_FILE, BACKUP);
try {
    fs.writeFileSync(SEED_FILE, cleaned, 'utf8');
    console.log('  Personal LP history stripped for this build (restored afterwards).');

    // -----------------------------------------------------------------------
    // 3. Build
    // -----------------------------------------------------------------------
    if (DRY_RUN) {
        console.log('  --dry-run: skipping electron-builder.');
    } else {
        const bin = path.join(ROOT, 'node_modules', '.bin',
            process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
        console.log('  Running electron-builder (takes a minute or two)...\n');
        const r = spawnSync(`"${bin}"`, ['--win', 'nsis', '--x64', '--publish', 'never'], {
            cwd: ROOT,
            stdio: 'inherit',
            shell: true,
        });
        exitCode = r.status === null ? 1 : r.status;
    }
} finally {
    // -----------------------------------------------------------------------
    // 4. Always restore the owner's original file
    // -----------------------------------------------------------------------
    fs.copyFileSync(BACKUP, SEED_FILE);
    fs.unlinkSync(BACKUP);
    console.log('\n  calendarPanel.js restored to your original.');
}

if (exitCode !== 0) fail('electron-builder failed (see the output above).');
if (DRY_RUN) { console.log('  Dry run OK.\n'); process.exit(0); }

// ---------------------------------------------------------------------------
// 5. Report
// ---------------------------------------------------------------------------
const distDir = path.join(ROOT, 'dist');
const setup = fs.readdirSync(distDir)
    .filter(f => /Setup.*\.exe$/i.test(f))
    .map(f => ({ f, t: fs.statSync(path.join(distDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0];

if (!setup) fail('Build reported success but no Setup .exe was found in dist\\.');

const mb = (fs.statSync(path.join(distDir, setup.f)).size / 1048576).toFixed(0);
console.log('\n  =========================================================');
console.log('   DONE');
console.log(`   ${path.join(distDir, setup.f)}  (${mb} MB)`);
console.log('');
console.log('   Send that one file. It installs a completely fresh copy:');
console.log('   no API key, no matches, no LP history.');
console.log('  =========================================================\n');
