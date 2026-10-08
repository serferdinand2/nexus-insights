/**
 * paths.js — single source of truth for the per-user data directory.
 *
 * Main process: electron.app is defined, ask Electron.
 * Renderer process: electron.app is undefined, compute the platform path
 * manually (Windows: %APPDATA%, macOS: ~/Library/Application Support,
 * Linux: ~/.config).
 */

const fs = require('fs');
const path = require('path');
const electron = require('electron');

const APP_NAME = 'nexus-insights';

let userDataPath;
if (electron.app) {
    // Built from appData + the fixed name rather than getPath('userData'),
    // which derives from package.json's productName/name. The renderer below
    // hardcodes APP_NAME, so if those ever differed (e.g. someone adds a
    // top-level "productName": "Nexus Insights") the two processes would
    // silently read and write different folders.
    userDataPath = path.join(electron.app.getPath('appData'), APP_NAME);
} else if (process.platform === 'win32') {
    userDataPath = path.join(process.env.APPDATA, APP_NAME);
} else if (process.platform === 'darwin') {
    userDataPath = path.join(process.env.HOME, 'Library', 'Application Support', APP_NAME);
} else {
    userDataPath = path.join(process.env.HOME, '.config', APP_NAME);
}

// Make sure the folder exists before anything uses it. database.js opens the
// SQLite file the moment it is required — in the main process that is before
// Electron's `ready`, so on a brand-new install the folder may not exist yet
// and the very first launch would fail to open the database.
try {
    fs.mkdirSync(userDataPath, { recursive: true });
} catch (err) {
    console.error('Could not create data folder:', userDataPath, err.message);
}

module.exports = { userDataPath };
