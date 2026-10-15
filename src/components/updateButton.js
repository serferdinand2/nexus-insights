/**
 * updateButton.js — the ⟳ button in the title bar, next to Settings.
 *
 * Click → main process checks GitHub Releases (services/updater.js). If a
 * newer version exists it downloads (spinner; % in the tooltip), then the app restarts into
 * the new version. A quiet check at startup only lights the green dot.
 */

const { ipcRenderer, shell } = require('electron');

let currentVersion = '';

function toast(title, msg, ms = 5000) {
    if (typeof window.showToast === 'function') window.showToast(title, msg, ms);
}

function setButton(mode, { percent, version } = {}) {
    const btn = document.getElementById('updateBtn');
    if (!btn) return;
    btn.classList.toggle('is-busy', mode === 'busy');
    btn.classList.toggle('has-update', mode === 'available');

    const titles = {
        idle:      `Check for updates (you have v${currentVersion})`,
        available: `Update available: v${version} — click to install`,
        busy:      percent != null ? `Downloading update… ${percent}%` : 'Checking for updates…',
    };
    btn.title = titles[mode] || titles.idle;
    btn.setAttribute('aria-label', btn.title);
}

function onStatus(_e, s) {
    if (!s) return;
    switch (s.state) {
        case 'checking':
            setButton('busy');
            break;
        case 'available':                       // quiet startup check found one
            setButton('available', { version: s.version });
            break;
        case 'downloading':
            if (s.percent === 0) toast('Update found', `Downloading v${s.version}…`, 4000);
            setButton('busy', { percent: s.percent });
            break;
        case 'ready':
            setButton('busy', { percent: 100 });
            toast('Update ready', `Restarting into v${s.version}…`, 4000);
            break;
        case 'none':
            setButton('idle');
            toast('Up to date', `You have the latest version (v${s.version}).`, 3500);
            break;
        case 'dev':
            setButton('idle');
            toast('Running from source',
                'Updates install into the installed app only. Here, use "git pull" to get the latest code.', 6000);
            break;
        case 'manual':                          // macOS/Linux: no self-update
            setButton('idle');
            toast('Download updates by hand',
                'Automatic updates are Windows-only for now. Opening the download page…', 6000);
            if (/^https:\/\//i.test(s.url || '')) shell.openExternal(s.url);
            break;
        case 'error':
            setButton('idle');
            toast('Update failed', s.message || 'Something went wrong.', 8000);
            break;
    }
}

async function initUpdateButton() {
    const btn = document.getElementById('updateBtn');
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';

    try { currentVersion = await ipcRenderer.invoke('app:version'); } catch { /* older main */ }
    setButton('idle');

    btn.addEventListener('click', () => {
        if (btn.classList.contains('is-busy')) return;
        ipcRenderer.send('update:check');
    });
    ipcRenderer.on('update:status', onStatus);
}

window.initUpdateButton = initUpdateButton;

module.exports = { initUpdateButton };
