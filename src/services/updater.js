/**
 * updater.js — "check for updates" from GitHub Releases (main process).
 *
 * The titlebar ⟳ button (components/updateButton.js) asks for a check. Flow:
 *
 *   check → nothing newer           → 'none'
 *         → newer version found     → download it ('downloading', with %)
 *                                    → 'ready' → restart into the installer
 *
 * Releases come from github.com/toancina/nexus-insights (the `publish` block
 * in package.json, which electron-builder bakes into the installed app as
 * resources/app-update.yml). The repo is public, so no token ships in the app.
 *
 * Only the installed (packaged) app can update itself. Running from source,
 * the button reports 'dev' — use `git pull` there.
 *
 * Everything the renderer sees goes through one channel, 'update:status',
 * as { state, version?, percent?, message? }.
 */

const RESTART_DELAY_MS = 2500;   // long enough to read "Restarting…"

function friendlyError(err) {
    const msg = String((err && err.message) || err || 'Unknown error');
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|net::ERR_/i.test(msg)) {
        return "Couldn't reach GitHub. Check your internet connection and try again.";
    }
    if (/404|latest\.yml|No published versions|Cannot find .*latest/i.test(msg)) {
        return 'No published release found on GitHub yet.';
    }
    if (/403|rate limit/i.test(msg)) {
        return 'GitHub is limiting requests right now. Try again in a few minutes.';
    }
    if (/sha512 checksum mismatch|signature/i.test(msg)) {
        return 'The downloaded update was damaged. Try again.';
    }
    return msg.split('\n')[0].slice(0, 200);
}

/**
 * @param {object} deps
 * @param {object}   deps.autoUpdater   electron-updater's autoUpdater (or a fake in tests)
 * @param {Function} deps.send          (status) => void — forwards to the renderer
 * @param {Function} deps.beforeRestart () => void — lets main skip close-to-tray
 * @param {boolean}  deps.isPackaged
 * @param {string}   deps.currentVersion
 * @param {Function} [deps.setTimeout]
 */
function createUpdater({ autoUpdater, send, beforeRestart, isPackaged, currentVersion,
                         setTimeout: later = setTimeout }) {
    let state = 'idle';          // idle | checking | downloading | ready
    let wantInstall = false;     // true when the user asked (not the quiet startup check)
    let lastVersion = null;

    const emit = (status) => { try { send(status); } catch { /* window gone */ } };

    if (autoUpdater) {
        autoUpdater.autoDownload = false;          // we decide when to download
        autoUpdater.autoInstallOnAppQuit = true;   // a finished download still installs on next quit

        autoUpdater.on('update-available', (info) => {
            lastVersion = info && info.version;
            if (!wantInstall) {
                // Quiet startup check: just light the dot on the button.
                state = 'idle';
                emit({ state: 'available', version: lastVersion });
                return;
            }
            state = 'downloading';
            emit({ state: 'downloading', version: lastVersion, percent: 0 });
            Promise.resolve(autoUpdater.downloadUpdate()).catch(onError);
        });

        autoUpdater.on('update-not-available', () => {
            state = 'idle';
            if (wantInstall) emit({ state: 'none', version: currentVersion });
            wantInstall = false;
        });

        autoUpdater.on('download-progress', (p) => {
            emit({ state: 'downloading', version: lastVersion,
                   percent: Math.max(0, Math.min(100, Math.round((p && p.percent) || 0))) });
        });

        autoUpdater.on('update-downloaded', (info) => {
            state = 'ready';
            const version = (info && info.version) || lastVersion;
            emit({ state: 'ready', version });
            later(() => {
                beforeRestart();
                // isSilent: no installer wizard; isForceRunAfter: reopen the app
                autoUpdater.quitAndInstall(true, true);
            }, RESTART_DELAY_MS);
        });

        autoUpdater.on('error', onError);
    }

    function onError(err) {
        const quiet = !wantInstall;
        state = 'idle';
        wantInstall = false;
        if (!quiet) emit({ state: 'error', message: friendlyError(err) });
    }

    /**
     * @param {{ quiet?: boolean }} opts  quiet = startup check, never downloads
     */
    async function check({ quiet = false } = {}) {
        if (!isPackaged || !autoUpdater) {
            if (!quiet) emit({ state: 'dev', version: currentVersion });
            return;
        }
        if (state === 'checking' || state === 'downloading' || state === 'ready') {
            // Already busy — repeat the current state so the button stays honest.
            if (!quiet) emit({ state, version: lastVersion });
            return;
        }
        if (!quiet) wantInstall = true;
        state = 'checking';
        if (!quiet) emit({ state: 'checking', version: currentVersion });
        try {
            await autoUpdater.checkForUpdates();
        } catch (err) {
            onError(err);
        } finally {
            if (state === 'checking') state = 'idle';
        }
    }

    return { check, getState: () => state };
}

module.exports = { createUpdater, friendlyError, RESTART_DELAY_MS };
