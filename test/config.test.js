const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Module = require('module');
const { SRC } = require('./helpers');

/** Load services/config.js against a throwaway data folder. */
function freshConfig(dir) {
    const pathsFile = path.join(SRC, 'services', 'paths.js');
    const fake = new Module(pathsFile);
    fake.filename = pathsFile; fake.loaded = true; fake.exports = { userDataPath: dir };
    require.cache[pathsFile] = fake;
    const configFile = path.join(SRC, 'services', 'config.js');
    delete require.cache[configFile];
    const C = require(configFile);
    return { C, cleanup: () => { delete require.cache[pathsFile]; delete require.cache[configFile]; } };
}

test('hasSavedValue tells a saved choice from a default (#36)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-config-'));
    const { C, cleanup } = freshConfig(dir);
    try {
        // No config.json yet: the default says on, but nothing was chosen
        assert.equal(C.loadConfig().startOnLogin, true);
        assert.equal(C.hasSavedValue('startOnLogin'), false);

        // What main.js does from source on first launch
        C.setConfigValue('startOnLogin', false);
        assert.equal(C.hasSavedValue('startOnLogin'), true);
        assert.equal(C.loadConfig().startOnLogin, false);

        // A saved "on" stays on (an existing install that turned it on)
        C.setConfigValue('startOnLogin', true);
        assert.equal(C.loadConfig().startOnLogin, true);

        // A file without the key, and a broken file
        fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ apiKey: 'x' }));
        assert.equal(C.hasSavedValue('startOnLogin'), false);
        fs.writeFileSync(path.join(dir, 'config.json'), '{ not json');
        assert.equal(C.hasSavedValue('startOnLogin'), false);
    } finally {
        cleanup();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('saves never leave a half-written config, and a broken one falls back (#40)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-config-'));
    const { C, cleanup } = freshConfig(dir);
    const file = path.join(dir, 'config.json');
    try {
        assert.equal(C.saveConfig({ apiKey: 'RGAPI-one', gameName: 'A', tagLine: 'EUW' }), true);
        assert.equal(fs.existsSync(file + '.tmp'), false, 'no temp file left behind');
        assert.equal(fs.existsSync(file + '.bak'), false, 'nothing to back up on the first save');

        C.saveConfig({ ...C.loadConfig(), apiKey: 'RGAPI-two' });
        assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).apiKey, 'RGAPI-two');
        assert.equal(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')).apiKey, 'RGAPI-one', 'previous save kept');

        // A crash mid-write elsewhere leaves config.json cut off: the backup is used
        fs.writeFileSync(file, '{ "apiKey": "RGAP');
        const { C: reloaded, cleanup: cleanup2 } = freshConfig(dir);
        try {
            assert.equal(reloaded.loadConfig().apiKey, 'RGAPI-one');
        } finally { cleanup2(); }

        // Neither readable: defaults, no crash
        fs.writeFileSync(file + '.bak', 'null');
        const { C: empty, cleanup: cleanup3 } = freshConfig(dir);
        try {
            assert.equal(empty.loadConfig().apiKey, '');
        } finally { cleanup3(); }
    } finally {
        cleanup();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
