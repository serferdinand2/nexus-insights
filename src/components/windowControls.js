/**
 * windowControls.js — wiring for the custom title bar.
 *
 * The window is frameless (see main.js), so minimise / maximise / close are
 * ordinary buttons that message the main process. The maximise glyph is kept
 * in sync with the real window state, which can also change from outside the
 * app (Win+Up, snapping, double-clicking the drag region).
 */

const { ipcRenderer } = require('electron');

function send(action) {
    ipcRenderer.send('window:control', action);
}

function setMaximized(isMaximized) {
    document.body.classList.toggle('window-maximized', !!isMaximized);
    const btn = document.getElementById('winMaximize');
    if (btn) {
        btn.title = isMaximized ? 'Restore' : 'Maximise';
        btn.setAttribute('aria-label', btn.title);
    }
}

function initWindowControls() {
    const bind = (id, action) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => send(action));
    };

    bind('winMinimize', 'minimize');
    bind('winMaximize', 'maximize');
    bind('winClose',    'close');

    ipcRenderer.on('window:state', (_event, state) => setMaximized(state && state.maximized));
}

window.initWindowControls = initWindowControls;

module.exports = { initWindowControls, setMaximized };
