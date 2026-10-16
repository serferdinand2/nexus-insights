#!/usr/bin/env node
/**
 * build-installer.js — produce a clean, shareable installer for this OS.
 *
 *   npm run dist          (or double-click "Build Installer.bat" on Windows)
 *
 * Output, in dist/:
 *   Windows  Nexus-Insights-Setup.exe
 *   macOS    Nexus-Insights-mac-<arch>.dmg
 *   Linux    Nexus-Insights-linux-<arch>.AppImage
 *
 * Each OS builds its own: the sqlite3 driver in node_modules and the Electron
 * in electronDist are whatever `npm install` fetched for *this* machine, so a
 * cross-build would ship binaries that can't run on the target.
 *
 * NO PERSONAL DATA IN THE PACKAGE
 * -------------------------------
 * The source used to carry the owner's LP history (SOLO_LP_SEED in
 * calendarPanel.js), which this script stripped for every build. That history
 * now lives in each user's own database as LP checkpoints (#5), so there is
 * nothing to strip; the script only refuses to build if hard-coded LP history
 * ever shows up in the source again.
 *
 * Everything is per-user: the API key, Riot ID, LP history and match database
 * live in %APPDATA%\nexus-insights on whichever PC runs the app, and are never
 * part of the package. A fresh install starts empty.
 *
 * Flags:
 *   --dry-run   do the checks, but skip electron-builder
 *   --publish   RELEASE AN UPDATE (npm run release / "Publish Update.bat"),
 *               Windows only for now (see the check below):
 *               bump the patch version (1.0.3 -> 1.0.4), build, upload the
 *               installer + latest.yml to a GitHub Release, then commit and
 *               push. Installed copies pick it up from the ⟳ button.
 *               Needs a GitHub token: GH_TOKEN env var, or the token pasted
 *               into %APPDATA%\nexus-insights\github-token.txt (outside the
 *               repo, so it can never be committed).
 *   --version X.Y.Z   with --publish, use this version instead of the bump
 */

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT    = path.join(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const PUBLISH = process.argv.includes('--publish');
const VERSION_ARG = (() => {
    const i = process.argv.indexOf('--version');
    return i > -1 ? process.argv[i + 1] : null;
})();
const SEED_FILE = path.join(ROOT, 'src', 'components', 'calendarPanel.js');
// Left behind by an interrupted build of an older version of this script
const BACKUP    = SEED_FILE + '.build-backup';

function fail(msg) {
    console.error('\n  ERROR: ' + msg + '\n');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// 0. Leftover from an older build
// ---------------------------------------------------------------------------
// Older versions of this script stripped calendarPanel.js and kept the
// original in a .build-backup file. That backup still holds the hard-coded LP
// history, so it must not be copied back now; ask for it to be removed.
if (fs.existsSync(BACKUP)) {
    fail(`Found ${path.relative(ROOT, BACKUP)}, left by an interrupted build of an older version.\n` +
         '  Builds no longer change calendarPanel.js. Check you don\'t need it, delete it, and run this again.');
}

// ---------------------------------------------------------------------------
// 1. Preflight — is everything the build needs present?
// ---------------------------------------------------------------------------
// Host arch for macOS/Linux (an Apple Silicon Mac builds arm64); the Windows
// installer has always been x64.
const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64';
const TARGETS = {
    win32:  { os: 'Windows', electron: 'electron.exe', icon: 'icon.ico', file: /^Nexus-Insights-Setup\.exe$/,
              args: ['--win', 'nsis', '--x64'] },
    darwin: { os: 'macOS',   electron: 'Electron.app', icon: 'icon.png', file: /^Nexus-Insights-mac-.*\.dmg$/,
              args: ['--mac', 'dmg', `--${ARCH}`] },
    linux:  { os: 'Linux',   electron: 'electron',     icon: 'icon.png', file: /^Nexus-Insights-linux-.*\.AppImage$/,
              args: ['--linux', 'AppImage', `--${ARCH}`] },
};
const TARGET = TARGETS[process.platform];
if (!TARGET) fail(`Building on ${process.platform} isn't supported (Windows, macOS or Linux).`);

const need = [
    [`node_modules/electron/dist/${TARGET.electron}`,         'Electron'],
    ['node_modules/electron-builder/package.json',            'electron-builder'],
    ['node_modules/sqlite3/build/Release/node_sqlite3.node',  'the sqlite3 database driver'],
    [`src/assets/${TARGET.icon}`,                             'the app icon'],
];
for (const [rel, what] of need) {
    if (!fs.existsSync(path.join(ROOT, rel))) {
        fail(`Missing ${what} (${rel}).\n  Run "npm install" in this folder first, then try again.`);
    }
}

// ---------------------------------------------------------------------------
// 1b. Release mode: token + version bump
// ---------------------------------------------------------------------------
const PKG_FILE  = path.join(ROOT, 'package.json');
const LOCK_FILE = path.join(ROOT, 'package-lock.json');
const pkgText   = fs.readFileSync(PKG_FILE, 'utf8');
const lockText  = fs.existsSync(LOCK_FILE) ? fs.readFileSync(LOCK_FILE, 'utf8') : null;
const pkg       = JSON.parse(pkgText);
let   buildEnv  = process.env;

function readToken() {
    if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
    const file = path.join(process.env.APPDATA || '', 'nexus-insights', 'github-token.txt');
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    return '';
}

function bumpPatch(v) {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
    if (!m) fail(`Can't bump version "${v}" — use --version X.Y.Z`);
    return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

function setVersion(v) {
    fs.writeFileSync(PKG_FILE, pkgText.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`));
    if (lockText) {
        const lock = JSON.parse(lockText);
        lock.version = v;
        if (lock.packages && lock.packages['']) lock.packages[''].version = v;
        fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + '\n');
    }
}

function restoreVersion() {
    fs.writeFileSync(PKG_FILE, pkgText);
    if (lockText) fs.writeFileSync(LOCK_FILE, lockText);
}

// A release is what every installed copy updates from: it must carry the
// Windows installer and latest.yml. One published from here would have
// neither, and Windows users' ⟳ button would stop finding updates.
if (PUBLISH && process.platform !== 'win32') {
    fail(`Releases are published from Windows only for now.\n` +
         `  To share a ${TARGET.os} copy, run "npm run dist" and send the file it makes.`);
}

if (PUBLISH) {
    const token = readToken();
    if (!token && !DRY_RUN) {
        fail('No GitHub token found, so the release can\'t be uploaded.\n' +
             '  1. On github.com: Settings > Developer settings > Personal access tokens >\n' +
             '     Fine-grained tokens > Generate new token. Repository access: only\n' +
             '     "nexus-insights". Permissions: Contents = Read and write.\n' +
             '  2. Paste the token (one line, nothing else) into\n' +
             '     %APPDATA%\\nexus-insights\\github-token.txt\n' +
             '  3. Run this again.');
    }
    if (VERSION_ARG && !/^\d+\.\d+\.\d+$/.test(VERSION_ARG)) fail(`--version must look like 1.2.3 (got "${VERSION_ARG}")`);
    pkg.version = VERSION_ARG || bumpPatch(pkg.version);
    setVersion(pkg.version);
    buildEnv = { ...process.env, GH_TOKEN: token };
}

/**
 * Ask GitHub whether the token works *before* spending minutes on a build.
 * A deleted or expired token otherwise only fails at the upload step with a
 * wall of "401 Bad credentials" output.
 */
async function checkToken() {
    if (!PUBLISH || DRY_RUN) return;
    const { owner, repo } = pkg.build.publish[0];
    const where = process.env.GH_TOKEN
        ? 'the GH_TOKEN environment variable (remove it with:  setx GH_TOKEN ""  then open a new window)'
        : '%APPDATA%\\nexus-insights\\github-token.txt';
    let res;
    try {
        res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
            headers: { Authorization: `Bearer ${buildEnv.GH_TOKEN}`, 'User-Agent': 'nexus-insights-release' },
        });
    } catch (err) {
        restoreVersion();
        fail(`Couldn't reach GitHub (${err.message}). Check your internet connection.`);
    }
    if (res.status === 401) {
        restoreVersion();
        fail('GitHub rejected the token ("Bad credentials") - it was deleted, expired or mistyped.\n' +
             '  Make a new one: github.com > Settings > Developer settings > Personal access tokens >\n' +
             '  Fine-grained tokens > Generate new token. Repository access: only "nexus-insights".\n' +
             '  Permissions: Contents = Read and write.\n' +
             `  Then replace the old token in ${where} and run this again.`);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || (body.permissions && !body.permissions.push)) {
        restoreVersion();
        fail(`The token works but can't publish to ${owner}/${repo} (HTTP ${res.status}).\n` +
             '  Give it access to the nexus-insights repository with Contents = Read and write.');
    }
    console.log('  GitHub token OK.');
}

console.log(`\n  ${PUBLISH ? 'Releasing' : 'Building'} Nexus Insights ${pkg.version} for ${TARGET.os}\n`);

// ---------------------------------------------------------------------------
// 2. No personal data in the source
// ---------------------------------------------------------------------------
const source = fs.readFileSync(SEED_FILE, 'utf8');
if (/\{\s*date:\s*'20\d\d-\d\d-\d\d',\s*tier:/.test(source) || /SOLO_LP_SEED|seedLpSnapshot\(/.test(source)) {
    fail('calendarPanel.js contains hard-coded LP history again. Not building.\n' +
         '  LP history belongs in the database (Checkpoints on the LP cards), not in the source.');
}

(async () => {
await checkToken();

let exitCode = 0;

// ---------------------------------------------------------------------------
// 3. Build
// ---------------------------------------------------------------------------
if (DRY_RUN) {
    console.log('  --dry-run: skipping electron-builder.');
} else {
    const bin = path.join(ROOT, 'node_modules', '.bin',
        process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
    console.log('  Running electron-builder (takes a minute or two)...\n');
    const r = spawnSync(`"${bin}"`, [...TARGET.args, '--publish', PUBLISH ? 'always' : 'never'], {
        cwd: ROOT,
        stdio: 'inherit',
        shell: true,
        env: buildEnv,
    });
    exitCode = r.status === null ? 1 : r.status;
}

if (PUBLISH && (exitCode !== 0 || DRY_RUN)) {
    // Nothing went out — don't leave a bumped version behind
    restoreVersion();
    if (DRY_RUN) console.log('  Version bump undone (dry run).');
}
if (exitCode !== 0) fail('electron-builder failed (see the output above).' +
    (PUBLISH ? '\n  Nothing was released; the version number was put back.' : ''));
if (DRY_RUN) { console.log('  Dry run OK.\n'); process.exit(0); }

// ---------------------------------------------------------------------------
// 5. Report
// ---------------------------------------------------------------------------
const distDir = path.join(ROOT, 'dist');
const setup = fs.readdirSync(distDir)
    .filter(f => TARGET.file.test(f))
    .map(f => ({ f, t: fs.statSync(path.join(distDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0];

if (!setup) fail(`Build reported success but no ${TARGET.os} installer was found in dist.`);

const mb = (fs.statSync(path.join(distDir, setup.f)).size / 1048576).toFixed(0);

// Fill in the release page on GitHub. electron-builder creates the release
// with an empty body; first-time visitors need install steps, and everyone
// wants to know what changed. Best effort: a failure here doesn't undo a
// release that is already live.
async function writeReleasePage(version) {
    const { owner, repo } = pkg.build.publish[0];
    const tag = `v${version}`;
    const api = `https://api.github.com/repos/${owner}/${repo}`;
    const headers = {
        Authorization: `Bearer ${buildEnv.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'nexus-insights-release',
    };

    // "What's new": commit subjects since the previous release commit
    const sh = (...a) => {
        const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });
        return r.status === 0 ? r.stdout.trim() : '';
    };
    const prev = sh('log', '-1', '--format=%H', '--grep=^Release v');
    // First release: no list — the old history is developer noise
    const subjects = (prev ? sh('log', '--format=%s', '--no-merges', `${prev}..HEAD`) : '')
        .split('\n').map(l => l.trim())
        .filter(l => l && !/^Release v/.test(l));
    const whatsNew = subjects.length
        ? `## What's new\n\n${subjects.map(l => `- ${l}`).join('\n')}\n\n`
        : '';

    const guide = fs.readFileSync(path.join(ROOT, 'installer', 'release-notes.md'), 'utf8');
    const body = whatsNew + guide;

    const rel = await fetch(`${api}/releases/tags/${tag}`, { headers });
    if (!rel.ok) throw new Error(`couldn't find release ${tag} (HTTP ${rel.status})`);
    const { id } = await rel.json();
    const upd = await fetch(`${api}/releases/${id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Nexus Insights ${tag}`, body }),
    });
    if (!upd.ok) throw new Error(`HTTP ${upd.status}`);
}

if (PUBLISH) {
  (async () => {
    try {
        await writeReleasePage(pkg.version);
        console.log('  Release page written (install guide + what\'s new).');
    } catch (err) {
        console.log(`  NOTE: release is live, but its description couldn't be written: ${err.message}`);
    }

    // Record the release in git so the repo matches what was shipped.
    // .gitignore keeps the database, dist\ and secrets out.
    const git = (...args) => spawnSync('git', args, { cwd: ROOT, stdio: 'inherit' }).status === 0;
    const committed = git('add', '-A') && git('commit', '-m', `Release v${pkg.version}`);
    const pushed = committed && git('push');

    console.log('\n  =========================================================');
    console.log(`   RELEASED v${pkg.version}`);
    console.log(`   https://github.com/toancina/nexus-insights/releases/tag/v${pkg.version}`);
    console.log('');
    console.log('   Installed copies get it from the update button (top right).');
    if (!pushed) {
        console.log('');
        console.log('   NOTE: the code could not be committed/pushed automatically.');
        console.log('   Run "git push" yourself so GitHub has the matching code.');
    }
    console.log('  =========================================================\n');
    process.exit(0);
  })();
} else {
    console.log('\n  =========================================================');
    console.log('   DONE');
    console.log(`   ${path.join(distDir, setup.f)}  (${mb} MB)`);
    console.log('');
    console.log('   Send that one file. It installs a completely fresh copy:');
    console.log('   no API key, no matches, no LP history.');
    console.log('  =========================================================\n');
}
})();
