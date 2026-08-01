/**
 * paths.js — single source of truth for the per-user data directory.
 *
 * Main process: electron.app is defined, ask Electron.
 * Renderer process: electron.app is undefined, compute the platform path
 * manually (Windows: %APPDATA%, macOS: ~/Library/Application Support,
 * Linux: ~/.config).
 */

const path = require('path');
const electron = require('electron');

const APP_NAME = 'nexus-insights';

let userDataPath;
if (electron.app) {
    userDataPath = electron.app.getPath('userData');
} else if (process.platform === 'win32') {
    userDataPath = path.join(process.env.APPDATA, APP_NAME);
} else if (process.platform === 'darwin') {
    userDataPath = path.join(process.env.HOME, 'Library', 'Application Support', APP_NAME);
} else {
    userDataPath = path.join(process.env.HOME, '.config', APP_NAME);
}

module.exports = { userDataPath };
