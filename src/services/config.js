const fs = require('fs');
const path = require('path');
const { userDataPath } = require('./paths');

const configPath = path.join(userDataPath, 'config.json');

// Default config (empty - user must fill in)
const defaultConfig = {
    apiKey: '',
    gameName: '',
    tagLine: '',
    region: 'europe',      // Regional routing: europe, americas, asia
    platform: 'euw1',      // Platform: euw1, na1, kr, etc.

    // Background behaviour. Both default on because they're what make
    // per-match LP work: Riot exposes no LP history, so the app has to be
    // running to observe changes as they happen.
    closeToTray: true,     // X hides to the system tray instead of quitting
    startOnLogin: true,    // launch automatically when Windows starts

    // Watch the League client's local Live Client Data API (127.0.0.1:2999)
    // to detect when a game starts and ends, then log it automatically.
    autoLogGames: true
};

// Ensure userData directory exists
function ensureUserDataDir() {
    if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
    }
}

// In-memory cache — loadConfig() is called on every Riot API request, and a
// sync issues hundreds of them. Reading the file once and invalidating on
// save turns those into plain object reads.
let cachedConfig = null;

// Load config from file (cached after first read)
function loadConfig() {
    if (cachedConfig) return { ...cachedConfig };

    ensureUserDataDir();
    try {
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf8');
            cachedConfig = { ...defaultConfig, ...JSON.parse(data) };
            return { ...cachedConfig };
        }
    } catch (err) {
        console.error('Error loading config:', err);
    }
    return { ...defaultConfig };
}

// Save config to file
function saveConfig(config) {
    ensureUserDataDir();
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        cachedConfig = { ...defaultConfig, ...config };
        return true;
    } catch (err) {
        console.error('Error saving config:', err);
        return false;
    }
}

// Check if config is valid (has required fields)
function isConfigValid(config) {
    return config &&
           config.apiKey && config.apiKey.trim() !== '' &&
           config.gameName && config.gameName.trim() !== '' &&
           config.tagLine && config.tagLine.trim() !== '';
}

// Get a specific config value
function getConfigValue(key) {
    const config = loadConfig();
    return config[key];
}

// Set a specific config value
function setConfigValue(key, value) {
    const config = loadConfig();
    config[key] = value;
    return saveConfig(config);
}

module.exports = {
    loadConfig,
    saveConfig,
    isConfigValid,
    getConfigValue,
    setConfigValue,
    configPath,
    userDataPath
};
