const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Module = require('module');
const { SRC } = require('./helpers');

// dataDragon.js reads the saved version from config.js: point it at a throwaway folder
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ddragon-'));
const pathsFile = path.join(SRC, 'services', 'paths.js');
const fake = new Module(pathsFile);
fake.filename = pathsFile; fake.loaded = true; fake.exports = { userDataPath: dir };
require.cache[pathsFile] = fake;
for (const f of ['config.js', 'dataDragon.js']) delete require.cache[path.join(SRC, 'services', f)];
const { pickVersion, FALLBACK_VERSION, getDDragonBase } = require(path.join(SRC, 'services', 'dataDragon.js'));

test.after(() => {
    delete require.cache[pathsFile];
    fs.rmSync(dir, { recursive: true, force: true });
});

test('the fallback is a real Data Dragon version (#39)', () => {
    assert.match(FALLBACK_VERSION, /^\d+\.\d+\.\d+$/);
    assert.notEqual(FALLBACK_VERSION, '25.S1.1');
    // Nothing saved yet: the base URL starts on the fallback, not a 404ing one
    assert.equal(getDDragonBase(), `https://ddragon.leagueoflegends.com/cdn/${FALLBACK_VERSION}`);
});

test('pickVersion: newest fetched, else last that worked, else the fallback', () => {
    assert.equal(pickVersion({ fetched: '16.21.1', saved: '16.20.1' }), '16.21.1');
    assert.equal(pickVersion({ fetched: null, saved: '16.19.1' }), '16.19.1');
    assert.equal(pickVersion({}), FALLBACK_VERSION);
    // Junk from the network or a hand-edited config is ignored
    assert.equal(pickVersion({ fetched: 'lolpatch_7.20', saved: '16.19.1' }), '16.19.1');
    assert.equal(pickVersion({ fetched: undefined, saved: '25.S1.1' }), FALLBACK_VERSION);
    assert.equal(pickVersion({ fetched: '<script>', saved: null }), FALLBACK_VERSION);
});
